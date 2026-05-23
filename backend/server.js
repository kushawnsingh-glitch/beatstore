// backend/server.js
import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });
import { createClient } from '@supabase/supabase-js';
import colors from 'colors';
import paypal from '@paypal/checkout-server-sdk';
import Stripe from 'stripe';
import crypto from 'crypto';
import iso3166 from 'iso-3166-1';
import fetch from 'node-fetch';
// Legacy email routers removed — email is handled directly in this file via Nodemailer
import nodemailer from 'nodemailer';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { generateContactEmails } from './generators/contactEmails.js';
import beatRoutes from './routes/beat.js';

// ─── Supabase (service role = full DB + Storage access) ──────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── App + CORS ───────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'https://kushawn.com',
  'https://www.kushawn.com',
  // Additional origins from env (comma-separated), e.g. Vercel preview URLs
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()) : []),
];

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'X-Requested-With'],
  })
);

// Stripe webhook needs raw body — must come BEFORE express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// ─── Stripe ───────────────────────────────────────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2022-11-15' });

// ─── PayPal ───────────────────────────────────────────────────────────────────
const makePaypalClient = () =>
  new paypal.core.PayPalHttpClient(
    new paypal.core.LiveEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_CLIENT_SECRET
    )
  );

// ─── Storage helper (replaces S3 presigned URLs) ─────────────────────────────
const getPresignedUrl = async (path, expires = 3600, downloadFilename = null) => {
  if (!path) return null;
  // Strip legacy s3://bucket/ prefix if present
  const cleanPath = path.startsWith('s3://') ? path.replace(/^s3:\/\/[^/]+\//, '') : path;
  const options = downloadFilename ? { download: downloadFilename } : {};
  const { data, error } = await supabase.storage.from('beats').createSignedUrl(cleanPath, expires, options);
  if (error) {
    console.warn('Signed URL warning for path:', cleanPath, '-', error.message);
    return null; // Don't throw — let the beat still show without a broken URL
  }
  return data.signedUrl;
};

// ─── MailerLite helper ────────────────────────────────────────────────────────
const addToMailerLite = async (email, name) => {
  const { MAILERLITE_API_KEY, MAILERLITE_GROUP_ID } = process.env;
  if (!MAILERLITE_API_KEY || !MAILERLITE_GROUP_ID) return;
  try {
    await fetch(
      `https://connect.mailerlite.com/api/subscribers`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MAILERLITE_API_KEY}`,
        },
        body: JSON.stringify({
          email,
          fields: { name },
          groups: [MAILERLITE_GROUP_ID],
          resubscribe: true,
        }),
      }
    );
    console.log(`MailerLite: subscribed ${email}`);
  } catch (err) {
    console.error('MailerLite subscribe error:', err);
  }
};

// ─── Utils ────────────────────────────────────────────────────────────────────
const generateOrderId = () => crypto.randomUUID();

// ─── Cart validation ──────────────────────────────────────────────────────────
const validateCartItems = async (cartItems) => {
  let subtotal = 0;
  const validatedItems = [];

  for (const item of cartItems) {
    if (item.type === 'Beat') {
      const { data: beat, error } = await supabase.from('beats').select('*').eq('id', item.beatId).single();
      if (error || !beat) throw new Error(`Beat with ID ${item.beatId} not found`);

      const license = beat.licenses.find((lic) => lic.type === item.licenseType);
      if (!license) throw new Error(`License ${item.licenseType} not found for beat ${item.beatId}`);

      const price = parseFloat(license.price);
      subtotal += price;
      validatedItems.push({
        beatId: item.beatId,
        licenseType: item.licenseType,
        price,
        effectivePrice: price,
        title: beat.title,
        artist: beat.artist,
        bpm: beat.bpm,
        key: beat.key,
        s3_image_url: item.s3_image_url,
        s3_file_url: license.s3_file_url,
        type: 'Beat',
      });
    } else if (item.type === 'Pack') {
      const { data: pack, error } = await supabase.from('packs').select('*').eq('id', item.beatId).single();
      if (error || !pack) throw new Error(`Pack with ID ${item.beatId} not found`);

      const license = pack.licenses.find((lic) => lic.type === item.licenseType);
      if (!license) throw new Error(`License ${item.licenseType} not found for pack ${item.beatId}`);

      const price = parseFloat(pack.price);
      subtotal += price;
      validatedItems.push({
        beatId: item.beatId,
        licenseType: item.licenseType,
        price,
        effectivePrice: price,
        title: pack.title,
        artist: item.licenseType,
        s3_image_url: item.s3_image_url,
        s3_file_url: license.s3_file_url,
        type: 'Pack',
      });
    }
  }

  return { validatedItems, subtotal };
};

// ─── BOGO logic (extracted to avoid repetition) ───────────────────────────────
const applyBogo = (validatedItems) => {
  const groups = {};
  validatedItems.forEach((item) => {
    if (item.licenseType === 'Exclusive' || item.type === 'Pack') return;
    if (!groups[item.licenseType]) groups[item.licenseType] = [];
    groups[item.licenseType].push(item);
  });

  for (const lic in groups) {
    const groupItems = groups[lic];
    if (groupItems.length < 2) continue;
    groupItems.sort((a, b) => a.price - b.price);
    const free = Math.floor(groupItems.length / 2);
    for (let i = 0; i < free; i++) groupItems[i].effectivePrice = 0;
    for (let i = free; i < groupItems.length; i++) groupItems[i].effectivePrice = groupItems[i].price;
  }

  validatedItems.forEach((item) => {
    if (item.effectivePrice === undefined) item.effectivePrice = item.price;
  });

  return validatedItems;
};

// ─── Stripe Webhook ───────────────────────────────────────────────────────────
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    if (!Buffer.isBuffer(req.body)) throw new Error('Request body must be a Buffer');
    if (!sig) throw new Error('Missing stripe-signature header');
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook error:'.red, err);
    return res.status(400).json({ error: 'Webhook Error' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { orderId, cartItems, customerInfo, couponCode, subscribeToNewsletter } = session.metadata;
    try {
      const parsedCartItems = JSON.parse(cartItems);
      const parsedCustomerInfo = JSON.parse(customerInfo);

      let { validatedItems } = await validateCartItems(parsedCartItems);
      validatedItems = applyBogo(validatedItems);

      const afterBogo = validatedItems.reduce((sum, item) => sum + item.effectivePrice, 0);

      let couponDisc = 0;
      if (couponCode) {
        const { data: coupon } = await supabase.from('coupons').select('*').eq('code', couponCode.toUpperCase()).single();
        if (!coupon) throw new Error('Invalid coupon');
        couponDisc = coupon.discount_type === 'fixed'
          ? coupon.discount_value
          : (afterBogo * coupon.discount_value) / 100;
      }

      const finalTotal = afterBogo - couponDisc;
      if (session.amount_total !== Math.trunc(finalTotal * 100)) throw new Error('Amount mismatch');

      const discountFactor = couponCode && afterBogo > 0 ? finalTotal / afterBogo : 1;
      const finalItems = validatedItems.map((item) => ({
        ...item,
        effectivePrice: item.effectivePrice * discountFactor,
      }));

      const orderItems = await Promise.all(
        finalItems.map(async (item) => {
          if (item.type === 'Beat' && item.licenseType === 'Exclusive') {
            await supabase.from('beats').update({ available: false }).eq('id', item.beatId);
          }
          const ext = item.s3_file_url.split('.').pop();
          const filename = item.type === 'Beat'
            ? `${item.title} (Prod. KUSHAWN).${ext}`
            : `${item.title}.${ext}`;
          return {
            ...item,
            s3_file_url: await getPresignedUrl(item.s3_file_url, 3600 * 24 * 7, filename),
          };
        })
      );

      await supabase.from('orders').insert({
        order_id: orderId,
        payment_type: 'Stripe',
        stripe_payment_intent_id: session.payment_intent,
        customer_info: parsedCustomerInfo,
        items: orderItems,
        total_price: parseFloat(finalTotal.toFixed(2)),
      });

      const purchaseDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      await fetch(`${process.env.VITE_API_BASE_URL_BACKEND}/api/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: parsedCustomerInfo.email,
          subject: `KUSHAWN | Your Beat Download (Order #${orderId.slice(0, 8)}) - 7-Day Access`,
          purchaseDate,
          template: 'purchaseConfirmation',
          data: {
            customerName: parsedCustomerInfo.name,
            orderId,
            purchaseDate,
            orderItems,
            totalPrice: finalTotal.toFixed(2),
            downloadLink: `${process.env.APP_BASE_URL}/download?orderId=${orderId}`,
            paymentType: 'Stripe',
          },
        }),
      });

      if (couponCode) {
        await supabase.rpc('increment_coupon_uses', { coupon_code: couponCode.toUpperCase() });
      }

      if (subscribeToNewsletter === 'true') {
        await addToMailerLite(parsedCustomerInfo.email, parsedCustomerInfo.name);
      }

      res.json({ received: true });
    } catch (err) {
      console.error('Stripe webhook processing error:'.red, err);
      res.status(500).json({ error: 'Failed to process webhook' });
    }
  } else {
    res.json({ received: true });
  }
});

// General JSON body parser — after webhook raw handler
app.use(express.json());
app.use('/api', beatRoutes);

// ─── Server startup ───────────────────────────────────────────────────────────
async function startServer() {
  try {
    const { error } = await supabase.from('beats').select('id', { count: 'exact', head: true });
    if (error) console.warn('Supabase connection warning:'.yellow, error.message);
    else console.log('Connected to Supabase'.green);

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`.blue.bold));
  } catch (err) {
    console.error('Startup error:'.red, err);
    process.exit(1);
  }
}

startServer();

// ─── MailerLite subscribe ─────────────────────────────────────────────────────
app.post('/api/mailerlite/subscribe', async (req, res) => {
  const { name, email } = req.body;
  const { MAILERLITE_API_KEY, MAILERLITE_GROUP_ID } = process.env;
  if (!MAILERLITE_API_KEY || !MAILERLITE_GROUP_ID)
    return res.status(500).json({ error: 'Server configuration error' });
  try {
    const response = await fetch(
      `https://api.mailerlite.com/api/v2/groups/${MAILERLITE_GROUP_ID}/subscribers`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MailerLite-ApiKey': MAILERLITE_API_KEY },
        body: JSON.stringify({ email, name, resubscribe: true }),
      }
    );
    const data = await response.json();
    if (!response.ok)
      return res.status(response.status).json({ error: data.error?.message || 'Failed to subscribe' });
    res.status(200).json({ success: true, message: 'Subscribed successfully!', data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// ─── GET /api/beats ───────────────────────────────────────────────────────────
app.get('/api/beats', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    let search = req.query.search || '';
    const skip = (page - 1) * limit;

    let query = supabase
      .from('beats')
      .select('*', { count: 'exact' })
      .eq('available', true)
      .order('created_at', { ascending: false })
      .range(skip, skip + limit - 1);

    if (search) {
      if (search === 'g funk' || search === 'gfunk') search = 'g-funk';
      query = query.or(`title.ilike.%${search}%,artist.ilike.%${search}%,tags.cs.{${search}}`);
    }

    const { data: beatsList, count: totalBeats, error } = await query;
    if (error) throw error;

    for (const beat of beatsList) {
      beat.s3_mp3_url = await getPresignedUrl(beat.s3_mp3_url, 3600 * 24 * 7);
      beat.s3_image_url = beat.s3_image_url ? await getPresignedUrl(beat.s3_image_url, 3600 * 24 * 7) : null;
      beat.licenses = beat.licenses.map((lic) => ({ ...lic, s3_file_url: null }));
    }

    res.json({ beats: beatsList, page, totalPages: Math.ceil(totalBeats / limit), totalBeats });
  } catch (error) {
    console.error('Error fetching beats:'.red, error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/download/:beatId ────────────────────────────────────────────────
app.get('/api/download/:beatId', async (req, res) => {
  try {
    const { data: beat, error } = await supabase.from('beats').select('*').eq('id', req.params.beatId).single();
    if (error || !beat) return res.status(404).json({ error: 'Beat not found' });
    const downloadUrl = await getPresignedUrl(
      beat.s3_mp3_url,
      3600 * 24 * 7,
      `(KUSHAWN) - ${beat.title} [${beat.bpm} BPM - ${beat.key}] [Prod. KUSHAWN].mp3`
    );
    res.json({ downloadUrl });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// ─── GET /api/licenses/download/:licenseId ────────────────────────────────────
app.get('/api/licenses/download/:licenseId', async (req, res) => {
  try {
    const { data: license, error } = await supabase.from('licenses').select('*').eq('id', req.params.licenseId).single();
    if (error || !license) return res.status(404).json({ error: 'License not found' });
    const downloadUrl = await getPresignedUrl(license.license_download_link, 3600 * 24 * 7);
    res.json({ downloadUrl });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// ─── GET /api/licenses ────────────────────────────────────────────────────────
app.get('/api/licenses', async (req, res) => {
  try {
    const { data: licenses, error } = await supabase
      .from('licenses')
      .select('id, type, title, description, features, license_download_link, created_at')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(licenses);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// ─── License terms per type ───────────────────────────────────────────────────
const LICENSE_TERMS = {
  Basic: {
    title: 'Basic Lease Agreement', streams: '50,000', copies: '500',
    videos: '1', formats: 'MP3 Only', exclusive: false,
    lines: [
      'The Licensee is granted a non-exclusive license to use the Beat subject to the following:',
      '',
      '1. RECORDING - Licensee may record one (1) original composition using the Beat.',
      '2. DISTRIBUTION - Up to 500 copies (physical or digital) of the recorded song.',
      '3. STREAMING - Up to 50,000 combined audio streams across all platforms.',
      '4. MUSIC VIDEO - One (1) non-commercially distributed music video.',
      '5. FORMAT - MP3 file format only.',
      '6. CREDIT - All uses must credit "Prod. KUSHAWN" on recordings, artwork, and descriptions.',
      '7. NON-EXCLUSIVE - This Beat may be licensed to other artists.',
      '8. NO TRANSFER - This license is non-transferable and non-sublicensable.',
      '9. GOVERNING LAW - This Agreement is governed by the laws of Ontario, Canada.',
    ],
  },
  Premium: {
    title: 'Premium Lease Agreement', streams: '150,000', copies: '1,000',
    videos: '1', formats: 'MP3 + WAV', exclusive: false,
    lines: [
      'The Licensee is granted a non-exclusive license to use the Beat subject to the following:',
      '',
      '1. RECORDING - Licensee may record one (1) original composition using the Beat.',
      '2. DISTRIBUTION - Up to 1,000 copies (physical or digital) of the recorded song.',
      '3. STREAMING - Up to 150,000 combined audio streams across all platforms.',
      '4. MUSIC VIDEO - One (1) music video permitted for commercial distribution.',
      '5. FORMATS - MP3 and WAV file formats included.',
      '6. CREDIT - All uses must credit "Prod. KUSHAWN" on recordings, artwork, and descriptions.',
      '7. NON-EXCLUSIVE - This Beat may be licensed to other artists.',
      '8. NO TRANSFER - This license is non-transferable and non-sublicensable.',
      '9. GOVERNING LAW - This Agreement is governed by the laws of Ontario, Canada.',
    ],
  },
  Professional: {
    title: 'Professional Lease Agreement', streams: '500,000', copies: '2,500',
    videos: '2', formats: 'MP3 + WAV', exclusive: false,
    lines: [
      'The Licensee is granted a non-exclusive license to use the Beat subject to the following:',
      '',
      '1. RECORDING - Licensee may record one (1) original composition using the Beat.',
      '2. DISTRIBUTION - Up to 2,500 copies (physical or digital) of the recorded song.',
      '3. STREAMING - Up to 500,000 combined audio streams across all platforms.',
      '4. MUSIC VIDEOS - Up to two (2) music videos, permitted for commercial distribution.',
      '5. FORMATS - MP3 and WAV file formats included.',
      '6. CREDIT - All uses must credit "Prod. KUSHAWN" on recordings, artwork, and descriptions.',
      '7. NON-EXCLUSIVE - This Beat may be licensed to other artists.',
      '8. NO TRANSFER - This license is non-transferable and non-sublicensable.',
      '9. GOVERNING LAW - This Agreement is governed by the laws of Ontario, Canada.',
    ],
  },
  Legacy: {
    title: 'Legacy Lease Agreement', streams: '1,000,000', copies: '10,000',
    videos: '5', formats: 'MP3 + WAV + Stems', exclusive: false,
    lines: [
      'The Licensee is granted a non-exclusive license to use the Beat subject to the following:',
      '',
      '1. RECORDING - Licensee may record one (1) original composition using the Beat.',
      '2. DISTRIBUTION - Up to 10,000 copies (physical or digital) of the recorded song.',
      '3. STREAMING - Up to 1,000,000 combined audio streams across all platforms.',
      '4. MUSIC VIDEOS - Up to five (5) music videos, permitted for commercial distribution.',
      '5. FORMATS - MP3, WAV, and full Track Stems included.',
      '6. CREDIT - All uses must credit "Prod. KUSHAWN" on recordings, artwork, and descriptions.',
      '7. NON-EXCLUSIVE - This Beat may be licensed to other artists.',
      '8. NO TRANSFER - This license is non-transferable and non-sublicensable.',
      '9. GOVERNING LAW - This Agreement is governed by the laws of Ontario, Canada.',
    ],
  },
  Exclusive: {
    title: 'Exclusive License Agreement', streams: 'Unlimited', copies: 'Unlimited',
    videos: 'Unlimited', formats: 'MP3 + WAV + Stems', exclusive: true,
    lines: [
      'The Licensee is granted EXCLUSIVE rights to use the Beat subject to the following:',
      '',
      '1. EXCLUSIVITY - Upon purchase, the Beat will be removed from all licensing platforms',
      '   and will not be licensed to any other party.',
      '2. RECORDING - Licensee may record unlimited original compositions using the Beat.',
      '3. DISTRIBUTION - Unlimited physical and digital copies of any recordings.',
      '4. STREAMING - Unlimited streams on all platforms worldwide.',
      '5. MUSIC VIDEOS - Unlimited music videos, including full commercial distribution.',
      '6. FORMATS - MP3, WAV, and full Track Stems included.',
      '7. COMMERCIAL USE - Licensee may use the Beat for all commercial purposes.',
      '8. CREDIT - All uses must credit "Prod. KUSHAWN" on recordings, artwork, and descriptions.',
      '9. NO TRANSFER - This license is non-transferable and non-sublicensable.',
      '10. GOVERNING LAW - This Agreement is governed by the laws of Ontario, Canada.',
    ],
  },
};

// Wraps text to fit within maxWidth for pdf-lib (which has no auto-wrap)
const wrapText = (text, font, fontSize, maxWidth) => {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
};

// Generates a signed license contract PDF for one beat purchase
const generateLicensePdf = async (item, customerName, purchaseDate) => {
  const terms = LICENSE_TERMS[item.licenseType] || LICENSE_TERMS.Basic;
  const pdfDoc = await PDFDocument.create();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  const lightGray = rgb(0.95, 0.95, 0.95);
  const midGray = rgb(0.5, 0.5, 0.5);

  let page = pdfDoc.addPage([612, 792]);
  const W = 612;
  const MARGIN = 50;
  const CONTENT_WIDTH = W - MARGIN * 2;
  let y = 792;

  // Header bar
  page.drawRectangle({ x: 0, y: y - 80, width: W, height: 80, color: black });
  page.drawText('KUSHAWN', { x: MARGIN, y: y - 48, size: 26, font: bold, color: white });
  const siteLabel = 'kushawn.com';
  page.drawText(siteLabel, {
    x: W - MARGIN - regular.widthOfTextAtSize(siteLabel, 9),
    y: y - 48, size: 9, font: regular, color: rgb(0.55, 0.55, 0.55),
  });
  page.drawText(terms.title.toUpperCase(), { x: MARGIN, y: y - 68, size: 9, font: regular, color: rgb(0.55, 0.55, 0.55) });
  y -= 80;

  // Title
  y -= 28;
  page.drawText('INSTRUMENTAL LICENSE AGREEMENT', { x: MARGIN, y, size: 14, font: bold, color: black });
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: W - MARGIN, y }, thickness: 0.75, color: black });
  y -= 24;

  // Details
  const col2 = MARGIN + 140;
  const detailRows = [
    ['Effective Date:', purchaseDate],
    ['Licensor:', 'KUSHAWN (Rashaun Bennett)'],
    ['Licensee:', customerName],
    ['Beat Title:', `"${item.title}" - ${item.artist} Type Beat`],
    ['License Type:', terms.title],
    ['License Fee:', `$${item.effectivePrice ? item.effectivePrice.toFixed(2) : (item.price || '0.00')} CAD - one-time payment, no royalties`],
  ];
  for (const [label, value] of detailRows) {
    page.drawText(label, { x: MARGIN, y, size: 10, font: bold, color: black });
    const valLines = wrapText(value, regular, 10, W - col2 - MARGIN);
    for (let vi = 0; vi < valLines.length; vi++) {
      page.drawText(valLines[vi], { x: col2, y: y - vi * 15, size: 10, font: regular, color: black });
    }
    y -= Math.max(1, valLines.length) * 15 + 6;
  }
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: W - MARGIN, y }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
  y -= 18;

  // Summary box
  const summaryItems = [
    ['Max Streams', terms.streams],
    ['Max Copies', terms.copies],
    ['Music Videos', terms.videos],
    ['File Formats', terms.formats],
    ['Exclusive', terms.exclusive ? 'YES' : 'No'],
  ];
  const BOX_H = 72;
  page.drawRectangle({ x: MARGIN, y: y - BOX_H, width: CONTENT_WIDTH, height: BOX_H, color: lightGray });
  page.drawText('LICENSE RIGHTS SUMMARY', { x: MARGIN + 10, y: y - 14, size: 8, font: bold, color: midGray });
  const cellW = CONTENT_WIDTH / summaryItems.length;
  summaryItems.forEach(([lbl, val], i) => {
    const cx = MARGIN + i * cellW + 10;
    page.drawText(lbl, { x: cx, y: y - 32, size: 8, font: regular, color: midGray });
    page.drawText(val, { x: cx, y: y - 48, size: 10, font: bold, color: black });
  });
  y -= BOX_H + 22;

  // Terms
  page.drawText('TERMS AND CONDITIONS', { x: MARGIN, y, size: 11, font: bold, color: black });
  y -= 18;

  const addPageIfNeeded = () => {
    if (y < 90) {
      page = pdfDoc.addPage([612, 792]);
      y = 792 - 60;
    }
  };

  for (const line of terms.lines) {
    const wrapped = line ? wrapText(line, regular, 9.5, CONTENT_WIDTH) : [''];
    for (const wLine of wrapped) {
      addPageIfNeeded();
      const isBullet = /^\d+\./.test(wLine.trim());
      page.drawText(wLine, { x: MARGIN, y, size: 9.5, font: isBullet ? bold : regular, color: black });
      y -= 15;
    }
  }

  // Signatures
  y -= 20;
  addPageIfNeeded();
  page.drawLine({ start: { x: MARGIN, y }, end: { x: W - MARGIN, y }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
  y -= 22;
  page.drawText('AGREED AND ACCEPTED', { x: MARGIN, y, size: 10, font: bold, color: black });
  y -= 32;
  const half = (CONTENT_WIDTH - 40) / 2;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + half, y }, thickness: 0.5, color: black });
  page.drawText('KUSHAWN (Rashaun Bennett) - Licensor', { x: MARGIN, y: y - 14, size: 8, font: regular, color: midGray });
  page.drawText(`Date: ${purchaseDate}`, { x: MARGIN, y: y - 26, size: 8, font: regular, color: midGray });
  const sigX2 = MARGIN + half + 40;
  page.drawLine({ start: { x: sigX2, y }, end: { x: W - MARGIN, y }, thickness: 0.5, color: black });
  page.drawText(`${customerName} - Licensee`, { x: sigX2, y: y - 14, size: 8, font: regular, color: midGray });
  page.drawText('Date: _______________', { x: sigX2, y: y - 26, size: 8, font: regular, color: midGray });

  // Footer
  y -= 55;
  addPageIfNeeded();
  page.drawText('This agreement constitutes the entire agreement between the parties regarding the Beat. Governed by the laws of Ontario, Canada.',
    { x: MARGIN, y, size: 8, font: regular, color: midGray });
  y -= 13;
  page.drawText('Questions: contact@kushawn.com  |  kushawn.com', { x: MARGIN, y, size: 8, font: regular, color: midGray });

  const pdfBytes = await pdfDoc.save();
  return {
    filename: `KUSHAWN - ${item.title} - ${terms.title}.pdf`,
    content: Buffer.from(pdfBytes),
    contentType: 'application/pdf',
  };
};

// Purchase confirmation HTML email (customer-facing)
const generatePurchaseEmail = ({ customerName, orderId, purchaseDate, orderItems, totalPrice, downloadLink, paymentType }) => {
  const itemRows = orderItems.map(item => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #1c1c1c;">
        <div style="color:#fff;font-size:14px;font-weight:700;">${item.title}</div>
        <div style="color:#888;font-size:12px;margin-top:3px;">${item.artist} Type Beat &bull; ${item.licenseType} ${item.licenseType === 'Exclusive' ? 'License' : 'Lease'}</div>
      </td>
      <td style="padding:14px 0;border-bottom:1px solid #1c1c1c;text-align:right;color:#fff;font-size:14px;font-weight:700;white-space:nowrap;">
        $${item.effectivePrice ? item.effectivePrice.toFixed(2) : (item.price || '0.00')}
      </td>
    </tr>`).join('');

  const plural = orderItems.length > 1;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>KUSHAWN - Your Order</title></head>
<body style="margin:0;padding:0;background:#000;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000;">
<tr><td align="center" style="padding:40px 16px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
  <tr><td style="padding:32px 40px;background:#0a0a0a;border-bottom:1px solid #1a1a1a;">
    <div style="font-size:30px;font-weight:900;letter-spacing:5px;color:#fff;text-transform:uppercase;">KUSHAWN</div>
    <div style="font-size:10px;letter-spacing:3px;color:#555;margin-top:5px;text-transform:uppercase;">Official Receipt</div>
  </td></tr>
  <tr><td style="padding:40px 40px 24px;background:#0a0a0a;">
    <div style="font-size:22px;font-weight:700;color:#fff;margin-bottom:12px;">Your ${plural ? 'beats are' : 'beat is'} ready</div>
    <div style="font-size:14px;color:#888;line-height:1.7;">
      Hey ${customerName},<br/><br/>
      Your purchase is confirmed. Your ${plural ? 'beats are' : 'beat is'} available via the download link below (valid for 7 days).
      Your license contract${plural ? 's are' : ' is'} attached to this email as PDF${plural ? 's' : ''} - keep ${plural ? 'them' : 'it'} for your records.
    </div>
  </td></tr>
  <tr><td style="padding:24px 40px 40px;background:#0a0a0a;text-align:center;">
    <a href="${downloadLink}" style="display:inline-block;background:#fff;color:#000;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:18px 48px;text-decoration:none;border-radius:2px;">
      Download Your Beat${plural ? 's' : ''}
    </a>
    <div style="margin-top:12px;font-size:11px;color:#555;">Link expires in 7 days - Do not share this link</div>
  </td></tr>
  <tr><td style="padding:0 40px;background:#0a0a0a;"><div style="border-top:1px solid #1c1c1c;"></div></td></tr>
  <tr><td style="padding:32px 40px;background:#0a0a0a;">
    <div style="font-size:10px;letter-spacing:2px;color:#555;text-transform:uppercase;margin-bottom:16px;">Order Summary</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${itemRows}
      <tr>
        <td style="padding:18px 0 0;color:#666;font-size:13px;">Total Charged (${paymentType})</td>
        <td style="padding:18px 0 0;text-align:right;color:#fff;font-size:18px;font-weight:700;">$${parseFloat(totalPrice).toFixed(2)}</td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 40px 40px;background:#0a0a0a;">
    <div style="background:#111;border:1px solid #1e1e1e;border-radius:4px;padding:22px 24px;">
      <div style="color:#fff;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">Important</div>
      <ul style="color:#888;font-size:12px;line-height:2;margin:0;padding-left:18px;">
        <li>Credit all releases as <span style="color:#ccc;font-weight:700;">Prod. KUSHAWN</span></li>
        <li>License contract PDF attached - keep it for your records</li>
        <li>Order #: <span style="color:#bbb;">${orderId}</span></li>
        <li>Purchase date: <span style="color:#bbb;">${purchaseDate}</span></li>
      </ul>
    </div>
  </td></tr>
  <tr><td style="padding:24px 40px;background:#0a0a0a;border-top:1px solid #111;">
    <div style="font-size:11px;color:#444;line-height:2;">
      Questions? <a href="mailto:contact@kushawn.com" style="color:#666;text-decoration:none;">contact@kushawn.com</a><br/>
      <a href="https://kushawn.com" style="color:#666;text-decoration:none;">kushawn.com</a> &bull; Ontario, Canada
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
};

// Sale notification email (to artist)
const generateSaleNotification = ({ customerName, orderId, purchaseDate, orderItems, totalPrice, paymentType }) => {
  const lines = orderItems.map(i =>
    `<li>${i.title} - ${i.licenseType} ${i.licenseType === 'Exclusive' ? 'License' : 'Lease'} - $${i.effectivePrice ? i.effectivePrice.toFixed(2) : (i.price || '?')}</li>`
  ).join('');
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px;">
<h2 style="color:#fff;margin:0 0 16px;">New Sale - $${parseFloat(totalPrice).toFixed(2)} via ${paymentType}</h2>
<table cellpadding="6" cellspacing="0" style="font-size:14px;color:#ccc;">
  <tr><td style="color:#666;padding-right:20px;">Customer</td><td>${customerName}</td></tr>
  <tr><td style="color:#666;">Order ID</td><td>${orderId}</td></tr>
  <tr><td style="color:#666;">Date</td><td>${purchaseDate}</td></tr>
  <tr><td style="color:#666;">Payment</td><td>${paymentType}</td></tr>
</table>
<ul style="margin-top:20px;color:#aaa;font-size:13px;line-height:2;">${lines}</ul>
</body></html>`;
};

// ─── POST /api/email ──────────────────────────────────────────────────────────
app.post('/api/email', async (req, res) => {
  const { email, subject, template, data, message } = req.body;
  if (!email || !template) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_EMAIL, pass: process.env.GMAIL_EMAIL_PASSWORD },
    });

    if (template === 'purchaseConfirmation') {
      const { customerName, orderId, purchaseDate, orderItems, totalPrice, downloadLink, paymentType } = data;

      // Generate a PDF license for each beat in the order
      const attachments = [];
      for (const item of orderItems) {
        if (item.type === 'Beat') {
          try {
            const pdf = await generateLicensePdf(item, customerName, purchaseDate);
            attachments.push(pdf);
          } catch (pdfErr) {
            console.error(`PDF generation failed for "${item.title}":`.red, pdfErr.message);
          }
        }
      }

      // Email to customer
      await transporter.sendMail({
        from: `"KUSHAWN" <${process.env.GMAIL_EMAIL}>`,
        to: email,
        subject: `KUSHAWN | Your Beat Download (Order #${orderId.slice(0, 8)}) - 7-Day Access`,
        html: generatePurchaseEmail({ customerName, orderId, purchaseDate, orderItems, totalPrice, downloadLink, paymentType }),
        attachments,
      });

      // Notification to artist
      await transporter.sendMail({
        from: `"KUSHAWN Store" <${process.env.GMAIL_EMAIL}>`,
        to: process.env.GMAIL_EMAIL,
        subject: `New Sale - $${parseFloat(totalPrice).toFixed(2)} (${paymentType})`,
        html: generateSaleNotification({ customerName, orderId, purchaseDate, orderItems, totalPrice, paymentType }),
      });

      console.log(`Purchase email sent to ${email} (order: ${orderId}, PDFs: ${attachments.length})`.green);
      return res.status(200).json({ message: 'Email sent successfully' });
    }

    // Contact form
    const emails = generateContactEmails({ email, subject, message });
    if (!emails) return res.status(500).json({ error: 'Failed to generate contact emails' });
    await transporter.sendMail(emails.mailToSelf);
    await transporter.sendMail(emails.mailToUser);
    console.log(`Contact email sent from ${email}`.green);
    return res.status(200).json({ message: 'Email sent successfully' });

  } catch (err) {
    console.error('Email send error:'.red, err);
    res.status(500).json({ error: 'Failed to send email', details: err.message });
  }
});

// ─── POST /api/coupons/validate ───────────────────────────────────────────────
app.post('/api/coupons/validate', async (req, res) => {
  const { code, subtotal } = req.body;
  try {
    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('is_active', true)
      .single();
    if (error || !coupon) return res.status(404).json({ error: 'Coupon not found' });

    const now = new Date();
    if (now < new Date(coupon.valid_from) || now > new Date(coupon.valid_until))
      return res.status(400).json({ error: 'Coupon expired' });
    if (coupon.max_uses !== null && coupon.current_uses >= coupon.max_uses)
      return res.status(400).json({ error: 'Coupon usage limit reached' });
    if (subtotal < coupon.min_order_amount)
      return res.status(400).json({ error: 'Minimum order amount not met' });

    res.json({ discountType: coupon.discount_type, discountValue: coupon.discount_value });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/paypal/create-order ────────────────────────────────────────────
app.post('/api/paypal/create-order', async (req, res) => {
  const { cartItems, customerInfo, couponCode, subscribeToNewsletter } = req.body;
  const newOrderId = generateOrderId();

  let countryCode = customerInfo.country;
  if (!/^[A-Z]{2}$/.test(customerInfo.country)) {
    const country = iso3166.whereCountry(customerInfo.country);
    if (!country) return res.status(400).json({ error: 'Invalid country name or code' });
    countryCode = country.alpha2;
  } else {
    const country = iso3166.whereAlpha2(customerInfo.country);
    if (!country) return res.status(400).json({ error: 'Invalid country code' });
  }

  try {
    if (!customerInfo.email || !customerInfo.name) throw new Error('Missing customerInfo fields');

    await supabase.from('customers').upsert(
      { email: customerInfo.email, name: customerInfo.name, address: customerInfo.address, city: customerInfo.city, state: customerInfo.state, zip: customerInfo.zip, country: customerInfo.country },
      { onConflict: 'email' }
    );

    let { validatedItems, subtotal } = await validateCartItems(cartItems);
    validatedItems = applyBogo(validatedItems);
    let afterBogo = validatedItems.reduce((sum, item) => sum + item.effectivePrice, 0);

    let couponDisc = 0;
    if (couponCode) {
      const { data: coupon } = await supabase.from('coupons').select('*').eq('code', couponCode.toUpperCase()).eq('is_active', true).single();
      if (!coupon) throw new Error('Coupon not found');
      const now = new Date();
      if (now < new Date(coupon.valid_from) || now > new Date(coupon.valid_until)) throw new Error('Coupon expired');
      if (coupon.max_uses !== null && coupon.current_uses >= coupon.max_uses) throw new Error('Coupon usage limit reached');
      if (subtotal < coupon.min_order_amount) throw new Error('Minimum order amount not met');
      couponDisc = coupon.discount_type === 'fixed' ? coupon.discount_value : (afterBogo * coupon.discount_value) / 100;
    }

    const factor = afterBogo > 0 ? (afterBogo - couponDisc) / afterBogo : 0;
    validatedItems.forEach((item) => { item.displayPrice = item.effectivePrice * factor; });
    let finalTotal = Math.floor(validatedItems.reduce((sum, item) => sum + item.displayPrice, 0) * 100) / 100;

    const paypalClient = makePaypalClient();
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: finalTotal,
          breakdown: {
            item_total: { currency_code: 'USD', value: afterBogo.toFixed(2) },
            discount: { currency_code: 'USD', value: couponDisc.toFixed(2) },
          },
        },
        items: validatedItems.map((item) => ({
          name: `${item.title} (${item.licenseType === 'Exclusive' ? `${item.licenseType} License` : `${item.licenseType} Lease`})`,
          unit_amount: { currency_code: 'USD', value: item.effectivePrice.toFixed(2) },
          quantity: 1,
        })),
        custom_id: `${newOrderId}|${couponCode || ''}|${subscribeToNewsletter ? 'true' : 'false'}`,
        shipping: {
          address: {
            address_line_1: customerInfo.address,
            admin_area_2: customerInfo.city,
            admin_area_1: customerInfo.state,
            postal_code: customerInfo.zip,
            country_code: countryCode,
          },
        },
      }],
      application_context: {
        return_url: `${process.env.APP_BASE_URL}/download?orderId=${newOrderId}`,
        cancel_url: `${process.env.APP_BASE_URL}/checkout`,
        shipping_preference: 'SET_PROVIDED_ADDRESS',
        user_action: 'PAY_NOW',
        brand_name: 'KUSHAWN',
      },
      payer: {
        name: {
          given_name: customerInfo.name.split(' ')[0],
          surname: customerInfo.name.split(' ').slice(1).join(' ') || 'Customer',
        },
        email_address: customerInfo.email,
        address: {
          address_line_1: customerInfo.address,
          admin_area_2: customerInfo.city,
          admin_area_1: customerInfo.state,
          postal_code: customerInfo.zip,
          country_code: countryCode,
        },
      },
    });

    const response = await paypalClient.execute(request);
    res.json({ orderId: response.result.id });
  } catch (err) {
    console.error('PayPal create order error:'.red, err);
    res.status(500).json({ error: 'Failed to create PayPal order' });
  }
});

// ─── POST /api/paypal/capture-order ──────────────────────────────────────────
app.post('/api/paypal/capture-order', async (req, res) => {
  const { orderId, cartItems, customerInfo } = req.body;
  try {
    let { validatedItems, subtotal } = await validateCartItems(cartItems);
    validatedItems = applyBogo(validatedItems);

    const paypalClient = makePaypalClient();
    const orderDetails = await paypalClient.execute(new paypal.orders.OrdersGetRequest(orderId));
    const [, couponCode, subscribeToNewsletter] = orderDetails.result.purchase_units[0].custom_id.split('|');

    const afterBogo = validatedItems.reduce((sum, item) => sum + item.effectivePrice, 0);
    let couponDisc = 0;
    let coupon = null;
    if (couponCode) {
      const { data: c } = await supabase.from('coupons').select('*').eq('code', couponCode.toUpperCase()).single();
      coupon = c;
      if (!coupon) throw new Error('Invalid coupon');
      couponDisc = coupon.discount_type === 'fixed' ? coupon.discount_value : (afterBogo * coupon.discount_value) / 100;
    }
    const finalTotal = Math.floor((afterBogo - couponDisc) * 100) / 100;

    if (
      orderDetails.result.status !== 'APPROVED' ||
      parseFloat(orderDetails.result.purchase_units[0].amount.value) !== parseFloat(finalTotal)
    ) throw new Error('Invalid order or amount mismatch');

    const captureRequest = new paypal.orders.OrdersCaptureRequest(orderId);
    captureRequest.prefer('return=representation');
    const capture = await paypalClient.execute(captureRequest);

    if (capture.result.status === 'COMPLETED') {
      const discountFactor = couponCode && afterBogo > 0 ? (afterBogo - couponDisc) / afterBogo : 1;
      const finalItems = validatedItems.map((item) => ({ ...item, effectivePrice: item.effectivePrice * discountFactor }));

      const orderItems = await Promise.all(
        finalItems.map(async (item) => {
          if (item.type === 'Beat' && item.licenseType === 'Exclusive') {
            await supabase.from('beats').update({ available: false }).eq('id', item.beatId);
          }
          const ext = item.s3_file_url.split('.').pop();
          const filename = item.type === 'Beat'
            ? `${item.title} (Prod. KUSHAWN).${ext}`
            : `${item.title}.${ext}`;
          return {
            ...item,
            price: item.effectivePrice.toFixed(2),
            s3_file_url: await getPresignedUrl(item.s3_file_url, 3600 * 24 * 7, filename),
          };
        })
      );

      await supabase.from('orders').insert({
        order_id: orderId,
        payment_type: 'PayPal',
        paypal_order_id: orderId,
        customer_info: customerInfo,
        items: orderItems,
        total_price: parseFloat(finalTotal.toFixed(2)),
      });

      const purchaseDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      await fetch(`${process.env.VITE_API_BASE_URL_BACKEND}/api/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: customerInfo.email,
          subject: `KUSHAWN | Your Beat Download (Order #${orderId.slice(0, 8)}) - 7-Day Access`,
          purchaseDate,
          template: 'purchaseConfirmation',
          data: {
            customerName: customerInfo.name,
            orderId,
            purchaseDate,
            orderItems,
            totalPrice: finalTotal.toFixed(2),
            downloadLink: `${process.env.APP_BASE_URL}/download?orderId=${orderId}`,
            paymentType: 'PayPal',
          },
        }),
      });

      if (couponCode && coupon) {
        await supabase.rpc('increment_coupon_uses', { coupon_code: couponCode.toUpperCase() });
      }

      if (subscribeToNewsletter === 'true') {
        await addToMailerLite(customerInfo.email, customerInfo.name);
      }

      res.json({
        status: 'success',
        orderId,
        items: orderItems.map((item) => ({
          title: item.title,
          artist: item.artist,
          imageUrl: item.s3_image_url,
          licenseType: item.licenseType,
          effectivePrice: item.effectivePrice,
        })),
      });
    } else {
      res.status(400).json({ error: 'Payment not completed' });
    }
  } catch (err) {
    console.error('PayPal capture error:'.red, err);
    res.status(500).json({ error: 'Failed to capture PayPal order' });
  }
});

// ─── POST /api/stripe/create-checkout-session ────────────────────────────────
app.post('/api/stripe/create-checkout-session', async (req, res) => {
  const { cartItems, customerInfo, couponCode, subscribeToNewsletter } = req.body;

  let countryCode = customerInfo.country;
  if (!/^[A-Z]{2}$/.test(customerInfo.country)) {
    const country = iso3166.whereCountry(customerInfo.country);
    if (!country) return res.status(400).json({ error: 'Invalid country name or code' });
    countryCode = country.alpha2;
  } else {
    const country = iso3166.whereAlpha2(customerInfo.country);
    if (!country) return res.status(400).json({ error: 'Invalid country code' });
  }

  await supabase.from('customers').upsert(
    { email: customerInfo.email, name: customerInfo.name, address: customerInfo.address, city: customerInfo.city, state: customerInfo.state, zip: customerInfo.zip, country: customerInfo.country },
    { onConflict: 'email' }
  );

  try {
    let { validatedItems } = await validateCartItems(cartItems);
    validatedItems = applyBogo(validatedItems);

    let stripeCouponId = null;
    if (couponCode) {
      const { data: coupon } = await supabase.from('coupons').select('*').eq('code', couponCode.toUpperCase()).eq('is_active', true).single();
      if (coupon) {
        try {
          const existing = await stripe.coupons.retrieve(coupon.code);
          stripeCouponId = existing.id;
        } catch (e) {
          if (e.code === 'resource_missing') {
            const params = { id: coupon.code, currency: 'usd', duration: 'once' };
            if (coupon.discount_type === 'percentage') params.percent_off = coupon.discount_value;
            else params.amount_off = Math.round(coupon.discount_value * 100);
            const created = await stripe.coupons.create(params);
            stripeCouponId = created.id;
          } else throw e;
        }
      }
    }

    const newOrderId = generateOrderId();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: validatedItems.map((item) => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${item.title} (${item.licenseType === 'Exclusive' ? `${item.licenseType} License` : `${item.licenseType} Lease`})`,
            images: [item.s3_image_url],
            description: item.type === 'Beat' ? `${item.artist} Type Beat` : item.licenseType,
          },
          unit_amount: Math.round(item.effectivePrice * 100),
        },
        quantity: 1,
      })),
      mode: 'payment',
      success_url: `${process.env.APP_BASE_URL}/download?orderId=${newOrderId}`,
      cancel_url: `${process.env.APP_BASE_URL}/checkout`,
      customer_email: customerInfo.email,
      client_reference_id: newOrderId,
      discounts: stripeCouponId ? [{ coupon: stripeCouponId }] : [],
      metadata: {
        orderId: newOrderId,
        cartItems: JSON.stringify(validatedItems.map((item) => ({ beatId: item.beatId, type: item.type, licenseType: item.licenseType }))),
        customerInfo: JSON.stringify({ name: customerInfo.name, email: customerInfo.email, address: customerInfo.address, city: customerInfo.city, state: customerInfo.state, zip: customerInfo.zip, country: countryCode }),
        couponCode: couponCode || '',
        subscribeToNewsletter: subscribeToNewsletter ? 'true' : 'false',
      },
    });

    res.json({ sessionId: session.id });
  } catch (err) {
    console.error('Stripe checkout session error:'.red, err);
    res.status(500).json({ error: 'Failed to create Checkout Session' });
  }
});

// ─── GET /download ────────────────────────────────────────────────────────────
app.get('/download', async (req, res) => {
  const { orderId } = req.query;
  try {
    const { data: order, error } = await supabase.from('orders').select('*').eq('order_id', orderId).single();
    if (error || !order) return res.status(404).json({ error: 'Order not found' });

    const diffDays = (new Date() - new Date(order.created_at)) / (1000 * 60 * 60 * 24);
    if (diffDays > 7) return res.status(403).json({ error: 'Download link expired' });

    const itemsWithDetails = await Promise.all(
      order.items.map(async (item) => {
        if (item.type === 'Beat') {
          const { data: beat } = await supabase.from('beats').select('s3_image_url, bpm, key').eq('id', item.beatId).single();
          const imageKey = beat?.s3_image_url?.startsWith('s3://')
            ? beat.s3_image_url.replace(/^s3:\/\/[^/]+\//, '')
            : beat?.s3_image_url ?? null;
          return { ...item, downloadUrl: item.s3_file_url, s3_image_url: imageKey, bpm: beat?.bpm ?? null, key: beat?.key ?? null };
        } else if (item.type === 'Pack') {
          const { data: pack } = await supabase.from('packs').select('s3_image_url, licenses').eq('id', item.beatId).single();
          const imageKey = pack?.s3_image_url?.startsWith('s3://')
            ? pack.s3_image_url.replace(/^s3:\/\/[^/]+\//, '')
            : pack?.s3_image_url ?? null;
          const license = pack?.licenses?.find((l) => l.type === item.licenseType);
          const fileKey = license?.s3_file_url?.startsWith('s3://')
            ? license.s3_file_url.replace(/^s3:\/\/[^/]+\//, '')
            : license?.s3_file_url ?? null;
          return {
            ...item,
            downloadUrl: fileKey ? await getPresignedUrl(fileKey, 3600 * 24 * 7) : item.s3_file_url,
            s3_image_url: imageKey,
            bpm: null,
            key: null,
          };
        }
      })
    );

    const imageUrls = await Promise.all(
      itemsWithDetails.map((item) =>
        item.s3_image_url ? getPresignedUrl(item.s3_image_url, 3600 * 24 * 7) : null
      )
    );

    res.json({
      orderId,
      customerName: order.customer_info?.name,
      customerEmail: order.customer_info?.email,
      items: itemsWithDetails.map((item, i) => ({ ...item, imageUrl: imageUrls[i] })),
      totalPrice: order.total_price,
    });
  } catch (err) {
    console.error('Download error:'.red, err);
    res.status(500).json({ error: 'Failed to retrieve download' });
  }
});

// ─── GET /beat (public single beat) ──────────────────────────────────────────
app.get('/beat', async (req, res) => {
  const { beatId } = req.query;
  try {
    const { data: beat, error } = await supabase.from('beats').select('*').eq('id', beatId).single();
    if (error || !beat) return res.status(404).json({ error: 'Beat not found' });
    beat.s3_mp3_url = await getPresignedUrl(beat.s3_mp3_url, 3600 * 24 * 7);
    beat.s3_image_url = beat.s3_image_url ? await getPresignedUrl(beat.s3_image_url, 3600 * 24 * 7) : null;
    beat.licenses = beat.licenses.map((lic) => ({ ...lic, s3_file_url: null }));
    res.json(beat);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve beat' });
  }
});

// ─── PUT /beat (update availability) ─────────────────────────────────────────
app.put('/beat', async (req, res) => {
  const { beatId } = req.query;
  if (!beatId) return res.status(400).json({ error: 'Beat ID is required' });
  try {
    const { data: existing, error: fetchErr } = await supabase.from('beats').select('*').eq('id', beatId).single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Beat not found' });

    const u = req.body;
    const { data: beat, error } = await supabase
      .from('beats')
      .update({
        title: u.title || existing.title,
        artist: u.artist || existing.artist,
        duration: u.duration || existing.duration,
        bpm: u.bpm !== undefined ? u.bpm : existing.bpm,
        key: u.key || existing.key,
        tags: u.tags || existing.tags,
        available: u.available !== undefined ? u.available : existing.available,
      })
      .eq('id', beatId)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(beat);
  } catch (error) {
    res.status(500).json({ error: `Failed to update beat: ${error.message}` });
  }
});

// ─── GET /related-beats ───────────────────────────────────────────────────────
app.get('/related-beats', async (req, res) => {
  const { tags, excludeBeatId } = req.query;
  if (!tags) return res.status(400).json({ error: 'Tags parameter is required.' });

  const tagArray = tags.split(',').map((t) => t.trim()).filter(Boolean);
  if (!tagArray.length) return res.json([]);

  try {
    const { data: relatedBeats, error } = await supabase
      .from('beats')
      .select('*')
      .overlaps('tags', tagArray)
      .neq('id', excludeBeatId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    for (const beat of relatedBeats) {
      if (beat.s3_mp3_url) beat.s3_mp3_url = await getPresignedUrl(beat.s3_mp3_url, 3600);
      if (beat.s3_image_url) beat.s3_image_url = await getPresignedUrl(beat.s3_image_url, 3600 * 24 * 7);
      if (beat.licenses) beat.licenses = beat.licenses.map((lic) => ({ ...lic, s3_file_url: null }));
    }

    res.json(relatedBeats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve related beats' });
  }
});

// ─── POST /api/admin-login ────────────────────────────────────────────────────
app.post('/api/admin-login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password' });
    res.json({ message: 'Admin login successful', user: { name: 'KUSHAWN', email: data.user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to login' });
  }
});

// ─── GET /api/orders ──────────────────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000;
    const { data: orders, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ─── GET /api/packs ───────────────────────────────────────────────────────────
app.get('/api/packs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    let search = req.query.search || '';
    const skip = (page - 1) * limit;

    let query = supabase.from('packs').select('*', { count: 'exact' }).eq('available', true).order('created_at', { ascending: false }).range(skip, skip + limit - 1);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

    const { data: packsList, count: totalPacks, error } = await query;
    if (error) throw error;

    for (const pack of packsList) {
      pack.s3_mp3_url = await getPresignedUrl(pack.s3_mp3_url, 3600 * 24 * 7);
      pack.s3_image_url = pack.s3_image_url ? await getPresignedUrl(pack.s3_image_url, 3600 * 24 * 7) : null;
      pack.licenses = pack.licenses.map((lic) => ({ ...lic, s3_file_url: null }));
    }

    res.json({ packs: packsList, page, totalPages: Math.ceil(totalPacks / limit), totalPacks });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/beatpacks ───────────────────────────────────────────────────────
app.get('/api/beatpacks', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    let search = req.query.search || '';
    const skip = (page - 1) * limit;

    let query = supabase.from('beat_packs').select('*', { count: 'exact' }).eq('available', true).order('created_at', { ascending: false }).range(skip, skip + limit - 1);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

    const { data: beatPacksList, count: totalPacks, error } = await query;
    if (error) throw error;

    for (const pack of beatPacksList) {
      pack.s3_mp3_url = await getPresignedUrl(pack.s3_mp3_url, 3600 * 24 * 7);
      pack.s3_image_url = pack.s3_image_url ? await getPresignedUrl(pack.s3_image_url, 3600 * 24 * 7) : null;
      pack.licenses = pack.licenses.map((lic) => ({ ...lic, s3_file_url: null }));
    }

    res.json({ packs: beatPacksList, page, totalPages: Math.ceil(totalPacks / limit), totalPacks });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /beat-pack ───────────────────────────────────────────────────────────
app.get('/beat-pack', async (req, res) => {
  const { packId } = req.query;
  try {
    const { data: pack, error } = await supabase.from('beat_packs').select('*').eq('id', packId).single();
    if (error || !pack) return res.status(404).json({ error: 'Beat pack not found' });
    pack.s3_mp3_url = await getPresignedUrl(pack.s3_mp3_url, 604800);
    pack.s3_image_url = pack.s3_image_url ? await getPresignedUrl(pack.s3_image_url, 604800) : null;
    pack.licenses = pack.licenses.map((lic) => ({ ...lic, s3_file_url: null }));
    res.json(pack);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve beat pack' });
  }
});

// ─── GET /pack ────────────────────────────────────────────────────────────────
app.get('/pack', async (req, res) => {
  const { packId } = req.query;
  try {
    const { data: pack, error } = await supabase.from('packs').select('*').eq('id', packId).single();
    if (error || !pack) return res.status(404).json({ error: 'Pack not found' });
    pack.s3_mp3_url = await getPresignedUrl(pack.s3_mp3_url, 3600 * 24 * 7);
    pack.s3_image_url = pack.s3_image_url ? await getPresignedUrl(pack.s3_image_url, 3600 * 24 * 7) : null;
    pack.licenses = pack.licenses.map((lic) => ({ ...lic, s3_file_url: null }));
    res.json(pack);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve pack' });
  }
});

// ─── POST /api/create-beat ────────────────────────────────────────────────────
app.post('/api/create-beat', async (req, res) => {
  try {
    const { data: beat, error } = await supabase.from('beats').insert(req.body).select().single();
    if (error) throw error;
    res.json(beat);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create beat' });
  }
});

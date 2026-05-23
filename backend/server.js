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
import emailRouter from './api/email.js';
import emailTestRouter from './api/emailTest.js';
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
            ? `${item.title} (Prod Birdie Bands).${ext}`
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
          subject: `Birdie Bands | Download Your Beat (Order #${orderId.slice(0, 4)}...) – 7-Day Access`,
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

// ─── Email ────────────────────────────────────────────────────────────────────
app.use('/api/email', emailRouter);
app.use('/api/emailTest', emailTestRouter);

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
      `(www.BirdieBands.com) - ${beat.title} [${beat.bpm} BPM - ${beat.key}] [Prod Birdie Bands].mp3`
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
        brand_name: 'Birdie Bands',
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
            ? `${item.title} (Prod Birdie Bands).${ext}`
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
          subject: `Birdie Bands | Download Your Beat (Order #${orderId.slice(0, 4)}...) – 7-Day Access`,
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

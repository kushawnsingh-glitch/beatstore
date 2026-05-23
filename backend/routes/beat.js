// backend/routes/beat.js
import express from 'express';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'application/zip'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, MP3, and ZIP are allowed.'));
  },
});

// ─── POST /api/upload ─────────────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { file } = req;
    const { type, title } = req.body;
    const year = new Date().getFullYear();

    if (!file || !type || !title) {
      return res.status(400).json({ error: 'File, type, and title are required.' });
    }

    const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    if (!sanitizedTitle) return res.status(400).json({ error: 'Invalid or empty title.' });

    let storagePath;
    switch (type) {
      case 'image':       storagePath = `beats/${year}-beats/${sanitizedTitle}/image/${file.originalname}`; break;
      case 'tagged_mp3':  storagePath = `beats/${year}-beats/${sanitizedTitle}/tagged/${file.originalname}`; break;
      case 'basic_mp3':   storagePath = `beats/${year}-beats/${sanitizedTitle}/basic/${file.originalname}`; break;
      case 'premium_zip': storagePath = `beats/${year}-beats/${sanitizedTitle}/premium/${file.originalname}`; break;
      case 'pro_zip':     storagePath = `beats/${year}-beats/${sanitizedTitle}/stems/${file.originalname}`; break;
      default: return res.status(400).json({ error: 'Invalid file type.' });
    }

    const { error } = await supabase.storage
      .from('beats')
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });

    if (error) throw error;

    res.json({ url: storagePath });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload file.' });
  }
});

// ─── POST /api/beat ───────────────────────────────────────────────────────────
router.post('/beat', async (req, res) => {
  try {
    const { title, artist, duration, bpm, key, tags, s3_mp3_url, s3_image_url, licenses, available, type, youtube_url } = req.body;

    if (!title || !artist || !duration || !bpm || !key || !s3_mp3_url || !s3_image_url || !licenses) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const validLicenseTypes = ['Basic', 'Premium', 'Professional', 'Legacy', 'Exclusive'];
    const hasValidLicenses = licenses.every(
      (l) => validLicenseTypes.includes(l.type) && l.price >= 0 && l.currency === 'USD' && l.description &&
             (l.type === 'Basic' || l.type === 'Premium' || l.s3_file_url)
    );
    if (!hasValidLicenses) return res.status(400).json({ error: 'Invalid license configuration.' });

    if (youtube_url !== undefined && youtube_url !== null && typeof youtube_url !== 'string') {
      return res.status(400).json({ error: 'Invalid format for youtube_url.' });
    }

    const { data: beat, error } = await supabase
      .from('beats')
      .insert({
        title, artist, duration,
        bpm: parseInt(bpm),
        key,
        tags: tags || [],
        s3_mp3_url, s3_image_url, licenses,
        available: available !== undefined ? available : true,
        type: type || 'Beat',
        youtube_url: youtube_url || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(beat);
  } catch (error) {
    console.error('Create beat error:', error);
    res.status(500).json({ error: error.message || 'Failed to create beat.' });
  }
});

// ─── PUT /api/beat ────────────────────────────────────────────────────────────
router.put('/beat', async (req, res) => {
  try {
    const beatId = req.query.beatId;
    if (!beatId) return res.status(400).json({ error: 'Invalid or missing beatId.' });

    const { title, artist, duration, bpm, key, tags, s3_mp3_url, s3_image_url, licenses, available, type, youtube_url } = req.body;

    if (!title || !artist || !duration || !bpm || !key || !s3_mp3_url || !s3_image_url || !licenses) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const validLicenseTypes = ['Basic', 'Premium', 'Professional', 'Legacy', 'Exclusive'];
    const hasValidLicenses = licenses.every(
      (l) => validLicenseTypes.includes(l.type) && l.price >= 0 && l.currency === 'USD' && l.description &&
             (l.type === 'Basic' || l.type === 'Premium' || l.s3_file_url)
    );
    if (!hasValidLicenses) return res.status(400).json({ error: 'Invalid license configuration.' });

    if (youtube_url && typeof youtube_url !== 'string') {
      return res.status(400).json({ error: 'Invalid format for youtube_url.' });
    }

    const { data: updatedBeat, error } = await supabase
      .from('beats')
      .update({
        title, artist, duration,
        bpm: parseInt(bpm),
        key,
        tags: tags || [],
        s3_mp3_url, s3_image_url, licenses,
        available: available !== undefined ? available : true,
        type: type || 'Beat',
        youtube_url: youtube_url ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', beatId)
      .select()
      .single();

    if (error) throw error;
    if (!updatedBeat) return res.status(404).json({ error: 'Beat not found.' });

    res.status(200).json(updatedBeat);
  } catch (error) {
    console.error('Update beat error:', error);
    res.status(500).json({ error: error.message || 'Failed to update beat.' });
  }
});

// ─── GET /api/beat (admin preview with signed URLs) ───────────────────────────
router.get('/beat', async (req, res) => {
  try {
    const { beatId } = req.query;
    if (!beatId) return res.status(400).json({ error: 'Invalid or missing beatId.' });

    const { data: beat, error } = await supabase.from('beats').select('*').eq('id', beatId).single();
    if (error || !beat) return res.status(404).json({ error: 'Beat not found.' });

    const sign = async (path) => {
      if (!path) return null;
      const clean = path.startsWith('s3://') ? path.replace(/^s3:\/\/[^/]+\//, '') : path;
      const { data } = await supabase.storage.from('beats').createSignedUrl(clean, 3600 * 24 * 7);
      return data?.signedUrl ?? null;
    };

    res.status(200).json({
      beat,
      beatTagged: await sign(beat.s3_mp3_url),
      imagePreview: await sign(beat.s3_image_url),
    });
  } catch (error) {
    console.error('Get beat error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch beat.' });
  }
});

// ─── PUT /api/bulk-update-prices ──────────────────────────────────────────────
router.put('/bulk-update-prices', async (req, res) => {
  try {
    const { prices } = req.body;
    if (!prices || typeof prices !== 'object') {
      return res.status(400).json({ error: 'prices object is required' });
    }

    const validTypes = ['Basic', 'Premium', 'Professional', 'Legacy', 'Exclusive'];
    for (const [type, price] of Object.entries(prices)) {
      if (!validTypes.includes(type)) continue;
      if (typeof price !== 'number' || price < 0) {
        return res.status(400).json({ error: `Invalid price for ${type}` });
      }
    }

    const { error } = await supabase.rpc('bulk_update_beat_license_prices', { prices });
    if (error) throw error;

    res.json({ message: 'Prices updated successfully' });
  } catch (err) {
    console.error('Bulk price update error:', err);
    res.status(500).json({ error: 'Server error during bulk update' });
  }
});

export default router;

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'jotips2024';
const DATA_FILE = path.join(__dirname, 'tips.json');
const COMMENTS_FILE = path.join(__dirname, 'comments.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 6) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) || allowed.test(file.mimetype);
    cb(null, ok);
  }
});

app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

function loadTips() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch (e) { console.error('Load error:', e); } return [];
}
function saveTips(tips) { fs.writeFileSync(DATA_FILE, JSON.stringify(tips, null, 2), 'utf-8'); }

function loadComments() {
  try { if (fs.existsSync(COMMENTS_FILE)) return JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf-8')); }
  catch (e) { console.error('Load error:', e); } return [];
}
function saveComments(comments) { fs.writeFileSync(COMMENTS_FILE, JSON.stringify(comments, null, 2), 'utf-8'); }

function loadImages() {
  try {
    const files = fs.readdirSync(UPLOADS_DIR).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
    return files.sort().reverse();
  } catch (e) { return []; }
}

function adminAuth(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Tips
app.get('/api/tips', (req, res) => { res.json(loadTips().reverse()); });

app.post('/api/tips', adminAuth, (req, res) => {
  const { name, date, company, code, odds, result, note } = req.body;
  if (!name || !date || !company || !code) return res.status(400).json({ error: 'Missing required fields' });
  const tips = loadTips();
  const tip = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, date, company, code,
    odds: odds || '',
    result: result || 'pending',
    note: note || '',
    created: new Date().toISOString()
  };
  tips.push(tip); saveTips(tips);
  res.json({ success: true, tip });
});

app.put('/api/tips/:id', adminAuth, (req, res) => {
  const tips = loadTips();
  const idx = tips.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  tips[idx] = { ...tips[idx], ...req.body, id: tips[idx].id, created: tips[idx].created };
  saveTips(tips);
  res.json({ success: true, tip: tips[idx] });
});

app.delete('/api/tips/:id', adminAuth, (req, res) => {
  let tips = loadTips();
  const idx = tips.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  tips.splice(idx, 1); saveTips(tips);
  res.json({ success: true });
});

// Comments
app.get('/api/comments/all', adminAuth, (req, res) => { res.json(loadComments()); });

app.get('/api/comments/:tipId', (req, res) => {
  res.json(loadComments().filter(c => c.tipId === req.params.id).reverse());
});

app.post('/api/comments/:tipId', (req, res) => {
  const { author, text } = req.body;
  if (!author || !text) return res.status(400).json({ error: 'Missing fields' });
  const comments = loadComments();
  const comment = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    tipId: req.params.tipId,
    author: author.trim().slice(0, 30),
    text: text.trim().slice(0, 500),
    created: new Date().toISOString()
  };
  comments.push(comment); saveComments(comments);
  res.json({ success: true, comment });
});

app.delete('/api/comments/:id', adminAuth, (req, res) => {
  let comments = loadComments();
  const idx = comments.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  comments.splice(idx, 1); saveComments(comments);
  res.json({ success: true });
});

// Images
app.get('/api/images', (req, res) => { res.json(loadImages()); });

app.post('/api/images', adminAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded. Max 5MB. jpg/png/gif/webp only.' });
  res.json({ success: true, filename: req.file.filename });
});

app.delete('/api/images/:filename', adminAuth, (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// Analytics
const ANALYTICS_FILE = path.join(__dirname, 'analytics.json');

function loadAnalytics() {
  try { if (fs.existsSync(ANALYTICS_FILE)) return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8')); }
  catch (e) {} return { views: 0, tipViews: {} };
}
function saveAnalytics(a) { fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(a, null, 2), 'utf-8'); }

app.get('/api/analytics', (req, res) => { res.json(loadAnalytics()); });

app.post('/api/analytics/view', (req, res) => {
  const a = loadAnalytics(); a.views = (a.views || 0) + 1; saveAnalytics(a);
  res.json({ success: true, views: a.views });
});

app.post('/api/analytics/tip-view/:id', (req, res) => {
  const a = loadAnalytics(); if (!a.tipViews) a.tipViews = {};
  const id = req.params.id; a.tipViews[id] = (a.tipViews[id] || 0) + 1; saveAnalytics(a);
  res.json({ success: true });
});

if (!fs.existsSync(DATA_FILE)) saveTips([]);
if (!fs.existsSync(COMMENTS_FILE)) saveComments([]);
if (!fs.existsSync(ANALYTICS_FILE)) saveAnalytics({ views: 0, tipViews: {} });

app.listen(PORT, () => console.log(`JOTIPS server on port ${PORT}`));

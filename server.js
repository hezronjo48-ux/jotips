process.on('uncaughtException', e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
process.on('unhandledRejection', e => { console.error('FATAL REJECTION:', e.message); });

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'jotips2024';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'tips.json');
const COMMENTS_FILE = path.join(__dirname, 'comments.json');
const ANALYTICS_FILE = path.join(__dirname, 'analytics.json');
const LINKS_FILE = path.join(__dirname, 'links.json');

try {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (e) { console.error('Uploads dir error:', e.message); }

// GitHub token from env
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// Multer
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 6) + ext);
  }
});
const upload = multer({
  storage, limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()) || allowed.test(file.mimetype));
  }
});

app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// GitHub sync
let syncTimer = null;

function syncGitHub() {
  if (!GITHUB_TOKEN) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const { exec } = require('child_process');
    const remoteUrl = 'https://hezronjo48-ux:' + GITHUB_TOKEN + '@github.com/hezronjo48-ux/jotips.git';
    exec('git add -A && git -c user.name="jotips-bot" -c user.email="jotips@bot.com" commit --allow-empty -m "Auto-sync data" && git push "' + remoteUrl + '" master', {
      cwd: __dirname, timeout: 15000,
    }, (err) => {
      if (err) {
        if (err.message.indexOf('nothing to commit') >= 0) return;
        console.error('Git sync error:', err.message.slice(0, 200));
      } else console.log('Git sync OK');
    });
  }, 2000);
}

// Helpers
function loadTips() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch (e) {}
  return [];
}
function saveTips(data, s) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8'); if (s !== false) syncGitHub(); }

function loadComments() {
  try { if (fs.existsSync(COMMENTS_FILE)) return JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf-8')); } catch (e) {}
  return [];
}
function saveComments(data, s) { fs.writeFileSync(COMMENTS_FILE, JSON.stringify(data, null, 2), 'utf-8'); if (s !== false) syncGitHub(); }

function loadAnalytics() {
  try { if (fs.existsSync(ANALYTICS_FILE)) return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8')); } catch (e) {}
  return { views: 0, tipViews: {} };
}
function saveAnalytics(a, s) { fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(a, null, 2), 'utf-8'); if (s !== false) syncGitHub(); }

function loadLinks() {
  try { if (fs.existsSync(LINKS_FILE)) return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf-8')); } catch (e) {}
  return [];
}
function saveLinks(data, s) { fs.writeFileSync(LINKS_FILE, JSON.stringify(data, null, 2), 'utf-8'); if (s !== false) syncGitHub(); }

function loadImages() {
  try { return fs.readdirSync(UPLOADS_DIR).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)).sort().reverse(); }
  catch (e) { return []; }
}

function adminAuth(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// --- Tips ---
app.get('/api/tips', (req, res) => { res.json(loadTips().reverse()); });

app.post('/api/tips', adminAuth, (req, res) => {
  const { name, date, company, code, odds, result, note } = req.body;
  if (!name || !date || !company || !code) return res.status(400).json({ error: 'Missing required fields' });
  const tip = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, date, company, code, odds: odds || '', result: result || 'pending', note: note || '',
    created: new Date().toISOString()
  };
  const t = loadTips(); t.push(tip); saveTips(t);
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

// --- Comments ---
app.get('/api/comments/all', adminAuth, (req, res) => { res.json(loadComments()); });

app.get('/api/comments/:tipId', (req, res) => {
  res.json(loadComments().filter(c => c.tipId === req.params.tipId).reverse());
});

app.post('/api/comments/:tipId', (req, res) => {
  const { author, text } = req.body;
  if (!author || !text) return res.status(400).json({ error: 'Missing fields' });
  const comment = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    tipId: req.params.tipId,
    author: author.trim().slice(0, 30),
    text: text.trim().slice(0, 500),
    created: new Date().toISOString()
  };
  const c = loadComments(); c.push(comment); saveComments(c);
  res.json({ success: true, comment });
});

app.delete('/api/comments/:id', adminAuth, (req, res) => {
  let comments = loadComments();
  const idx = comments.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  comments.splice(idx, 1); saveComments(comments);
  res.json({ success: true });
});

// --- Images ---
app.get('/api/images', (req, res) => { res.json(loadImages()); });
app.post('/api/images', adminAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  res.json({ success: true, filename: req.file.filename });
});
app.delete('/api/images/:filename', adminAuth, (req, res) => {
  const fp = path.join(UPLOADS_DIR, req.params.filename);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: 'Failed to delete' }); }
});

// --- Analytics ---
app.get('/api/analytics', (req, res) => { res.json(loadAnalytics()); });

app.post('/api/analytics/view', (req, res) => {
  const a = loadAnalytics(); a.views = (a.views || 0) + 1;
  saveAnalytics(a, false);
  res.json({ success: true, views: a.views });
});

app.post('/api/analytics/tip-view/:id', (req, res) => {
  const a = loadAnalytics(); if (!a.tipViews) a.tipViews = {};
  a.tipViews[req.params.id] = (a.tipViews[req.params.id] || 0) + 1;
  saveAnalytics(a, false);
  res.json({ success: true });
});

// --- Config check ---
app.get('/api/config', (req, res) => { res.json({ githubSync: !!GITHUB_TOKEN }); });

// --- Links ---
app.get('/api/links', (req, res) => { res.json(loadLinks().reverse()); });

app.post('/api/links', adminAuth, (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  const link = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim().slice(0, 50),
    url: url.trim().slice(0, 500),
    created: new Date().toISOString()
  };
  const l = loadLinks(); l.push(link); saveLinks(l);
  res.json({ success: true, link });
});

app.delete('/api/links/:id', adminAuth, (req, res) => {
  let links = loadLinks();
  const idx = links.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  links.splice(idx, 1); saveLinks(links);
  res.json({ success: true });
});

// Init data files
try {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
  if (!fs.existsSync(COMMENTS_FILE)) fs.writeFileSync(COMMENTS_FILE, '[]', 'utf-8');
  if (!fs.existsSync(ANALYTICS_FILE)) fs.writeFileSync(ANALYTICS_FILE, '{"views":0,"tipViews":{}}', 'utf-8');
  if (!fs.existsSync(LINKS_FILE)) fs.writeFileSync(LINKS_FILE, '[]', 'utf-8');
} catch (e) { console.error('Init error:', e.message); }

app.listen(PORT, () => console.log('JOTIPS server on port ' + PORT + ' [GitHub sync: ' + !!GITHUB_TOKEN + ']'));

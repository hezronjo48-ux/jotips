process.on('uncaughtException', e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
process.on('unhandledRejection', e => { console.error('FATAL REJECTION:', e.message); });

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const compression = require('compression');

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

app.use(compression());
app.use(express.json());
const cacheOpts = { maxAge: '1h', etag: true, lastModified: true };
app.use(express.static(__dirname, cacheOpts));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1d', etag: true }));

// GitHub sync via API
const GH_API = 'https://api.github.com/repos/hezronjo48-ux/jotips/contents';
let shaCache = {};
let syncInProgress = false;
let periodicTimer = null;

function ghFetch(path) {
  return fetch(GH_API + '/' + path, { headers: { Authorization: 'Bearer ' + GITHUB_TOKEN, Accept: 'application/vnd.github.v3+json' } });
}

async function loadFromGitHub() {
  if (!GITHUB_TOKEN) return;
  for (const [file, loader] of [['tips.json', (d) => { if (d.length > 2) fs.writeFileSync(DATA_FILE, d, 'utf-8'); }], ['comments.json', (d) => { if (d.length > 2) fs.writeFileSync(COMMENTS_FILE, d, 'utf-8'); }], ['analytics.json', (d) => { if (d.length > 2) fs.writeFileSync(ANALYTICS_FILE, d, 'utf-8'); }], ['links.json', (d) => { if (d.length > 2) fs.writeFileSync(LINKS_FILE, d, 'utf-8'); }]]) {
    try {
      const localFile = path.join(__dirname, file);
      const localContent = fs.existsSync(localFile) ? fs.readFileSync(localFile, 'utf-8') : '';
      // ALWAYS try to load from GitHub on fresh instance, but only overwrite if GitHub has more data
      const r = await ghFetch(file);
      if (!r.ok) continue;
      const j = await r.json();
      const ghContent = Buffer.from(j.content, 'base64').toString('utf-8');
      shaCache[file] = j.sha;
      // Only overwrite local if GitHub has real content and local is empty/barely initialized
      if (ghContent.length > 2 && localContent.length <= 2) {
        loader(ghContent);
        console.log('GitHub restored ' + file + ' (' + ghContent.length + ' bytes)');
      } else if (ghContent.length > 2 && localContent.length > 2) {
        // Both have data — merge: keep local, push local to GitHub to ensure it's backed up
        console.log('Local ' + file + ' has data, pushing backup...');
        ghPush(file, localContent);
      }
    } catch (e) { console.error('GitHub load error for ' + file + ':', e.message); }
  }
}

async function ghPush(file, data) {
  if (!GITHUB_TOKEN || !data || data.length <= 2) return;
  const content = Buffer.from(data, 'utf-8').toString('base64');
  const body = { message: 'Auto-sync ' + file + ' [' + new Date().toISOString().slice(0,19) + ']', content: content };
  if (shaCache[file]) body.sha = shaCache[file];
  try {
    const r = await fetch(GH_API + '/' + file, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + GITHUB_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (r.ok) { const j = await r.json(); shaCache[file] = j.content.sha; }
    else {
      const e = await r.json();
      if (e.message && e.message.indexOf('sha') >= 0) {
        // SHA mismatch — refetch SHA and retry once
        shaCache[file] = null;
        try {
          const rr = await ghFetch(file);
          if (rr.ok) { const jj = await rr.json(); shaCache[file] = jj.sha; body.sha = jj.sha; }
          const r2 = await fetch(GH_API + '/' + file, {
            method: 'PUT',
            headers: { Authorization: 'Bearer ' + GITHUB_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (r2.ok) { const j2 = await r2.json(); shaCache[file] = j2.content.sha; }
          else console.error('GitHub push retry failed for ' + file + ':', await r2.text().catch(()=>''));
        } catch(e2) { console.error('GitHub push retry error for ' + file + ':', e2.message); }
      } else {
        console.error('GitHub push error for ' + file + ':', e.message || await r.text().catch(()=>''));
      }
    }
  } catch (e) { console.error('GitHub push error for ' + file + ':', e.message); }
}

async function syncNow() {
  if (!GITHUB_TOKEN || syncInProgress) return;
  syncInProgress = true;
  const files = [['tips.json', DATA_FILE], ['comments.json', COMMENTS_FILE], ['analytics.json', ANALYTICS_FILE], ['links.json', LINKS_FILE]];
  for (const [file, localPath] of files) {
    try {
      const data = fs.readFileSync(localPath, 'utf-8');
      if (data && data.length > 2) await ghPush(file, data);
    } catch (e) { console.error('Sync error for ' + file + ':', e.message); }
  }
  syncInProgress = false;
}

function startPeriodicSync() {
  if (!GITHUB_TOKEN) return;
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = setInterval(syncNow, 60000);
  // Also fire immediately
  setTimeout(syncNow, 1000);
}

// Helpers
function loadTips() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch (e) {}
  return [];
}
function saveTips(data, s) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8'); if (s !== false) syncNow(); }

function loadComments() {
  try { if (fs.existsSync(COMMENTS_FILE)) return JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf-8')); } catch (e) {}
  return [];
}
function saveComments(data, s) { fs.writeFileSync(COMMENTS_FILE, JSON.stringify(data, null, 2), 'utf-8'); if (s !== false) syncNow(); }

function loadAnalytics() {
  try { if (fs.existsSync(ANALYTICS_FILE)) return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8')); } catch (e) {}
  return { views: 0, tipViews: {} };
}
function saveAnalytics(a, s) { fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(a, null, 2), 'utf-8'); if (s !== false) syncNow(); }

function loadLinks() {
  try { if (fs.existsSync(LINKS_FILE)) return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf-8')); } catch (e) {}
  return [];
}
function saveLinks(data, s) { fs.writeFileSync(LINKS_FILE, JSON.stringify(data, null, 2), 'utf-8'); if (s !== false) syncNow(); }

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
    category: req.body.category || 'other', confidence: Math.min(5, Math.max(1, parseInt(req.body.confidence) || 3)),
    featured: !!req.body.featured, stake: parseFloat(req.body.stake) || 0,
    home_team: (req.body.home_team || '').trim(), away_team: (req.body.away_team || '').trim(),
    predictions: req.body.predictions || [],
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

// --- Bulk import ---
app.post('/api/tips/bulk', adminAuth, (req, res) => {
  const { tips: items } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'No tips provided' });
  const now = new Date().toISOString();
  const created = items.map(item => ({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 4),
    name: (item.name || '').trim(), date: item.date || '', company: (item.company || '').trim(),
    code: (item.code || '').trim(), odds: (item.odds || '').toString(), result: 'pending',
    note: (item.note || '').trim(), category: item.category || 'other',
    confidence: Math.min(5, Math.max(1, parseInt(item.confidence) || 3)), featured: !!item.featured,
    stake: parseFloat(item.stake) || 0, home_team: (item.home_team || '').trim(), away_team: (item.away_team || '').trim(),
    predictions: item.predictions || [], created: now
  }));
  const t = loadTips(); t.push(...created); saveTips(t);
  res.json({ success: true, count: created.length, tips: created });
});

// --- Bankroll ---
app.get('/api/bankroll', (req, res) => {
  const tips = loadTips();
  let totalStake = 0, totalPayout = 0, won = 0, lost = 0;
  tips.forEach(t => {
    const stk = parseFloat(t.stake) || 0;
    const ods = parseFloat(t.odds) || 0;
    if (t.result === 'won' && stk > 0 && ods > 0) { totalStake += stk; totalPayout += stk * ods; won++; }
    else if (t.result === 'lost' && stk > 0) { totalStake += stk; lost++; }
  });
  res.json({ totalStake: Math.round(totalStake * 100) / 100, totalPayout: Math.round(totalPayout * 100) / 100, profit: Math.round((totalPayout - totalStake) * 100) / 100, won, lost, roi: totalStake > 0 ? Math.round((totalPayout - totalStake) / totalStake * 100) : 0 });
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

loadFromGitHub().then(() => {
  startPeriodicSync();
  app.listen(PORT, () => console.log('JOTIPS server on port ' + PORT + ' [GitHub sync: ' + !!GITHUB_TOKEN + ']'));
}).catch(() => {
  startPeriodicSync();
  app.listen(PORT, () => console.log('JOTIPS server on port ' + PORT + ' [GitHub sync: ' + !!GITHUB_TOKEN + ']'));
});

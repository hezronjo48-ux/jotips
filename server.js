const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'jotips2024';
const DATA_FILE = path.join(__dirname, 'tips.json');
const COMMENTS_FILE = path.join(__dirname, 'comments.json');

app.use(express.json());
app.use(express.static(__dirname));

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
app.get('/api/comments/:tipId', (req, res) => {
  const comments = loadComments().filter(c => c.tipId === req.params.id);
  res.json(comments.reverse());
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

if (!fs.existsSync(DATA_FILE)) saveTips([]);
if (!fs.existsSync(COMMENTS_FILE)) saveComments([]);

app.listen(PORT, () => console.log(`JOTIPS server on port ${PORT}`));

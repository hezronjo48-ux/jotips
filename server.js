const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'jotips2024';
const DATA_FILE = path.join(__dirname, 'tips.json');

app.use(express.json());
app.use(express.static(__dirname));

function loadTips() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) { console.error('Load error:', e); }
  return [];
}

function saveTips(tips) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tips, null, 2), 'utf-8');
}

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/tips', (req, res) => {
  const tips = loadTips();
  res.json(tips.reverse());
});

app.post('/api/tips', adminAuth, (req, res) => {
  const { name, date, company, code, odds, note } = req.body;
  if (!name || !date || !company || !code) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const tips = loadTips();
  const tip = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, date, company, code,
    odds: odds || '',
    note: note || '',
    created: new Date().toISOString()
  };
  tips.push(tip);
  saveTips(tips);
  res.json({ success: true, tip });
});

app.delete('/api/tips/:id', adminAuth, (req, res) => {
  let tips = loadTips();
  const index = tips.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Tip not found' });
  }
  tips.splice(index, 1);
  saveTips(tips);
  res.json({ success: true });
});

if (!fs.existsSync(DATA_FILE)) {
  saveTips([]);
}

app.listen(PORT, () => {
  console.log(`JOTIPS server running on port ${PORT}`);
});

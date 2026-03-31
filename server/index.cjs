/**
 * TGC-Arkade API + static hosting (production: serves Vite `dist/`).
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const PORT = process.env.PORT || 3847;
const DATA_FILE = process.env.TGC_DATA_FILE || path.join(__dirname, 'data.json');
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'dist');
const GAME_ROOT = fs.existsSync(path.join(DIST, 'index.html')) ? DIST : REPO_ROOT;

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { profiles: {}, leaderboard: [] };
  }
}

function saveDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function defaultProfile(username) {
  return {
    username,
    maxUnlockedLevelIndex: 0,
    stats: {
      playTimeMs: 0,
      deaths: 0,
      bestSessionScore: 0,
      highScore: 0,
      totalScore: 0,
      roundsWon: 0,
      maxLevelBeat: 0,
      fastestRoundSec: 0,
      fullLivesWins: 0,
    },
    achievements: {},
    cloudSyncedAt: Date.now(),
  };
}

function mergeProfile(server, client) {
  if (!client || typeof client !== 'object') return server;
  const out = JSON.parse(JSON.stringify(server));
  if (typeof client.maxUnlockedLevelIndex === 'number') {
    out.maxUnlockedLevelIndex = Math.max(
      out.maxUnlockedLevelIndex | 0,
      client.maxUnlockedLevelIndex | 0
    );
  }
  if (client.stats && typeof client.stats === 'object') {
    const s = out.stats;
    const cs = client.stats;
    s.playTimeMs = Math.max(s.playTimeMs | 0, cs.playTimeMs | 0);
    s.deaths = Math.max(s.deaths | 0, cs.deaths | 0);
    s.bestSessionScore = Math.max(s.bestSessionScore | 0, cs.bestSessionScore | 0);
    s.highScore = Math.max(s.highScore | 0, cs.highScore | 0);
    s.totalScore = Math.max(s.totalScore | 0, cs.totalScore | 0);
    s.roundsWon = Math.max(s.roundsWon | 0, cs.roundsWon | 0);
    s.maxLevelBeat = Math.max(s.maxLevelBeat | 0, cs.maxLevelBeat | 0);
    if (cs.fastestRoundSec | 0) {
      if (!s.fastestRoundSec || (cs.fastestRoundSec | 0) < (s.fastestRoundSec | 0)) {
        s.fastestRoundSec = cs.fastestRoundSec | 0;
      }
    }
    s.fullLivesWins = Math.max(s.fullLivesWins | 0, cs.fullLivesWins | 0);
  }
  if (client.achievements && typeof client.achievements === 'object') {
    out.achievements = out.achievements || {};
    Object.keys(client.achievements).forEach((k) => {
      const a = client.achievements[k];
      const b = out.achievements[k];
      if (!b || (a | 0) < (b | 0)) out.achievements[k] = a;
    });
  }
  return out;
}

function recomputeLeaderboard(db) {
  const bestByUser = {};
  db.leaderboard.forEach((row) => {
    const u = row.username;
    if (!bestByUser[u] || row.score > bestByUser[u].score) {
      bestByUser[u] = { username: u, score: row.score, at: row.at };
    }
  });
  return Object.values(bestByUser)
    .sort((a, b) => b.score - a.score)
    .slice(0, 200);
}

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, t: Date.now() });
});

app.get('/api/leaderboard', (req, res) => {
  const db = loadDb();
  res.json({ entries: recomputeLeaderboard(db).slice(0, 100), updatedAt: Date.now() });
});

app.get('/api/profile/:username', (req, res) => {
  const name = decodeURIComponent(req.params.username || '').trim();
  if (!name) return res.status(400).json({ error: 'username required' });
  const db = loadDb();
  const p = db.profiles[name];
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});

app.put('/api/profile/:username', (req, res) => {
  const name = decodeURIComponent(req.params.username || '').trim();
  if (!name || name.length > 32) return res.status(400).json({ error: 'invalid username' });
  const db = loadDb();
  const existing = db.profiles[name] || defaultProfile(name);
  const merged = mergeProfile(existing, req.body);
  merged.username = name;
  merged.cloudSyncedAt = Date.now();
  db.profiles[name] = merged;
  saveDb(db);
  res.json(merged);
});

app.post('/api/register', (req, res) => {
  const name = ((req.body && req.body.username) || '').trim();
  if (name.length < 2 || name.length > 32) {
    return res.status(400).json({ error: 'invalid username' });
  }
  const db = loadDb();
  if (!db.profiles[name]) {
    db.profiles[name] = defaultProfile(name);
    saveDb(db);
  }
  res.json(db.profiles[name]);
});

app.post('/api/session-end', (req, res) => {
  const name = ((req.body && req.body.username) || '').trim();
  const sessionScore = parseInt(req.body && req.body.sessionScore, 10) || 0;
  if (name.length < 2) return res.status(400).json({ error: 'invalid username' });
  if (sessionScore < 0 || sessionScore > 999999999) {
    return res.status(400).json({ error: 'invalid score' });
  }
  const db = loadDb();
  const p = db.profiles[name] || defaultProfile(name);
  p.stats = p.stats || {};
  p.stats.deaths = (p.stats.deaths | 0) + 1;
  if (sessionScore > (p.stats.bestSessionScore | 0)) p.stats.bestSessionScore = sessionScore;
  if (sessionScore > (p.stats.highScore | 0)) p.stats.highScore = sessionScore;
  p.cloudSyncedAt = Date.now();
  db.profiles[name] = p;
  db.leaderboard.push({ username: name, score: sessionScore, at: Date.now() });
  if (db.leaderboard.length > 5000) db.leaderboard = db.leaderboard.slice(-4000);
  saveDb(db);
  res.json({
    profile: p,
    leaderboardTop: recomputeLeaderboard(db).slice(0, 10),
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(GAME_ROOT, 'index.html'));
});

app.use((req, res, next) => {
  const p = req.path || '';
  if (
    p.indexOf('/node_modules') === 0 ||
    p.indexOf('/.git') === 0 ||
    p.indexOf('/server') === 0
  ) {
    return res.status(404).end();
  }
  next();
});

app.use(
  express.static(GAME_ROOT, {
    index: false,
    dotfiles: 'ignore',
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    setHeaders(res, filePath) {
      const lower = filePath.toLowerCase();
      if (lower.endsWith('.ogg')) res.setHeader('Content-Type', 'audio/ogg');
      if (lower.endsWith('.webm')) res.setHeader('Content-Type', 'audio/webm');
    },
  })
);

app.listen(PORT, '0.0.0.0', () => {
  console.log('TGC-Arkade: static + API on port ' + PORT + ' (root: ' + GAME_ROOT + ')');
});

// Tiny zero-dependency server: serves the game and mints short-lived
// AssemblyAI streaming tokens so the API key never reaches the browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT) || 5177;
const API_KEY = (process.env.ASSEMBLYAI_API_KEY || '').trim();
const SPEECH_MODEL = (process.env.ASSEMBLYAI_SPEECH_MODEL || '').trim();
const TOKEN_URL = process.env.ASSEMBLYAI_TOKEN_URL || 'https://token.assemblyai.com/v1/token';
const PUBLIC_DIR = path.join(__dirname, 'public');

// Optional phoneme recogniser for the Letters game: a local Python service
// (phoneme/service.py) that this server starts when its .venv exists.
const PHONEME_URL = `http://127.0.0.1:${Number(process.env.PHONEME_PORT) || 5178}`;
const VENV_PYTHON = path.join(__dirname, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
let phonemeReady = false;

async function startPhonemeService() {
  if (process.env.PHONEME === 'off') return;
  // One may still be running from a previous start of this server: reuse it.
  try {
    if ((await fetch(`${PHONEME_URL}/health`, { signal: AbortSignal.timeout(1500) })).ok) {
      phonemeReady = true;
      console.log('Phoneme service already running: letter sounds are on.');
      return;
    }
  } catch {}
  if (!fs.existsSync(VENV_PYTHON)) return;
  console.log('Starting the phoneme service (loading the model takes a little while)...');
  const child = spawn(VENV_PYTHON, [path.join(__dirname, 'phoneme', 'service.py')], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => {
    if (String(d).includes('ready')) phonemeReady = true;
    process.stdout.write(`[phoneme] ${d}`);
  });
  child.stderr.on('data', (d) => process.stderr.write(`[phoneme] ${d}`));
  child.on('exit', (code) => {
    phonemeReady = false;
    console.log(`Phoneme service stopped (code ${code}).`);
  });
  const stop = () => child.kill();
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit());
}

// Passes one short audio clip (raw 16 kHz PCM) to the phoneme service.
function recognisePhonemes(req, res, search) {
  if (!phonemeReady) return sendJson(res, 503, { error: 'phonemes_unavailable' });
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 400_000) req.destroy();
    else chunks.push(c);
  });
  req.on('end', async () => {
    try {
      const r = await fetch(`${PHONEME_URL}/phonemes${search}`, { method: 'POST', body: Buffer.concat(chunks) });
      sendJson(res, r.status, await r.json());
    } catch (err) {
      sendJson(res, 502, { error: 'phonemes_failed', detail: err.message });
    }
  });
}

// Training clips from the game's "Record sounds" mode: one WAV per attempt in
// phoneme/training/<speaker>/<sound>/, named <time>_<right|wrong>.wav (never committed).
const TRAINING_DIR = path.join(__dirname, 'phoneme', 'training');
const cleanName = (value, max) => String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, max);

function wavFile(pcm, sampleRate = 16000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function trainingCounts(speaker) {
  const counts = {};
  const dir = path.join(TRAINING_DIR, speaker);
  if (!fs.existsSync(dir)) return counts;
  for (const sound of fs.readdirSync(dir)) {
    const sub = path.join(dir, sound);
    if (fs.statSync(sub).isDirectory()) counts[sound] = fs.readdirSync(sub).filter((f) => f.endsWith('.wav')).length;
  }
  return counts;
}

function saveTrainingClip(req, res, params) {
  const speaker = cleanName(params.get('speaker'), 30);
  const sound = cleanName(params.get('sound'), 4);
  const label = cleanName(params.get('label'), 12) || 'unlabelled';
  if (!speaker || !sound) return sendJson(res, 400, { error: 'speaker_and_sound_required' });
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 400_000) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => {
    try {
      const pcm = Buffer.concat(chunks);
      if (pcm.length < 3200) return sendJson(res, 400, { error: 'clip_too_short' });
      const dir = path.join(TRAINING_DIR, speaker, sound);
      fs.mkdirSync(dir, { recursive: true });
      const file = `${new Date().toISOString().replace(/[:.]/g, '-')}_${label}.wav`;
      fs.writeFileSync(path.join(dir, file), wavFile(pcm));
      sendJson(res, 200, { saved: `${speaker}/${sound}/${file}`, counts: trainingCounts(speaker) });
    } catch (err) {
      sendJson(res, 500, { error: 'save_failed', detail: err.message });
    }
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function mintToken(res) {
  if (!API_KEY) return sendJson(res, 503, { error: 'missing_key' });
  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { authorization: API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ product: 'streaming', expires_in_seconds: 60 }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.token) {
      console.error('AssemblyAI token request failed:', r.status, data.error || '');
      return sendJson(res, 502, { error: 'token_failed', status: r.status, detail: data.error || null });
    }
    sendJson(res, 200, { token: data.token, speechModel: SPEECH_MODEL || null });
  } catch (err) {
    console.error('AssemblyAI token request error:', err.message);
    sendJson(res, 502, { error: 'token_failed', detail: err.message });
  }
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const { pathname, search, searchParams } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, { voice: Boolean(API_KEY), phonemes: phonemeReady });
  }
  if (pathname === '/api/phonemes' && req.method === 'POST') {
    return void recognisePhonemes(req, res, search);
  }
  if (pathname === '/api/training' && req.method === 'POST') {
    return void saveTrainingClip(req, res, searchParams);
  }
  if (pathname === '/api/training' && req.method === 'GET') {
    return sendJson(res, 200, { counts: trainingCounts(cleanName(searchParams.get('speaker'), 30)) });
  }
  if (pathname === '/api/token' && req.method === 'POST') {
    return void mintToken(res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method not allowed');
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Times Tables Hop running at http://localhost:${PORT}`);
  if (!API_KEY) console.log('ASSEMBLYAI_API_KEY is not set: voice answers are off, typing still works.');
  startPhonemeService();
});

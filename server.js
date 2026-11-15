// Tiny zero-dependency server: serves the game and mints short-lived
// AssemblyAI streaming tokens so the API key never reaches the browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 5177;
const API_KEY = (process.env.ASSEMBLYAI_API_KEY || '').trim();
const SPEECH_MODEL = (process.env.ASSEMBLYAI_SPEECH_MODEL || '').trim();
const TOKEN_URL = process.env.ASSEMBLYAI_TOKEN_URL || 'https://token.assemblyai.com/v1/token';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
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
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, { voice: Boolean(API_KEY) });
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
});

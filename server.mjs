import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(root, 'app');
const host = process.env.DASHBOARD_HOST || '127.0.0.1';
const port = Number(process.env.DASHBOARD_PORT || 4173);
const allowedModes = new Set(['baseline', 'pre', 'post']);

const state = {
  status: 'idle',
  mode: null,
  startedAt: null,
  finishedAt: null,
  logs: [],
  checks: [],
  summary: null
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function resetRun(mode) {
  state.status = 'running';
  state.mode = mode;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.logs = [];
  state.checks = [];
  state.summary = null;
}

function handleRunnerLine(line) {
  if (!line.trim()) return;
  if (!line.startsWith('RC_EVENT ')) {
    state.logs.push(line);
    return;
  }
  try {
    const event = JSON.parse(line.slice('RC_EVENT '.length));
    if (event.type === 'check') state.checks.push(event.check);
    if (event.type === 'summary') state.summary = event.summary;
    state.logs.push(line);
  } catch {
    state.logs.push(line);
  }
  state.logs = state.logs.slice(-200);
}

function runMode(mode) {
  resetRun(mode);
  const child = spawn(process.execPath, [path.join(root, 'scripts/runner.mjs'), mode], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdoutBuffer = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) handleRunnerLine(line);
  });
  child.stderr.on('data', (chunk) => {
    state.logs.push(chunk.toString().trim());
  });
  child.on('close', (code) => {
    if (stdoutBuffer.trim()) handleRunnerLine(stdoutBuffer);
    state.status = code === 0 ? 'passed' : 'failed';
    state.finishedAt = new Date().toISOString();
  });
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safePath = path.normalize(relative).replace(/^([.][.][/\\])+/, '');
  const file = path.join(appDir, safePath);
  if (!file.startsWith(appDir)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('not file');
    const ext = path.extname(file);
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, state);
  if (url.pathname === '/api/catalog' && req.method === 'GET') {
    const catalog = JSON.parse(await fs.readFile(path.join(root, 'config/check-catalog.json'), 'utf8'));
    return json(res, 200, catalog);
  }
  if (url.pathname === '/api/config' && req.method === 'GET') {
    const config = JSON.parse(await fs.readFile(path.join(root, 'config/relaunch.config.json'), 'utf8'));
    return json(res, 200, config);
  }
  if (url.pathname.startsWith('/api/run/') && req.method === 'POST') {
    const mode = url.pathname.split('/').pop();
    if (!allowedModes.has(mode)) return json(res, 400, { error: 'Unbekannter Check-Modus.' });
    if (state.status === 'running') return json(res, 409, { error: 'Ein Check läuft bereits.' });
    runMode(mode);
    return json(res, 202, { ok: true, mode });
  }
  return serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`Relaunch Check Dashboard: http://${host}:${port}`);
  console.log('Nur lokal gebunden. Der Browser kann ausschließlich allowlistete Relaunch-Checks starten.');
});

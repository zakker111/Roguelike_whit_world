/**
 * Minimal static HTTP server for local development.
 * Usage:
 *   1) npm init -y (optional)
 *   2) node server.js
 *   3) Open http://localhost:8080/
 *
 * Serves the current directory. No compression, no directory traversal.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ROOT = process.cwd();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
};

function sanitizeUrl(urlPath) {
  try {
    // Decode and strip query string/hash
    const qpos = urlPath.indexOf('?'); if (qpos !== -1) urlPath = urlPath.slice(0, qpos);
    const hpos = urlPath.indexOf('#'); if (hpos !== -1) urlPath = urlPath.slice(0, hpos);
    // Prevent directory traversal
    urlPath = urlPath.replace(/\\/g, '/');
    urlPath = urlPath.split('/').filter(seg => seg !== '' && seg !== '.' && seg !== '..').join('/');
    return '/' + urlPath;
  } catch (_) {
    return '/';
  }
}

function resolveFile(urlPath) {
  const safe = sanitizeUrl(urlPath);
  const full = path.join(ROOT, safe);
  let stat;
  try { stat = fs.statSync(full); } catch (_) { stat = null; }
  if (stat && stat.isDirectory()) {
    const indexPath = path.join(full, 'index.html');
    try { fs.accessSync(indexPath, fs.constants.R_OK); return indexPath; } catch (_) {}
    return full; // will 404
  }
  return full;
}

const server = http.createServer((req, res) => {
  const filePath = resolveFile(req.url || '/');
  let data;
  try {
    data = fs.readFileSync(filePath);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(data);
});

server.listen(PORT, () => {
  console.log(`[dev] static server listening at http://localhost:${PORT}/`);
});
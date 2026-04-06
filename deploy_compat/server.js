/**
 * Simple ESM static file server for local testing.
 * Run: node server.js
 *
 * Serves the current working directory. No compression, no directory traversal.
 */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

const ROOT = path.resolve(process.cwd());

function serveFile(res, filePath, contentType = 'text/plain; charset=utf-8') {
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

function guessType(p) {
  const ext = path.extname(p);
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    default: return 'text/plain; charset=utf-8';
  }
}

const server = createServer((req, res) => {
  try {
    const origin = `http://${req.headers.host || '127.0.0.1'}`;
    const u = new URL(req.url || '/', origin);

    let urlPath = u.pathname || '/';
    if (urlPath === '/' || urlPath === '/index.html') {
      return serveFile(res, path.join(ROOT, 'index.html'), 'text/html; charset=utf-8');
    }

    if (urlPath.startsWith('/')) urlPath = urlPath.slice(1);

    if (urlPath.startsWith('data/')) {
      const full = path.join(ROOT, urlPath);
      return serveFile(res, full, guessType(full));
    }

    // Static assets
    const fullPath = path.join(ROOT, urlPath);

    // Security: ensure path stays within ROOT
    const norm = path.normalize(fullPath);
    const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : (ROOT + path.sep);
    if (!(norm === ROOT || norm.startsWith(rootPrefix))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    // If path is a directory, try index.html inside it
    try {
      const stat = statSync(norm);
      if (stat.isDirectory()) {
        const idx = path.join(norm, 'index.html');
        return serveFile(res, idx, 'text/html; charset=utf-8');
      }
    } catch (_) {}

    // Else serve file
    serveFile(res, norm, guessType(norm));
  } catch (e) {
    try { console.error(e); } catch (_) {}
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server Error');
  }
});

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

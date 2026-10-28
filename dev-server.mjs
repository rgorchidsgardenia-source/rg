// Local preview: serves the static page and the /api/lead function on one port.
// Usage: npm run dev  ->  http://localhost:3000/landing-page/
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const leadHandler = require('./api/lead.js');
const root = process.cwd();
const port = Number(process.env.PORT) || 3000;
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.json': 'application/json'
};

function wrapRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  return res;
}

function serveFile(req, res, file) {
  const size = statSync(file).size;
  const type = types[extname(file)] || 'application/octet-stream';
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) { // byte ranges so videos can seek
    const start = range[1] ? +range[1] : 0;
    const end = range[2] ? +range[2] : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/lead') return leadHandler(req, wrapRes(res));
  if (url.pathname === '/' || url.pathname === '/landing-page') { res.writeHead(302, { Location: '/landing-page/' }); return res.end(); }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
  if (p.startsWith('..')) { res.writeHead(400); return res.end(); }
  let file = join(root, p);
  try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); serveFile(req, res, file); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`RG Orchids Gardenia landing page: http://localhost:${port}/landing-page/`));

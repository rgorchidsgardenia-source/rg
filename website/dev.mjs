// Local preview: rebuilds dist/ when src/ changes and serves it with the /api functions.
// Usage (from website/): node dev.mjs  ->  http://localhost:3100/
// Without SUPABASE_* env vars the API runs in log-only mode and prints submissions here.
import http from 'node:http';
import { createReadStream, statSync, watch, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const port = Number(process.env.PORT) || 3100;
const dist = join(root, 'dist');
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain'
};
const redirects = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).redirects || [];

function build() {
  try { execFileSync(process.execPath, [join(root, 'build.mjs')], { stdio: 'inherit' }); }
  catch { console.error('Build failed; serving the previous dist/'); }
}
build();
let t;
watch(join(root, 'src'), { recursive: true }, () => { clearTimeout(t); t = setTimeout(build, 150); });

function wrapRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  return res;
}

// api/*.mjs files export a Web-standard { fetch(request) } handler, like on Vercel; /api/name/action -> ?action=action.
async function runFetchHandler([, name, action], url, req, res) {
  try {
    const mod = await import(`./api/${name}.mjs?t=${Date.now()}`);
    if (action) url.searchParams.set('action', action);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const response = await mod.default.fetch(new Request(url, { method: req.method, headers: req.headers, body }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) { console.error(err); res.writeHead(500); res.end('API error'); }
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const fetchApi = /^\/api\/([\w-]+)(?:\/([\w-]+))?$/.exec(url.pathname);
  if (fetchApi && existsSync(join(root, 'api', `${fetchApi[1]}.mjs`))) return runFetchHandler(fetchApi, url, req, res);
  const api = /^\/api\/([\w-]+)$/.exec(url.pathname);
  if (api && existsSync(join(root, 'api', `${api[1]}.js`))) {
    const mod = join(root, 'api', `${api[1]}.js`);
    delete require.cache[require.resolve(mod)];
    return require(mod)(req, wrapRes(res));
  }
  const r = redirects.find((x) => x.source.replace(/\/$/, '') === url.pathname.replace(/\/$/, '') && !x.source.includes(':'));
  if (r) { res.writeHead(r.permanent ? 308 : 307, { Location: r.destination }); return res.end(); }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
  if (p.startsWith('..')) { res.writeHead(400); return res.end(); }
  let file = join(dist, p);
  try {
    if (statSync(file).isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(308, { Location: url.pathname + '/' }); return res.end(); }
      file = join(file, 'index.html');
    }
    statSync(file);
  } catch { res.statusCode = 404; file = join(dist, '404.html'); }
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  createReadStream(file).on('error', () => { res.statusCode = 404; res.end('Not found'); }).pipe(res);
}).listen(port, () => console.log(`RG Unique Structures site: http://localhost:${port}/`));

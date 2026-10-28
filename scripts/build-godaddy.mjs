// Builds the package uploaded to GoDaddy at rgstructures.in/landingpage.
// Usage: node scripts/build-godaddy.mjs [vercel-origin]
// The form posts to, and the videos stream from, the Vercel deployment, so
// the .mp4 files are left out and only ~3 MB goes on shared hosting.
import { cpSync, readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const origin = (process.argv[2] || 'https://rgorchidsgardenia.vercel.app').replace(/\/$/, '');
const out = join('dist', 'landingpage');
const zip = join('dist', 'rg-orchids-landingpage-godaddy.zip');

rmSync('dist', { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('landing-page', out, { recursive: true, filter: (src) => !src.endsWith('.mp4') });

const cfgPath = join(out, 'assets', 'js', 'config.js');
const cfg = readFileSync(cfgPath, 'utf8')
  .replace(/^  apiBase: '.*',$/m, `  apiBase: '${origin}',`)
  .replace(/^  videoBase: '.*',$/m, `  videoBase: '${origin}/landing-page/assets/video/',`);
writeFileSync(cfgPath, cfg);

// Windows 10+ ships bsdtar, which writes zips (GNU tar from Git Bash cannot); elsewhere use zip.
if (process.platform === 'win32') {
  const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', 'rg-orchids-landingpage-godaddy.zip', 'landingpage'], { cwd: 'dist' });
} else {
  execFileSync('zip', ['-qr', 'rg-orchids-landingpage-godaddy.zip', 'landingpage'], { cwd: 'dist' });
}

const count = (dir) => readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
console.log(`Built ${zip} (${count(out)} files) -> form + videos from ${origin}`);

#!/usr/bin/env node
/**
 * Build the deployable static site into ./dist
 *
 * `index.html` is the entry point (Air India Holidays demo homepage). This
 * script:
 *   1. crawls every asset reachable from it (follows href/src/url()/ES
 *      imports and lazy data-src/srcset), so unused files are dropped;
 *   2. copies them + `_headers` + `robots.txt` into ./dist.
 *
 * Pure Node, no dependencies — runs identically on macOS and Linux CI.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const OUT = path.join(root, 'dist');
const ENTRY = 'index.html';
const EXTRA = ['_headers', 'robots.txt', 'itinerary.html'];

const ASSET_EXT = ['.html', '.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.webp',
  '.svg', '.gif', '.ico', '.docx', '.pdf', '.woff', '.woff2', '.json', '.mp4', '.webm'];
const CODE_EXT = ['.html', '.css', '.js', '.mjs'];

const endsWithAny = (s, list) => list.some((e) => s.toLowerCase().endsWith(e));

/** Always ship Guzo catalog + itinerary assets even if not yet linked from the proposal. */
function collectForcedAssets(dir, acc = []) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return acc;
  for (const name of fs.readdirSync(full)) {
    const rel = path.join(dir, name);
    const st = fs.statSync(path.join(root, rel));
    if (st.isDirectory()) collectForcedAssets(rel, acc);
    else if (st.isFile()) acc.push(rel);
  }
  return acc;
}

function extractTokens(text) {
  const out = [];
  const push = (re) => { let m; while ((m = re.exec(text))) out.push(m[1]); };
  push(/["']([^"'<>]+)["']/g);          // any quoted string (href, src, data-src, srcset)
  push(/url\(\s*["']?([^"')]+)["']?\s*\)/g); // css url()
  push(/from\s+["']([^"']+)["']/g);     // es module imports
  const more = [];
  for (const x of [...out]) {
    if (x.includes(',') || x.includes(' ')) {
      for (const p of x.split(/[,\s]+/)) {
        if (p && !/^\d+(\.\d+)?[wx]?$/.test(p)) more.push(p); // strip srcset "1x/2x/640w"
      }
    }
  }
  return out.concat(more);
}

function toLocal(u) {
  u = u.trim();
  if (!u || /^(https?:|\/\/|data:|mailto:|tel:|#|javascript:|\{|\$)/.test(u)) return null;
  u = u.split('#')[0].split('?')[0];
  if (!u) return null;
  try { return decodeURIComponent(u); } catch { return u; }
}

function isResource(u) {
  const b = path.basename(u);
  return endsWithAny(u, ASSET_EXT) || b === 'Lalibela' ||
    u.startsWith('images/') || u.startsWith('guzo/') || u.startsWith('./guzo') ||
    u.startsWith('data/') || u.startsWith('js/');
}

// ---- crawl ----
const seen = new Set();
const queue = [ENTRY];
while (queue.length) {
  const f = path.normalize(queue.pop());
  if (seen.has(f)) continue;
  seen.add(f);
  const full = path.join(root, f);
  if (!fs.existsSync(full) || !endsWithAny(f, CODE_EXT)) continue;
  const text = fs.readFileSync(full, 'utf8');
  for (const tk of extractTokens(text)) {
    const lu = toLocal(tk);
    if (lu == null || !isResource(lu)) continue;
    const base = lu.startsWith('/')
      ? lu.replace(/^\/+/, '')
      : path.normalize(path.join(path.dirname(f), lu));
    queue.push(base);
  }
}
for (const e of EXTRA) if (fs.existsSync(path.join(root, e))) seen.add(e);
for (const e of collectForcedAssets('data/catalog')) seen.add(e);
for (const e of collectForcedAssets('js')) {
  if (/itinerary/i.test(e)) seen.add(e);
}

const present = [...seen].filter((f) => {
  const p = path.join(root, f);
  return fs.existsSync(p) && fs.statSync(p).isFile();
});

// ---- copy into dist ----
fs.rmSync(OUT, { recursive: true, force: true });
for (const f of present) {
  const dest = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, f), dest);
}

console.log(`Built dist/ with ${present.length} files (entry ${ENTRY}).`);

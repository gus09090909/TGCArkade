/**
 * Downloads space episode assets from GitHub (gus09090909/TGC-Arkade, branch master).
 * Run: node scripts/import-assets.mjs
 */
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const REF = path.join(ROOT, '_reference_original/js/app/episodes/space/resources.js');
const OUT = path.join(ROOT, 'public/assets/episodes/space');

const BASE =
  'https://raw.githubusercontent.com/gus09090909/TGC-Arkade/master/';

function extractPaths() {
  const s = fs.readFileSync(REF, 'utf8');
  const set = new Set();
  const re = /FULLADDR\s*\+\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const p = m[1].replace(/^\//, '');
    if (p.startsWith('images/episodes/space/') || p.startsWith('sounds/episodes/space/')) {
      set.add(p);
    }
  }
  return [...set].sort();
}

function fetchFile(rel) {
  return new Promise((resolve, reject) => {
    const url = BASE + rel.replace(/\\/g, '/');
    const dest = path.join(OUT, rel.replace(/^images\/episodes\/space\//, 'images/').replace(/^sounds\/episodes\/space\//, 'sounds/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error('Redirect not followed: ' + url));
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(res.statusCode + ' ' + url));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      })
      .on('error', (err) => {
        file.close();
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        reject(err);
      });
  });
}

const paths = extractPaths();
console.log('Found', paths.length, 'asset paths in resources.js');

let ok = 0;
let fail = 0;
for (let i = 0; i < paths.length; i++) {
  const p = paths[i];
  process.stdout.write(`[${i + 1}/${paths.length}] ${p} ... `);
  try {
    await fetchFile(p);
    console.log('ok');
    ok++;
  } catch (e) {
    console.log('FAIL', e.message);
    fail++;
  }
  await new Promise((r) => setTimeout(r, 40));
}
console.log('Done. ok:', ok, 'fail:', fail);

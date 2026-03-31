/**
 * Regenerates src/data/spaceLevels.ts from a checkout of the legacy repo
 * (path: _reference_original/js/app/episodes/space/levels.js).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcPath = path.join(root, '_reference_original/js/app/episodes/space/levels.js');
const outPath = path.join(root, 'src/data/spaceLevels.ts');

const s = fs.readFileSync(srcPath, 'utf8');
const i = s.indexOf('return [');
const j = s.lastIndexOf('];');
if (i < 0 || j < 0) throw new Error('Could not find level array in ' + srcPath);
const chunk = s.slice(i + 7, j + 2);
const lines = chunk.split(/\r?\n/).filter((l) => /^\s*'/.test(l));
const out =
  '/** Auto-generated from legacy `js/app/episodes/space/levels.js` */\n' +
  'export const SPACE_LEVEL_STRINGS = [\n' +
  lines.join('\n') +
  '\n] as const;\n';
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
console.log('Wrote', outPath, '(' + lines.length + ' levels)');

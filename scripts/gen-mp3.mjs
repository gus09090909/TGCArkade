/**
 * Creates `.mp3` siblings next to each `.ogg` in `public/assets/episodes/space/sounds/`
 * so Safari can load audio (Phaser picks OGG or MP3 from `SND_DUAL`).
 * Requires `ffmpeg` on PATH.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SND = path.join(__dirname, '..', 'public', 'assets', 'episodes', 'space', 'sounds');

function main() {
  if (!fs.existsSync(SND)) {
    console.error('Sounds folder missing. Run: node scripts/import-assets.mjs');
    process.exit(1);
  }
  const files = fs.readdirSync(SND).filter((f) => f.endsWith('.ogg'));
  if (!files.length) {
    console.error('No .ogg files in', SND);
    process.exit(1);
  }
  for (const f of files) {
    const base = f.replace(/\.ogg$/i, '');
    const inp = path.join(SND, f);
    const out = path.join(SND, `${base}.mp3`);
    process.stdout.write(`${f} -> ${base}.mp3 ... `);
    try {
      execFileSync(
        'ffmpeg',
        ['-y', '-i', inp, '-codec:a', 'libmp3lame', '-q:a', '4', out],
        { stdio: 'ignore' }
      );
      console.log('ok');
    } catch {
      console.log('FAIL (is ffmpeg installed?)');
    }
  }
}

main();

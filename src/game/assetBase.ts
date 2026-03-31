/** Vite serves `public/` at site root; base is `./` in vite.config. */
export const ASSET = (p: string) => `${import.meta.env.BASE_URL}${p.replace(/^\//, '')}`;

export const IMG = (sub: string) => ASSET(`assets/episodes/space/images/${sub}`);
export const SND = (sub: string) => ASSET(`assets/episodes/space/sounds/${sub}`);

/**
 * OGG first (ships with `import:assets`); MP3 second for Safari — run `npm run gen:mp3` once.
 * Phaser picks the first entry in the array that the browser `device.audio` claims to support.
 */
export const SND_DUAL = (base: string) => [SND(`${base}.ogg`), SND(`${base}.mp3`)];

/** Vite serves `public/` at site root; base is `./` in vite.config. */
export const ASSET = (p: string) => `${import.meta.env.BASE_URL}${p.replace(/^\//, '')}`;

export const IMG = (sub: string) => ASSET(`assets/episodes/space/images/${sub}`);
export const SND = (sub: string) => ASSET(`assets/episodes/space/sounds/${sub}`);

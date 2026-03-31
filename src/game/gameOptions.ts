/** Persisted preferences (legacy used `game-options` in localStorage; we use a dedicated key). */
const LS = 'tgc_window_options';

export type GameOptions = {
  musicOn: boolean;
  sfxOn: boolean;
};

const defaults: GameOptions = {
  musicOn: true,
  sfxOn: true,
};

function read(): GameOptions {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return { ...defaults };
    const j = JSON.parse(raw) as Partial<GameOptions>;
    return {
      musicOn: j.musicOn !== false,
      sfxOn: j.sfxOn !== false,
    };
  } catch {
    return { ...defaults };
  }
}

let cache = read();

export function getGameOptions(): GameOptions {
  return { ...cache };
}

export function setGameOptions(patch: Partial<GameOptions>) {
  cache = { ...cache, ...patch };
  localStorage.setItem(LS, JSON.stringify(cache));
}

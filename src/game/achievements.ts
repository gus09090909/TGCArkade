import { SPACE_LEVEL_STRINGS } from '../data/spaceLevels';
import { getStoredUsername, pushProfile, type Profile } from '../api/tgcCloud';
import { queueAchievementToasts } from '../ui/achievementToast';
import { ACH_DESCS, ACH_TITLES, S } from './classicStrings';

const LS = 'tgc_ach_local';

const LEVEL_ICONS = ['🎯', '🎮', '⭐', '🛸', '🌟'];

export type AchievementDef = {
  id: string;
  icon: string;
  levelBeat?: number;
  check: (p: Profile, ctx?: EvalCtx) => boolean;
};

export type EvalCtx = {
  /** Current run score (session), for point achievements mid-game. */
  sessionScore?: number;
};

const LEVEL_COUNT = SPACE_LEVEL_STRINGS.length;

function runScore(stats: Profile['stats'], ctx?: EvalCtx): number {
  const s = stats || ({} as Profile['stats']);
  const historic = Math.max(s.bestSessionScore | 0, s.highScore | 0);
  const cur = ctx?.sessionScore | 0;
  return Math.max(historic, cur);
}

function levelBeatCheck(n: number) {
  return (d: Profile) => (d.stats?.maxLevelBeat | 0) >= n;
}

function buildDefs(): AchievementDef[] {
  const defs: AchievementDef[] = [
    {
      id: 'cadet_joined',
      icon: '🚀',
      check: (d) => !!(d.username && String(d.username).trim().length >= 2),
    },
  ];
  for (let L = 1; L <= LEVEL_COUNT; L++) {
    defs.push({
      id: `lvl_beat_${L}`,
      icon: LEVEL_ICONS[L % LEVEL_ICONS.length],
      levelBeat: L,
      check: levelBeatCheck(L),
    });
  }
  defs.push(
    {
      id: 'tgc_legend',
      icon: '👑',
      check: (d) => (d.stats?.maxLevelBeat | 0) >= LEVEL_COUNT,
    },
    {
      id: 'point_collector_10k',
      icon: '💰',
      check: (d, ctx) => runScore(d.stats, ctx) >= 10000,
    },
    {
      id: 'point_hoarder_50k',
      icon: '💎',
      check: (d, ctx) => runScore(d.stats, ctx) >= 50000,
    },
    {
      id: 'score_ninja_100k',
      icon: '🥷',
      check: (d, ctx) => runScore(d.stats, ctx) >= 100000,
    },
    {
      id: 'oops_first_death',
      icon: '💀',
      check: (d) => (d.stats?.deaths | 0) >= 1,
    },
    {
      id: 'rubber_ball_10',
      icon: '🔁',
      check: (d) => (d.stats?.deaths | 0) >= 10,
    },
    {
      id: 'cosmic_persistence_50',
      icon: '☄️',
      check: (d) => (d.stats?.deaths | 0) >= 50,
    },
    {
      id: 'coffee_break_10m',
      icon: '☕',
      check: (d) => (d.stats?.playTimeMs | 0) >= 600000,
    },
    {
      id: 'marathon_1h',
      icon: '🕐',
      check: (d) => (d.stats?.playTimeMs | 0) >= 3600000,
    },
    {
      id: 'lightning_round',
      icon: '⚡',
      check: (d) => {
        const t = d.stats?.fastestRoundSec | 0;
        return t > 0 && t <= 45;
      },
    },
    {
      id: 'full_health_win',
      icon: '❤️',
      check: (d) => (d.stats?.fullLivesWins | 0) >= 1,
    }
  );
  return defs;
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = buildDefs();

export function formatAchievementStrings(def: AchievementDef): { title: string; desc: string } {
  if (def.levelBeat != null) {
    return {
      title: S.achLvlTitle.replace(/\{n\}/g, String(def.levelBeat)),
      desc: S.achLvlDesc.replace(/\{n\}/g, String(def.levelBeat)),
    };
  }
  return {
    title: ACH_TITLES[def.id] || def.id,
    desc: ACH_DESCS[def.id] || '',
  };
}

export function getLocalUnlockedIds(): Set<string> {
  try {
    const a = JSON.parse(localStorage.getItem(LS) || '[]') as string[];
    return new Set(Array.isArray(a) ? a : []);
  } catch {
    return new Set();
  }
}

function persistLocalIds(ids: Iterable<string>) {
  const s = getLocalUnlockedIds();
  let ch = false;
  for (const id of ids) {
    if (!s.has(id)) {
      s.add(id);
      ch = true;
    }
  }
  if (ch) localStorage.setItem(LS, JSON.stringify([...s]));
}

export function mergeServerAchievementIds(remote: Record<string, number> | undefined) {
  if (!remote || typeof remote !== 'object') return;
  const s = getLocalUnlockedIds();
  let ch = false;
  Object.keys(remote).forEach((k) => {
    if (!s.has(k)) {
      s.add(k);
      ch = true;
    }
  });
  if (ch) localStorage.setItem(LS, JSON.stringify([...s]));
}

/** Returns new achievement timestamps to merge onto the server profile. */
export function evaluateMissingAchievements(p: Profile, ctx?: EvalCtx): Record<string, number> {
  const unlocked = { ...(p.achievements || {}) };
  const now = Math.floor(Date.now() / 1000);
  const out: Record<string, number> = {};
  for (const def of ACHIEVEMENT_DEFS) {
    if (unlocked[def.id]) continue;
    try {
      if (def.check(p, ctx)) {
        out[def.id] = now;
        unlocked[def.id] = now;
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function persistEvaluatedAchievements(added: Record<string, number>) {
  if (!Object.keys(added).length) return;
  persistLocalIds(Object.keys(added));
}

function payloadsForAdded(added: Record<string, number>) {
  const ids = Object.keys(added);
  const out: { icon: string; label: string; title: string; description?: string }[] = [];
  for (const id of ids) {
    const def = ACHIEVEMENT_DEFS.find((d) => d.id === id);
    if (!def) continue;
    const { title, desc } = formatAchievementStrings(def);
    out.push({
      icon: def.icon,
      label: S.achToastUnlocked,
      title,
      description: desc || undefined,
    });
  }
  return out;
}

const USERNAME_RE = /^[a-zA-Z0-9 _\-áéíóúñüÁÉÍÓÚÑÜ]+$/;

export function isValidCallsign(name: string): boolean {
  const n = name.trim();
  return n.length >= 2 && n.length <= 24 && USERNAME_RE.test(n);
}

/** After cloud returns an updated profile, unlock any missing cheevos and optionally push. */
export async function syncEvaluatedAchievementsToCloud(p: Profile, ctx?: EvalCtx) {
  const user = getStoredUsername();
  if (user.length < 2) return;
  const added = evaluateMissingAchievements(p, ctx);
  if (!Object.keys(added).length) return;
  persistEvaluatedAchievements(added);
  queueAchievementToasts(payloadsForAdded(added));
  try {
    await pushProfile(user, { achievements: added });
  } catch {
    /* offline — local unlocks already saved */
  }
}

import { getStoredUsername, pushProfile } from '../api/tgcCloud';

const LS = 'tgc_ach_local';

export type AchievementDef = {
  id: string;
  title: string;
  description: string;
};

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'first_break', title: 'Block buster', description: 'Destroy your first block.' },
  { id: 'stage_clear', title: 'Stage clear', description: 'Clear a full stage.' },
  { id: 'reach_5', title: 'Sector 5', description: 'Clear your way to stage 5.' },
  { id: 'reach_20', title: 'Deep space', description: 'Reach stage 20.' },
  { id: 'all_stages', title: 'Episode complete', description: 'Clear all space stages.' },
  { id: 'score_10k', title: 'Ten thousand', description: 'Reach 10,000 points in one run.' },
];

export function getLocalUnlockedIds(): Set<string> {
  try {
    const a = JSON.parse(localStorage.getItem(LS) || '[]') as string[];
    return new Set(Array.isArray(a) ? a : []);
  } catch {
    return new Set();
  }
}

function persistLocal(id: string): boolean {
  const s = getLocalUnlockedIds();
  if (s.has(id)) return false;
  s.add(id);
  localStorage.setItem(LS, JSON.stringify([...s]));
  return true;
}

export function tryUnlockAchievement(id: string) {
  if (!ACHIEVEMENT_DEFS.some((d) => d.id === id)) return;
  if (!persistLocal(id)) return;
  const user = getStoredUsername();
  if (user.length < 2) return;
  void pushProfile(user, {
    achievements: { [id]: Math.floor(Date.now() / 1000) },
  });
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

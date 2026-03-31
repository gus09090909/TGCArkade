/**
 * Same contract as legacy `tgc-cloud.js` — relative `/api` (Vite proxy or same host).
 */

const LS_USER = 'tgc_username';
const LS_HIGH = 'tgc_high_score';

export type ProfileStats = {
  playTimeMs: number;
  deaths: number;
  bestSessionScore: number;
  highScore: number;
  totalScore: number;
  roundsWon: number;
  maxLevelBeat: number;
  fastestRoundSec: number;
  fullLivesWins: number;
};

export type Profile = {
  username: string;
  maxUnlockedLevelIndex: number;
  stats: ProfileStats;
  achievements: Record<string, number>;
  cloudSyncedAt?: number;
};

export type LeaderboardResponse = {
  entries: { username: string; score: number; at: number }[];
  updatedAt: number;
};

export type SessionEndResponse = {
  profile: Profile;
  leaderboardTop: { username: string; score: number; at: number }[];
};

function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
  return `${base}${path}`;
}

export function getStoredUsername(): string {
  return (localStorage.getItem(LS_USER) || '').trim();
}

export function setStoredUsername(name: string) {
  localStorage.setItem(LS_USER, name.trim());
}

export function getLocalHighScore(): number {
  return Number(localStorage.getItem(LS_HIGH) || '0') || 0;
}

export function setLocalHighScore(n: number) {
  localStorage.setItem(LS_HIGH, String(Math.max(0, n | 0)));
}

export async function register(username: string): Promise<Profile | null> {
  const res = await fetch(apiUrl('/api/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) return null;
  return res.json() as Promise<Profile>;
}

export async function fetchProfile(username: string): Promise<Profile | false | null> {
  const res = await fetch(apiUrl('/api/profile/' + encodeURIComponent(username)), {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return false;
  if (!res.ok) return null;
  return res.json() as Promise<Profile>;
}

export async function pushProfile(username: string, body: Partial<Profile>): Promise<Profile | null> {
  const res = await fetch(apiUrl('/api/profile/' + encodeURIComponent(username)), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json() as Promise<Profile>;
}

export async function fetchLeaderboard(): Promise<LeaderboardResponse | null> {
  const res = await fetch(apiUrl('/api/leaderboard'), { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  return res.json() as Promise<LeaderboardResponse>;
}

export async function sessionEnd(username: string, sessionScore: number): Promise<SessionEndResponse | null> {
  const res = await fetch(apiUrl('/api/session-end'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, sessionScore: sessionScore | 0 }),
  });
  if (!res.ok) return null;
  return res.json() as Promise<SessionEndResponse>;
}

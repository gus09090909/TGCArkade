import {
  fetchLeaderboard,
  fetchProfile,
  getLocalHighScore,
  getStoredUsername,
  pushProfile,
  register,
  setStoredUsername,
  type Profile,
} from '../api/tgcCloud';
import { SPACE_LEVEL_STRINGS } from '../data/spaceLevels';
import {
  ACHIEVEMENT_DEFS,
  getLocalUnlockedIds,
  mergeServerAchievementIds,
} from '../game/achievements';

export type OverlayBridge = {
  getMaxUnlockedLevel: () => number;
  onOpen: () => void;
  onClose: () => void;
};

const HIDDEN = 'tgc-hidden';

function defaultMaxUnlocked(): number {
  return Math.min(
    Number(localStorage.getItem('tgc_max_level') || '0') || 0,
    SPACE_LEVEL_STRINGS.length - 1
  );
}

let ctx: OverlayBridge = {
  getMaxUnlockedLevel: defaultMaxUnlocked,
  onOpen: () => {},
  onClose: () => {},
};

let domReady = false;
let openFn: (() => void) | null = null;
let closeFn: (() => void) | null = null;

export function setTgcOverlayContext(patch: Partial<OverlayBridge>) {
  Object.assign(ctx, patch);
}

function $(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error('Missing #' + id);
  return el;
}

/** Call once after DOM is available (e.g. from `main.ts`). */
export function initTgcOverlayDom() {
  if (domReady) return;
  domReady = true;

  const overlay = $('tgc-overlay');
  const tabProfile = $('tgc-tab-profile');
  const tabLb = $('tgc-tab-leaderboard');
  const tabAch = $('tgc-tab-achievements');
  const achStatus = $('tgc-ach-status');
  const achGrid = $('tgc-ach-grid');
  const input = $('tgc-username') as HTMLInputElement;
  const msg = $('tgc-profile-msg');
  const statsEl = $('tgc-profile-stats');
  const lbList = $('tgc-lb-list');
  const lbStatus = $('tgc-lb-status');

  let activeTab: 'profile' | 'leaderboard' | 'achievements' = 'profile';

  function showTab(which: 'profile' | 'leaderboard' | 'achievements') {
    activeTab = which;
    tabProfile.classList.toggle(HIDDEN, which !== 'profile');
    tabLb.classList.toggle(HIDDEN, which !== 'leaderboard');
    tabAch.classList.toggle(HIDDEN, which !== 'achievements');
    document.querySelectorAll('.tgc-tabs button').forEach((b) => {
      b.classList.toggle('tgc-active', (b as HTMLElement).dataset.tab === which);
    });
    if (which === 'leaderboard') void loadLeaderboard();
    if (which === 'achievements') void loadAchievementsPanel();
  }

  async function loadLeaderboard() {
    lbStatus.textContent = 'Loading…';
    lbList.innerHTML = '';
    const data = await fetchLeaderboard();
    if (!data) {
      lbStatus.textContent = 'Could not load ranking. Is the API running?';
      return;
    }
    lbStatus.textContent = '';
    data.entries.slice(0, 50).forEach((row, i) => {
      const li = document.createElement('li');
      li.textContent = `${i + 1}. ${row.username} — ${row.score}`;
      lbList.appendChild(li);
    });
    if (data.entries.length === 0) {
      lbStatus.textContent = 'No scores yet.';
    }
  }

  function formatProfile(p: Profile): string {
    const s = p.stats;
    const achN = p.achievements && typeof p.achievements === 'object' ? Object.keys(p.achievements).length : 0;
    return [
      `Max level unlocked (cloud): ${p.maxUnlockedLevelIndex + 1}`,
      `High score: ${s.highScore}`,
      `Best session: ${s.bestSessionScore}`,
      `Rounds won: ${s.roundsWon}`,
      `Deaths: ${s.deaths}`,
      `Achievements (cloud): ${achN} — open the Achievements tab for detail.`,
    ].join('\n');
  }

  function renderAchievementCards(remote: Record<string, number> | undefined) {
    achGrid.innerHTML = '';
    const remoteKeys = remote && typeof remote === 'object' ? new Set(Object.keys(remote)) : new Set<string>();
    const local = getLocalUnlockedIds();
    for (const def of ACHIEVEMENT_DEFS) {
      const unlocked = local.has(def.id) || remoteKeys.has(def.id);
      const card = document.createElement('div');
      card.className = 'tgc-ach-card' + (unlocked ? ' tgc-ach-unlocked' : ' tgc-ach-locked');
      const icon = document.createElement('div');
      icon.className = 'tgc-ach-icon';
      icon.textContent = unlocked ? '★' : '☆';
      const body = document.createElement('div');
      body.className = 'tgc-ach-body';
      const t = document.createElement('div');
      t.className = 'tgc-ach-title';
      t.textContent = def.title;
      const d = document.createElement('div');
      d.className = 'tgc-ach-desc';
      d.textContent = def.description;
      body.appendChild(t);
      body.appendChild(d);
      card.appendChild(icon);
      card.appendChild(body);
      achGrid.appendChild(card);
    }
  }

  async function loadAchievementsPanel() {
    achStatus.textContent = 'Loading…';
    achGrid.innerHTML = '';
    const name = getStoredUsername();
    if (name.length < 2) {
      achStatus.textContent = 'Set a player name on the welcome screen or under Profile.';
      renderAchievementCards(undefined);
      return;
    }
    const p = await fetchProfile(name);
    if (p === false) {
      achStatus.textContent = 'No cloud profile yet — use Profile → Save & sync.';
      renderAchievementCards(undefined);
      return;
    }
    if (p === null) {
      achStatus.textContent = 'Could not reach API — showing local unlocks only.';
      mergeServerAchievementIds(undefined);
      renderAchievementCards(undefined);
      return;
    }
    mergeServerAchievementIds(p.achievements);
    achStatus.textContent = '';
    renderAchievementCards(p.achievements);
  }

  async function saveProfile() {
    const name = input.value.trim();
    if (name.length < 2 || name.length > 32) {
      msg.textContent = 'Name must be 2–32 characters.';
      return;
    }
    msg.textContent = 'Saving…';
    const reg = await register(name);
    if (!reg) {
      msg.textContent = 'Register failed (network or server).';
      return;
    }
    setStoredUsername(name);
    const localMax = ctx.getMaxUnlockedLevel();
    const ach: Record<string, number> = {};
    for (const id of getLocalUnlockedIds()) ach[id] = Math.floor(Date.now() / 1000);
    const merged: Partial<Profile> = {
      maxUnlockedLevelIndex: Math.max(reg.maxUnlockedLevelIndex | 0, localMax),
      stats: {
        ...reg.stats,
        highScore: Math.max(reg.stats.highScore | 0, getLocalHighScore()),
      },
      achievements: Object.keys(ach).length ? ach : undefined,
    };
    const put = await pushProfile(name, merged);
    if (!put) {
      msg.textContent = 'Saved locally; cloud sync failed.';
      statsEl.textContent = formatProfile(reg);
      return;
    }
    msg.textContent = 'Synced with server.';
    statsEl.textContent = formatProfile(put);
  }

  async function refreshProfilePanel() {
    input.value = getStoredUsername();
    statsEl.textContent = '';
    msg.textContent = '';
    const name = getStoredUsername();
    if (name.length < 2) {
      statsEl.textContent = 'Enter a name and save to create your cloud profile.';
      return;
    }
    const p = await fetchProfile(name);
    if (p === false) {
      statsEl.textContent = 'No server profile yet — press Save & sync.';
    } else if (p === null) {
      statsEl.textContent = 'Could not reach API.';
    } else {
      mergeServerAchievementIds(p.achievements);
      statsEl.textContent = formatProfile(p);
    }
  }

  function open() {
    overlay.classList.remove(HIDDEN);
    overlay.setAttribute('aria-hidden', 'false');
    ctx.onOpen();
    void refreshProfilePanel();
    showTab(activeTab);
  }

  function close() {
    overlay.classList.add(HIDDEN);
    overlay.setAttribute('aria-hidden', 'true');
    ctx.onClose();
  }

  openFn = open;
  closeFn = close;

  $('tgc-close').addEventListener('click', close);
  overlay.querySelector('.tgc-backdrop')?.addEventListener('click', close);

  document.querySelectorAll('.tgc-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = (btn as HTMLElement).dataset.tab;
      if (raw === 'profile' || raw === 'leaderboard' || raw === 'achievements') showTab(raw);
    });
  });

  $('tgc-save-profile').addEventListener('click', () => void saveProfile());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains(HIDDEN)) close();
  });
}

export function openTgcOverlay() {
  openFn?.();
}

export function closeTgcOverlay() {
  closeFn?.();
}

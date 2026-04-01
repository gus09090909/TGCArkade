import {
  fetchLeaderboard,
  fetchProfile,
  getLocalHighScore,
  getStoredUsername,
  mergeCloudMaxLevelIntoLocal,
  pushProfile,
  register,
  setLocalHighScore,
  setStoredUsername,
  type Profile,
} from '../api/tgcCloud';
import { SPACE_LEVEL_STRINGS } from '../data/spaceLevels';
import {
  ACHIEVEMENT_DEFS,
  formatAchievementStrings,
  getLocalUnlockedIds,
  mergeServerAchievementIds,
  syncEvaluatedAchievementsToCloud,
} from '../game/achievements';
import { S } from '../game/classicStrings';

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

function apiLikelyConfigured(): boolean {
  return true;
}

function renderAchievementTiles(remote: Record<string, number> | undefined) {
  const grid = $('tgc-ach-grid');
  grid.innerHTML = '';
  const remoteKeys = remote && typeof remote === 'object' ? new Set(Object.keys(remote)) : new Set<string>();
  const local = getLocalUnlockedIds();
  for (const def of ACHIEVEMENT_DEFS) {
    const unlocked = local.has(def.id) || remoteKeys.has(def.id);
    const { title, desc } = formatAchievementStrings(def);
    const tile = document.createElement('div');
    tile.className = 'tgc-ach-tile' + (unlocked ? '' : ' tgc-ach-tile--locked');
    tile.innerHTML = `
      <div class="tgc-ach-tile__icon" aria-hidden="true">${def.icon}</div>
      <div class="tgc-ach-tile__title"></div>
      <div class="tgc-ach-tile__desc"></div>
    `;
    tile.querySelector('.tgc-ach-tile__title')!.textContent = title;
    tile.querySelector('.tgc-ach-tile__desc')!.textContent = desc;
    grid.appendChild(tile);
  }
}

function formatPlayTimeMs(ms: number): string {
  const m = Math.max(0, ms | 0);
  if (m < 60_000) return '<1 min';
  if (m < 3_600_000) return `${Math.floor(m / 60_000)} min`;
  const h = Math.floor(m / 3_600_000);
  const min = Math.floor((m % 3_600_000) / 60_000);
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

function fillProfileStats(p: Profile) {
  const s = p.stats;
  $('tgc-stat-playtime').textContent = formatPlayTimeMs(s.playTimeMs | 0);
  $('tgc-stat-totalscore').textContent = String(s.totalScore | 0);
  const bestRun = Math.max(s.bestSessionScore | 0, s.highScore | 0);
  $('tgc-stat-highscore').textContent = String(bestRun);
  $('tgc-stat-deaths').textContent = String(s.deaths | 0);
  $('tgc-stat-levels').textContent = String((p.maxUnlockedLevelIndex | 0) + 1);
}

export function initTgcOverlayDom() {
  if (domReady) return;
  domReady = true;

  const overlay = $('tgc-overlay');
  const tabProfile = $('tgc-tab-profile');
  const tabLb = $('tgc-tab-leaderboard');
  const msg = $('tgc-profile-msg');
  const lbStatus = $('tgc-lb-status');

  let activeTab: 'profile' | 'leaderboard' = 'profile';
  let overlayVisible = false;
  let pollLb: ReturnType<typeof setInterval> | undefined;
  let pollProfile: ReturnType<typeof setInterval> | undefined;

  function stopCloudPolls() {
    if (pollLb) clearInterval(pollLb);
    if (pollProfile) clearInterval(pollProfile);
    pollLb = pollProfile = undefined;
  }

  function startCloudPolls() {
    stopCloudPolls();
    pollLb = setInterval(() => {
      if (!overlayVisible || activeTab !== 'leaderboard') return;
      void loadLeaderboard({ silent: true });
    }, 4000);
    pollProfile = setInterval(() => {
      if (!overlayVisible || activeTab !== 'profile') return;
      void refreshProfileTab({ silent: true });
    }, 5000);
  }

  function showTab(which: 'profile' | 'leaderboard') {
    activeTab = which;
    tabProfile.classList.toggle(HIDDEN, which !== 'profile');
    tabLb.classList.toggle(HIDDEN, which !== 'leaderboard');
    document.querySelectorAll('#tgc-overlay .tgc-profile-tabs a').forEach((a) => {
      const el = a as HTMLAnchorElement;
      el.classList.toggle('tab-selected', el.dataset.tab === which);
    });
    if (which === 'leaderboard') void loadLeaderboard({ silent: false });
  }

  async function loadLeaderboard(opts?: { silent?: boolean }) {
    const silent = opts?.silent === true;
    if (!silent) lbStatus.textContent = '';
    const live = $('tgc-lb-live');
    const table = $('tgc-lb-table');
    if (!silent) {
      live.textContent = '…';
      table.innerHTML = '';
    }
    const data = await fetchLeaderboard();
    if (!data) {
      if (!silent) {
        live.textContent = '';
        table.innerHTML = `<p class="tgc-lb-empty">${S.lbError}</p>`;
      }
      return;
    }
    const t = new Date(data.updatedAt || Date.now());
    live.textContent = `${S.lbUpdated} ${t.toLocaleTimeString()}`;
    const rows = data.entries.slice(0, 100);
    if (rows.length === 0) {
      table.innerHTML = `<p class="tgc-lb-empty">${S.lbEmpty}</p>`;
      return;
    }
    const me = getStoredUsername();
    let html = `<table class="tgc-lb-grid"><thead><tr>
      <th>#</th><th>${S.lbPlayer}</th><th>${S.lbScore}</th>
    </tr></thead><tbody>`;
    rows.forEach((e, i) => {
      const isMe = e.username === me ? ' class="tgc-lb-me"' : '';
      html += `<tr${isMe}><td>${i + 1}</td><td>${escapeHtml(e.username)}</td><td>${e.score | 0}</td></tr>`;
    });
    html += '</tbody></table>';
    table.innerHTML = html;
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function refreshProfileTab(opts?: { silent?: boolean }) {
    const silent = opts?.silent === true;
    if (!silent) msg.textContent = '';
    const name = getStoredUsername();
    $('tgc-profile-name').textContent = name.length >= 2 ? name : '—';
    $('tgc-profile-cloud').textContent = apiLikelyConfigured() ? S.profileCloudOn : S.profileCloudOff;

    if (name.length < 2) {
      $('tgc-stat-playtime').textContent = '0';
      $('tgc-stat-totalscore').textContent = '0';
      $('tgc-stat-highscore').textContent = '0';
      $('tgc-stat-deaths').textContent = '0';
      $('tgc-stat-levels').textContent = '0';
      renderAchievementTiles(undefined);
      return;
    }

    const p = await fetchProfile(name);
    if (p === false) {
      if (!silent) msg.textContent = 'No server profile yet — press Sync now after playing.';
      $('tgc-stat-playtime').textContent = '—';
      $('tgc-stat-totalscore').textContent = '—';
      $('tgc-stat-highscore').textContent = String(getLocalHighScore());
      $('tgc-stat-deaths').textContent = '—';
      $('tgc-stat-levels').textContent = String(
        Math.min(
          Math.max(0, Number(localStorage.getItem('tgc_max_level') || '0') || 0),
          SPACE_LEVEL_STRINGS.length - 1
        ) + 1
      );
      renderAchievementTiles(undefined);
      return;
    }
    if (p === null) {
      if (!silent) msg.textContent = 'Could not reach API. Is the server running (npm start on port 3847)?';
      $('tgc-stat-playtime').textContent = '—';
      $('tgc-stat-totalscore').textContent = '—';
      $('tgc-stat-highscore').textContent = String(getLocalHighScore());
      $('tgc-stat-deaths').textContent = '—';
      $('tgc-stat-levels').textContent = String(
        Math.min(
          Math.max(0, Number(localStorage.getItem('tgc_max_level') || '0') || 0),
          SPACE_LEVEL_STRINGS.length - 1
        ) + 1
      );
      renderAchievementTiles(undefined);
      return;
    }
    mergeServerAchievementIds(p.achievements);
    mergeCloudMaxLevelIntoLocal(p.maxUnlockedLevelIndex | 0, SPACE_LEVEL_STRINGS.length - 1);
    fillProfileStats(p);
    renderAchievementTiles(p.achievements);
    const cloudBest = Math.max(p.stats.bestSessionScore | 0, p.stats.highScore | 0);
    if (cloudBest > getLocalHighScore()) setLocalHighScore(cloudBest);
  }

  async function syncNow() {
    const name = getStoredUsername();
    if (name.length < 2) {
      msg.textContent = 'Set your callsign on the welcome screen first.';
      return;
    }
    msg.textContent = 'Syncing…';
    let p = await fetchProfile(name);
    if (p === false) {
      const reg = await register(name);
      if (!reg) {
        msg.textContent = 'Could not register profile.';
        return;
      }
      p = reg;
    } else if (p === null) {
      msg.textContent = 'Could not reach API.';
      return;
    }

    const localMax = ctx.getMaxUnlockedLevel();
    const now = Math.floor(Date.now() / 1000);
    const ach: Record<string, number> = { ...(p.achievements || {}) };
    for (const id of getLocalUnlockedIds()) {
      if (ach[id] == null) ach[id] = now;
    }

    const localBest = getLocalHighScore();
    const merged: Partial<Profile> = {
      maxUnlockedLevelIndex: Math.max(p.maxUnlockedLevelIndex | 0, localMax),
      stats: {
        ...p.stats,
        bestSessionScore: Math.max(p.stats.bestSessionScore | 0, localBest),
        highScore: Math.max(p.stats.highScore | 0, localBest),
      },
      achievements: ach,
    };

    const put = await pushProfile(name, merged);
    if (!put) {
      msg.textContent = 'Sync failed.';
      return;
    }
    mergeServerAchievementIds(put.achievements);
    mergeCloudMaxLevelIntoLocal(put.maxUnlockedLevelIndex | 0, SPACE_LEVEL_STRINGS.length - 1);
    fillProfileStats(put);
    renderAchievementTiles(put.achievements);
    const putBest = Math.max(put.stats.bestSessionScore | 0, put.stats.highScore | 0);
    if (putBest > getLocalHighScore()) setLocalHighScore(putBest);
    void syncEvaluatedAchievementsToCloud(put);
    msg.textContent = 'Synced.';
  }

  function copyInviteLink() {
    const name = getStoredUsername();
    if (name.length < 2) return;
    const link = `${location.origin}${location.pathname}?tgc_player=${encodeURIComponent(name)}`;
    const text = `${link}\n${S.shareBlurb}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      msg.textContent = 'Link copied.';
    } else {
      window.prompt(S.copyManual, link);
    }
  }

  function logout() {
    if (!window.confirm(S.logoutConfirm)) return;
    setStoredUsername('');
    try {
      localStorage.removeItem('tgc_ach_local');
    } catch {
      /* */
    }
    close();
    window.location.reload();
  }

  function open() {
    overlay.classList.remove(HIDDEN);
    overlay.setAttribute('aria-hidden', 'false');
    overlayVisible = true;
    ctx.onOpen();
    void refreshProfileTab();
    showTab(activeTab);
    startCloudPolls();
  }

  function close() {
    overlay.classList.add(HIDDEN);
    overlay.setAttribute('aria-hidden', 'true');
    overlayVisible = false;
    stopCloudPolls();
    ctx.onClose();
  }

  openFn = open;
  closeFn = close;

  $('tgc-close').addEventListener('click', close);
  overlay.querySelector('.tgc-backdrop')?.addEventListener('click', close);

  document.querySelectorAll('#tgc-overlay .tgc-profile-tabs a').forEach((a) => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      const raw = (a as HTMLElement).dataset.tab;
      if (raw === 'profile' || raw === 'leaderboard') showTab(raw);
    });
  });

  $('tgc-profile-copy').addEventListener('click', () => copyInviteLink());
  $('tgc-profile-sync').addEventListener('click', () => void syncNow());
  $('tgc-profile-logout').addEventListener('click', () => logout());

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

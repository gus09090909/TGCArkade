import { S } from '../game/classicStrings';

function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Static copy for welcome + overlay (matches classic en-us). */
export function applyClassicDomLabels() {
  setText('tgc-welcome-badge', S.welcomeBadge);
  setText('tgc-welcome-tagline', S.welcomeTagline);
  setText('tgc-welcome-hook', S.welcomeHook);
  setText('tgc-welcome-label', S.welcomeUsernameLabel);
  setText('tgc-welcome-go-label', S.welcomePlay);
  const inp = document.getElementById('tgc-welcome-name') as HTMLInputElement | null;
  if (inp) inp.placeholder = S.welcomePlaceholder;

  setText('tgc-dialog-title', S.profileHeader);
  const tabs = document.querySelectorAll('#tgc-overlay .tgc-profile-tabs a');
  if (tabs[0]) tabs[0].textContent = S.tabProfile;
  if (tabs[1]) tabs[1].textContent = S.tabLeaderboard;

  setText('lbl-tgc-stat-playtime', S.statPlaytime);
  setText('lbl-tgc-stat-totalscore', S.statTotalPoints);
  setText('lbl-tgc-stat-highscore', S.statBestRun);
  setText('lbl-tgc-stat-deaths', S.statDeaths);
  setText('lbl-tgc-stat-levels', S.statLevels);

  setText('tgc-profile-copy', S.copyLink);
  setText('tgc-profile-sync', S.syncNow);
  setText('tgc-profile-logout', S.logout);
  setText('tgc-ach-heading', S.achievementsHeading);
}

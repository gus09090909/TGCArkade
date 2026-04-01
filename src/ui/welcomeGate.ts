import Phaser from 'phaser';
import { register, setStoredUsername } from '../api/tgcCloud';
import { isValidCallsign, syncEvaluatedAchievementsToCloud } from '../game/achievements';
import { S } from '../game/classicStrings';

/**
 * First-run gate: classic-style callsign screen before the main menu.
 */
export function runWelcomeFlow(scene: Phaser.Scene) {
  const gate = document.getElementById('tgc-welcome');
  const input = document.getElementById('tgc-welcome-name') as HTMLInputElement | null;
  const err = document.getElementById('tgc-welcome-err');
  const go = document.getElementById('tgc-welcome-go');
  if (!gate || !input || !go || !err) {
    scene.scene.start('MenuScene');
    return;
  }

  const existing = (localStorage.getItem('tgc_username') || '').trim();
  if (existing.length >= 2 && isValidCallsign(existing)) {
    scene.scene.start('MenuScene');
    return;
  }

  gate.classList.remove('tgc-hidden');
  gate.setAttribute('aria-hidden', 'false');
  input.value = '';
  input.maxLength = 24;
  err.textContent = '';
  const cleanup = () => {
    go.removeEventListener('click', submit);
    input.removeEventListener('keydown', onKey);
  };
  const submit = () => {
    const name = input.value.trim();
    if (!isValidCallsign(name)) {
      err.textContent =
        name.trim().length < 2 || name.trim().length > 24 ? S.welcomeErrLen : S.welcomeErrChars;
      input.classList.add('tgc-welcome__input--error');
      return;
    }
    input.classList.remove('tgc-welcome__input--error');
    err.textContent = '…';
    void register(name).then((profile) => {
      if (!profile) {
        err.textContent = 'Could not reach the server. Is `npm start` running?';
        return;
      }
      setStoredUsername(name);
      void syncEvaluatedAchievementsToCloud(profile);
      gate.classList.add('tgc-hidden');
      gate.setAttribute('aria-hidden', 'true');
      cleanup();
      scene.sound.unlock();
      scene.scene.start('MenuScene');
    });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', onKey);
  setTimeout(() => input.focus(), 80);
}

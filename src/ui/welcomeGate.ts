import Phaser from 'phaser';
import { getStoredUsername, setStoredUsername } from '../api/tgcCloud';

/**
 * First-run gate: ask for display name before the main menu (classic flow).
 */
export function runWelcomeFlow(scene: Phaser.Scene) {
  if (getStoredUsername().length >= 2) {
    scene.scene.start('MenuScene');
    return;
  }
  const gate = document.getElementById('tgc-welcome');
  const input = document.getElementById('tgc-welcome-name') as HTMLInputElement | null;
  const err = document.getElementById('tgc-welcome-err');
  const go = document.getElementById('tgc-welcome-go');
  if (!gate || !input || !go || !err) {
    scene.scene.start('MenuScene');
    return;
  }
  gate.classList.remove('tgc-hidden');
  gate.setAttribute('aria-hidden', 'false');
  input.value = '';
  err.textContent = '';
  const cleanup = () => {
    go.removeEventListener('click', submit);
    input.removeEventListener('keydown', onKey);
  };
  const submit = () => {
    const name = input.value.trim();
    if (name.length < 2 || name.length > 32) {
      err.textContent = 'Use 2–32 characters.';
      return;
    }
    setStoredUsername(name);
    gate.classList.add('tgc-hidden');
    gate.setAttribute('aria-hidden', 'true');
    cleanup();
    scene.scene.start('MenuScene');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', onKey);
  setTimeout(() => input.focus(), 80);
}

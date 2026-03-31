import Phaser from 'phaser';
import { getGameOptions } from './gameOptions';

const REG_KEY = 'tgcBgm';

/** Ensures background music exists and matches music / mute options. */
export function syncBgm(scene: Phaser.Scene) {
  if (!scene.sound.get('s-music')) return;
  const game = scene.game;
  let bgm = game.registry.get(REG_KEY) as Phaser.Sound.BaseSound | undefined;
  const { musicOn } = getGameOptions();
  const vol = musicOn ? 0.28 : 0;

  if (!bgm) {
    bgm = scene.sound.add('s-music', { loop: true, volume: vol });
    game.registry.set(REG_KEY, bgm);
    if (musicOn) bgm.play();
    return;
  }

  bgm.setVolume(vol);
  if (musicOn) {
    if (!bgm.isPlaying) bgm.play();
  } else {
    bgm.stop();
  }
}

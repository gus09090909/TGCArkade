import Phaser from 'phaser';
import { getGameOptions } from './gameOptions';

export const TGC_BGM_REGISTRY_KEY = 'tgcBgm';
const REG_KEY = TGC_BGM_REGISTRY_KEY;

/** Ensures background music exists and matches music / mute options. */
export function syncBgm(scene: Phaser.Scene) {
  if (!scene.cache.audio.exists('s-music')) return;
  const game = scene.game;
  let bgm = game.registry.get(REG_KEY) as Phaser.Sound.BaseSound | undefined;
  const { musicOn } = getGameOptions();
  const vol = musicOn ? 0.28 : 0;

  const tryPlay = () => {
    const b = game.registry.get(REG_KEY) as Phaser.Sound.BaseSound | undefined;
    if (!b || !musicOn || !getGameOptions().musicOn) return;
    if (!b.isPlaying) {
      try {
        b.play();
      } catch {
        /* autoplay / decode */
      }
    }
  };

  if (!bgm) {
    bgm = scene.sound.add('s-music', { loop: true, volume: vol });
    game.registry.set(REG_KEY, bgm);
    if (musicOn) tryPlay();
    scene.input?.once('pointerdown', tryPlay);
    game.sound.once(Phaser.Sound.Events.UNLOCKED, tryPlay);
    return;
  }

  bgm.setVolume(vol);
  if (musicOn) {
    tryPlay();
  } else {
    bgm.stop();
  }
}

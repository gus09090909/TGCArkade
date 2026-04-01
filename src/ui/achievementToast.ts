/** Steam-style unlock toasts: bottom-right, queued. */

export type AchievementToastPayload = {
  icon: string;
  label: string;
  title: string;
  description?: string;
};

const HOST_ID = 'tgc-ach-toast-host';
const IN_MS = 380;
const HOLD_MS = 4200;
const OUT_MS = 420;

let toastChain = Promise.resolve();

function ensureHost(): HTMLElement {
  let el = document.getElementById(HOST_ID) as HTMLElement | null;
  if (el) return el;
  el = document.createElement('div');
  el.id = HOST_ID;
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  document.body.appendChild(el);
  return el;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function showOneToast(payload: AchievementToastPayload): Promise<void> {
  return new Promise((resolve) => {
    const host = ensureHost();
    const reduce = prefersReducedMotion();

    const root = document.createElement('div');
    root.className = 'tgc-ach-toast';
    root.setAttribute('role', 'status');

    const icon = document.createElement('div');
    icon.className = 'tgc-ach-toast__icon';
    icon.textContent = payload.icon;

    const text = document.createElement('div');
    text.className = 'tgc-ach-toast__text';

    const label = document.createElement('div');
    label.className = 'tgc-ach-toast__label';
    label.textContent = payload.label;

    const title = document.createElement('div');
    title.className = 'tgc-ach-toast__title';
    title.textContent = payload.title;

    text.append(label, title);
    if (payload.description) {
      const desc = document.createElement('div');
      desc.className = 'tgc-ach-toast__desc';
      desc.textContent = payload.description;
      text.append(desc);
    }

    root.append(icon, text);
    host.appendChild(root);

    const finishOut = () => {
      root.remove();
      resolve();
    };

    const runOut = () => {
      root.classList.remove('tgc-ach-toast--in');
      root.classList.add('tgc-ach-toast--out');
      const t = window.setTimeout(finishOut, OUT_MS + 80);
      root.addEventListener(
        'transitionend',
        (ev) => {
          if (ev.target !== root) return;
          window.clearTimeout(t);
          finishOut();
        },
        { once: true }
      );
    };

    if (reduce) {
      root.classList.add('tgc-ach-toast--in');
      window.setTimeout(finishOut, HOLD_MS);
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.add('tgc-ach-toast--in');
      });
    });

    window.setTimeout(runOut, IN_MS + HOLD_MS);
  });
}

/** Queue one or more unlock notifications (shown one after another). */
export function queueAchievementToasts(items: AchievementToastPayload[]): void {
  if (!items.length) return;
  for (const item of items) {
    toastChain = toastChain.then(() => showOneToast(item));
  }
}

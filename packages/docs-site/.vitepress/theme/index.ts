import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import HeroEyebrow from './HeroEyebrow.vue';
import HeroCodePanel from './HeroCodePanel.vue';
import './custom.css';

/**
 * **Press a picture to read it** — `M234` `G` (`D1305`).
 *
 * The `/ui/` shots are cut at 1440 or 1060 css and land in a content column that is 688px wide at a
 * 1440px window, so the UI's 13px type arrives at around 6px. `deviceScaleFactor: 2` buys the
 * resolution; nothing was buying the *size*, and a reader who wanted to read a picture had to open
 * it in a new tab by hand.
 *
 * `medium-zoom` is the conventional choice and was refused on two grounds (`D1305`): it would be
 * this site's first runtime dependency, and the backdrop has to be theme-aware for the
 * `.light-only`/`.dark-only` pairs either way — so the library saves less than it appears to. What
 * it would have saved is about thirty lines.
 *
 * Three ways out, because a reader who cannot dismiss an overlay is trapped in it: a press
 * anywhere, `Escape`, and a scroll. The scroll path is why the page is **not** scroll-locked while
 * the overlay is up — locking it would remove the very gesture that dismisses it, which is the
 * shape of bug that only shows up on a trackpad.
 */
const installShotZoom = (): void => {
  const flag = '__tflwShotZoom';
  if ((window as unknown as Record<string, boolean>)[flag] === true) return;
  (window as unknown as Record<string, boolean>)[flag] = true;

  let overlay: HTMLElement | null = null;
  let opener: HTMLElement | null = null;

  const close = (): void => {
    if (overlay === null) return;
    overlay.remove();
    overlay = null;
    // Focus goes back where it came from. A reader who opened this from the keyboard is otherwise
    // returned to the top of the document, which is a worse place than where they were.
    opener?.focus?.();
    opener = null;
  };

  document.addEventListener('click', (event) => {
    // An overlay that is up swallows the next press, whatever it landed on. Checked first so that
    // pressing the enlarged picture itself closes rather than re-opening it.
    if (overlay !== null) {
      close();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target === null || target.tagName !== 'IMG') return;
    // `.vp-doc` only: the logo, the hero panel and anything a component draws are not the subject.
    if (target.closest('.vp-doc') === null) return;

    const source = target as HTMLImageElement;
    overlay = document.createElement('div');
    overlay.className = 'tflw-zoom';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', source.alt === '' ? 'the picture, enlarged' : source.alt);
    overlay.tabIndex = -1;

    const big = document.createElement('img');
    // `currentSrc`, not `src`: the light/dark pair is chosen by CSS, and `src` on a hidden member
    // of the pair would enlarge the picture the reader is not looking at.
    big.src = source.currentSrc === '' ? source.src : source.currentSrc;
    big.alt = source.alt;
    overlay.append(big);

    document.body.append(overlay);
    opener = source;
    overlay.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  window.addEventListener('scroll', close, { passive: true });
};

// PLAN_DOCS_REFRESH.md decision 3/4: reskin the default theme (Direction A, "Systems Console")
// rather than migrate frameworks — the Playground/editor demos are live @tflw/lang + LSP
// components and stay exactly as they are. These two slots are the only structural additions:
// an eyebrow above the hero heading and a code-sample panel in the hero's image slot.
export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-hero-info-before': () => h(HeroEyebrow),
      'home-hero-image': () => h(HeroCodePanel),
    });
  },
  enhanceApp() {
    // The build renders every page in Node, where there is no document. Guarded rather than moved
    // into a component's `onMounted`, because the listeners are delegated and belong to the app.
    if (typeof window === 'undefined') return;
    installShotZoom();
  },
} satisfies Theme;

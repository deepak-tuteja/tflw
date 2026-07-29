import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import HeroEyebrow from './HeroEyebrow.vue';
import HeroCodePanel from './HeroCodePanel.vue';
import './custom.css';

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
} satisfies Theme;

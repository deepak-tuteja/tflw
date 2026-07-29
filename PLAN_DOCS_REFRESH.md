# testFlow docs-site — PLAN (docs refresh)

A messaging + visual-design refresh of `packages/docs-site` (VitePress, deployed to GitHub Pages).
Triggered by the homepage still reading "A testing-only DSL for API tests" — stale since the
browser arc (M3a-M7, SPEC.md/PLAN.md decisions through 112) shipped. Scoped via a `/grill-me`
session (2026-07-29); no code changed yet. Plan-only per the user's explicit instruction — build
happens in a later session, checkpointing after each milestone (same cadence as testFlow-tests'
L1-L3/R1-R3/T1-T3/F1-F2 initiatives).

## Why this exists (the grill record)

1. **Full site audit, not just the homepage.** index.md's hero/description text is confirmed stale
   (still says "API tests" only, contradicting its own tagline one line below and the "API,
   browser, load & security testing" feature bullet), but the 12 guide chapters, 4 reference pages,
   grammar.md, and editor.md haven't been checked. **Decision: audit every page** — a subagent reads
   the whole site against what SPEC.md/CHANGELOG.md say has actually shipped (browser steps, LSP,
   `tflw watch`/`pick`, the reuse pass/`refactor apply`, `tflw migrate`, visual regression, a11y,
   network stubbing) and reports every stale claim, missing-feature gap, and broken cross-link.
   Nothing gets rewritten until the audit's findings exist. **Rejected:** fixing only index.md
   (the user explicitly asked for "all the features of tflw," not a one-heading patch).

2. **A new lightweight "What's new" page, additive to the existing `/changelog` — not a
   replacement.** `packages/docs-site/changelog.md` already exists, is in nav, and transcludes the
   full raw root `CHANGELOG.md` verbatim (`<!--@include: ../../CHANGELOG.md-->`) — so a changelog
   page is not the gap. The gap is a short, scannable "what's done recently / what's coming next"
   summary, which the raw changelog can't serve (it's the complete unabridged log). **Decision:**
   a new page, own nav item, named **"What's new"** (path `/whats-new`), linking down to
   `/changelog` for full detail. Content is **hand-maintained**, not generated — a short markdown
   file (~15-20 lines: a handful of recent highlights + a handful of next-arc bullets), updated
   manually whenever a milestone lands, same discipline as `CHANGELOG.md`'s own `[Unreleased]`
   section. "Coming next" is written in **plain capability language** ("performance/load testing,"
   "security-testing features") — never internal version numbers, milestone codes (M-numbers), or
   PLAN.md decision IDs; those stay internal. **Rejected:** build-time generation from
   CHANGELOG.md/PLAN.md (real staleness risk is low with hand-maintenance at this cadence, and
   generation would need a scrubbing step to keep internal IDs out of public copy — not worth the
   tooling yet); merging into `/changelog` as one page (defeats the "short and scannable" point of
   asking for it in the first place); replacing `/changelog`'s nav slot (the full log is a distinct,
   legitimate destination that shouldn't need a click-through from another page to reach directly).

3. **Visual design: stay on VitePress, reskin rather than migrate.** The user is open to switching
   frameworks in principle, but `packages/docs-site` has real, non-trivial infrastructure that a
   migration would put at risk: the Playground page and 6 of the 7 Editor-support demos
   (`editor/*.vue`) are genuine Vue components running the *actual* `@tflw/lang` parser and
   `@tflw/lsp-server` logic live in the browser — not screenshots. Docusaurus (React) or Astro
   Starlight would require rewriting every one of those components' live-parser wiring, not just
   their markup. **Decision: stay on VitePress**, invest in a custom theme instead of migrating.
   VitePress's own light/dark toggle (already a real feature — `config.ts`'s comment on decision
   16.12: `appearance` deliberately left at its OS-respecting default) stays working; the new theme
   needs a coherent fallback in the non-primary mode, not a broken toggle. **Rejected:** Astro
   Starlight / Docusaurus migration (real, unbounded rewrite cost on the site's most distinctive
   feature — live in-browser LSP demos — for a visual outcome achievable by reskinning).

4. **Visual direction: "Systems Console."** Web research surfaced the current dev-tool-docs
   convergence point (Stripe/Linear/Vercel-style: near-monochrome + one accent color, dark-mode-
   first, minimal borders/shadows, density from type-weight/spacing not decoration). Three concrete
   directions were mocked up as a real HTML artifact and compared side-by-side (not decided from
   description alone): **A — Systems Console** (dark, one warm-amber accent tied to tflw's own
   "caret under a code error" diagnostic color, a subtle dot-grid hero echoing "every step is an
   event," hairline-bordered 2×2 feature cards); **B — Field Report** (light warm-paper background,
   ink-blue accent, headline set like a `report.html` run-summary stamp, features as a literal
   checklist/ledger — leans on tflw's own reporting centerpiece); **C — Amber Terminal** (committed
   single-theme CRT aesthetic, the whole homepage staged as a real `tflw run` transcript, highest
   personality/risk). **Decision: A — Systems Console.** Concretely: bg `#0a0a0b`, surface
   `#141416`, hairline border `#26262a`, warm off-white text `#f2f0ec`, dim text `#8d8b87`, accent
   `#f2a93b` (warm amber/gold — reused everywhere the site needs *one* color: links, active nav,
   code-sample keyword highlight, primary CTA). Display type: a tight, heavy system-grotesk stack
   (no external font — VitePress ships no webfonts today and the artifacts CSP concern doesn't apply
   to a real deployed site, but a system stack avoids a FOUT/licensing decision this plan doesn't
   need to make); code/labels: `ui-monospace` stack (already used for grammar-highlighted samples).
   **Rejected:** B (safer, but the user picked A after seeing both live); C (too much of a personality
   swing for a professional testing tool's front door, per the user's pick).

5. **Site-wide consistency, not just the homepage.** A's tokens (palette, hairline borders, the
   amber accent, spacing rhythm) need to reach the guide/reference/grammar/editor/playground pages
   too — a redesigned homepage sitting in front of an unchanged default-VitePress interior would
   read as a reskin stapled onto the old site, not a real refresh. Concretely: guide/reference pages
   inherit the new color tokens and heading rhythm; the Playground and Editor-demo Vue components
   get restyled to match (not rewritten — same live logic, new chrome) so they don't look like a
   different product mid-site.

## Milestones

| # | Milestone | Depends on | Status |
|---|---|---|---|
| M1 | Full-site content & messaging audit | — | ✅ done |
| M2 | Messaging & copy rewrite (index.md + every M1 finding) | M1 | ✅ done |
| M3 | Homepage visual implementation (Direction A theme + hero + feature grid) | M2 | ✅ done |
| M4 | Site-wide visual consistency pass (guide/reference/grammar/editor/playground) | M3 | ✅ done |
| M5 | "What's new" page (new nav item, hand-written, links to `/changelog`) | — (independent of M2-M4) | ✅ done |
| M6 | Final verification (build, link check, real-browser light+dark spot check, docs-site sample script) | M2, M3, M4, M5 | ✅ done |

Each milestone checkpoints with the user before the next starts, per this workspace's
`big-build-workflow` convention.

### M1 — Full-site content & messaging audit

- Scope: every page under `packages/docs-site/` — `index.md`, `getting-started.md`,
  all 12 `guide/*.md` chapters, all 4 `reference/*.md` pages, `grammar.md`, `editor.md`,
  `playground/index.md`.
- Ground truth: `SPEC.md`'s per-section ✅/🔮 status badges, root `CHANGELOG.md`, and the actual
  shipped CLI surface (`tflw check`/`watch`/`pick`/`refactor apply`/`migrate`/`lsp`) — not assumption.
- Deliverable: a findings list (stale/API-only framing, missing-feature mentions, broken internal
  links, anything that contradicts what's actually shipped), used directly as M2's input. Format
  and location (a scratch doc vs. inline in this file) is an implementation-time call, not decided
  here.
- Already known going in (don't re-discover): `getting-started.md` already correctly frames browser
  testing as an add-on ("no browser install needed for an API-only suite; run `tflw
  install-browsers` once a suite adds UI steps") — not stale, a good reference for how the rest of
  the site should read.

**M1 findings (audit complete, 2026-07-29):**

Read every page in scope against `SPEC.md`'s ✅/🔮 badges, `CHANGELOG.md`, and the actual CLI
surface. Result: the staleness is narrow, not spread across the site. `getting-started.md` and all
12 `guide/*.md` chapters, all 4 `reference/*.md` pages (matcher/generator/CLI/diagnostic tables are
generated from `packages/lang/src/spec-data.ts`, so they can't drift), `grammar.md`, `editor.md`,
and `playground/index.md` are all accurate and already frame tflw as API+browser+LSP — no edits
needed on any of them for M2. Confirmed via targeted greps that every shipped browser/CLI feature
(`tflw watch`/`pick`/`refactor apply`/`migrate`, mTLS, `allow hosts`, `oauth2` sessions, `redact`,
evidence levels, `--forbid-insecure`, `--format ndjson`, visual regression, a11y, network `stub`s,
frames/tabs/downloads/drag-drop) has real, non-trivial coverage somewhere on the site — no
missing-feature gaps requiring new content.

Two concrete fixes for M2:
1. **`index.md`** — `hero.text` ("A testing-only DSL for API tests") is the confirmed stale line;
   contradicts its own `hero.tagline` one line below and the "One language for API, browser, load &
   security testing" feature bullet.
2. **`.vitepress/config.ts`** — the site-wide `description` meta (line 11) has the identical stale
   line: `'A testing-only DSL for API tests — reports first, syntax second.'` This wasn't found
   during the original grill-me session (it's config, not a content page) — same fix as #1, same
   root cause (written pre-browser-arc, never revisited).

One optional, non-blocking improvement noted for M2 to consider: `index.md`'s "Why tflw" section
only compares tflw against API-testing tools (Karate, Hurl) — it has no comparison sentence for the
browser side (Playwright/Cypress-adjacent). Not a correctness bug (the section is honestly scoped
to "vs. hand-written API tests"), just a possible completeness addition given the headline now
claims both. Leaving the call on whether to add this to M2's own scoping, not deciding it here.

No broken internal links found (every `](/...)` cross-link in guide/reference pages resolves to a
real file in scope).

### M2 — Messaging & copy rewrite

- Fix every M1 finding, at minimum: `index.md`'s hero.text, the VitePress-wide `description` meta
  (`.vitepress/config.ts`), the "Why tflw" prose, and the comparison-to-other-tools section.
- Draft direction (from the mockups, not final copy): hero — "Test APIs and browsers in one
  language."; sub — "tflw compiles readable steps into a self-contained report.html, junit.xml, and
  teaching-quality diagnostics — no glue code, no separate tools."
- Feature bullets to reflect, at minimum: reporting-first runtime; teaching-quality diagnostics;
  one language for API + browser (perf/security next, plain language per decision 2); real editor
  support (`tflw lsp`).

**M2 done (2026-07-29):** Fixed both M1-flagged spots — `index.md`'s `hero.text` now reads "Test
APIs and browsers in one language." (tagline tightened to drop the now-redundant "both built"
phrasing while keeping the honest pre-1.0/not-yet-published note), and `.vitepress/config.ts`'s
site-wide `description` meta now says "A testing DSL for API and browser tests — reports first,
syntax second." Also resolved the optional M1 note: added a browser-side comparison paragraph to
"Why tflw" (Playwright/Cypress — tflw runs on Playwright, replaces the glue code between API setup
and UI assertions, not the automation library itself). `npm run build` (VitePress) clean.

### M3 — Homepage visual implementation

- Implement Direction A's tokens as real VitePress theme CSS (custom properties, likely
  `.vitepress/theme/` overrides — no such directory exists today, confirmed during this session).
- Hero: dot-grid background pattern (subtle, echoing "every step is an event" — not a generic
  blueprint grid), amber-accented eyebrow + underline treatment, code-sample panel showing a real
  `.tflw` snippet (interleaved API+browser, e.g. the checkout example from the mockup).
- Feature grid: hairline-bordered 2×2 cards, no shadows, minimal corner radius.
- Both themes get real care per this site's own existing light/dark toggle (decision 16.12) — dark
  is primary, but light must stay legible and on-brand, not an afterthought inversion.

**M3 done (2026-07-29):** New `.vitepress/theme/` (no such directory existed before this session):
`index.ts` extends the default theme and injects two slots on the home layout only — an eyebrow
badge (`HeroEyebrow.vue`) and a code-sample panel (`HeroCodePanel.vue`, the same checkout snippet
from the mockups, hand-tagged with `.tok-kw`/`.tok-str` spans rather than wired to shiki — it's
static decorative content, not a live-parser demo, so decision 3's "reskin not rewrite" doesn't
require reusing the real grammar here). Caught one accuracy bug while writing the snippet: the
mockup used `navigate`, but the real keyword (confirmed against `guide/browser-basics.md`) is
`open` — fixed before it ever shipped.

`custom.css` implements Direction A as real `--vp-c-*`/`--vp-*` token overrides (`:root` = light,
`.dark` = dark/primary) — this is why the palette already reaches nav/sidebar/buttons/code blocks
everywhere, not just the hero; that's expected, not scope creep into M4 (M4 is about the
guide/reference/editor *pages'* own content and the Vue demo components' chrome, which are
untouched so far). Plus hero-specific CSS: dot-grid background (a `::before` layer at `z-index:-1`
inside a `.VPHero { position:relative; z-index:0 }` stacking context — needed so it paints behind
both the headline and the image-slot code panel, not on top of either), an amber underline span on
"APIs and browsers", and feature-card hairline borders/4px radius/forced 2-column grid at all
widths ≥640px. Several rules needed `!important` to beat VitePress's own `<style scoped>` output,
whose compiled `[data-v-hash]` attribute selector out-specifies a plain class in `custom.css`
regardless of load order — documented inline in the CSS.

Base font swapped to a system-ui stack (no bundled Inter woff2), per decision 4's "no external font"
call — this is also global/site-wide already, same reasoning as the color tokens.

**Code-sample iteration (same session, user feedback after the first pass):** the first cut of the
`checkout.tflw` sample only showed the API half clearly (`open` + one visibility check reads as an
afterthought); asked to strengthen the browser half and work in another feature worth showing.
Landed on a fuller "login → seed-via-API → drive-UI → assert-backend-state" story — the exact
phrase `getting-started.md`'s "Why tflw" text uses — that now demonstrates, in one 11-line sample:
the `unique email` generator (`let email = unique email`), an inline request body literal, a
browser `click` interaction (not just page-open), and a closing API call that re-asserts the
backend state the UI action caused. Caught two real accuracy bugs while building it, both against
`guide/*.md` ground truth before they shipped: the mockup's `navigate` isn't a real keyword (it's
`open`, confirmed in `guide/browser-basics.md`), and **tflw test blocks are indentation-delimited,
not brace-delimited** (`guide/first-test.md` — "Blocks are indentation-delimited — the same offside
rule Python uses") — the original sample wrapped the whole test in `{ }`, which every guide example
contradicts. Fixed before the homepage ever showed invalid syntax for the language's own front door.

**Verified in a real browser** (Playwright, both themes, desktop 1400px + mobile 420px, per this
workspace's UI-verification rule): light and dark both read correctly; caught and fixed two real
bugs found only by looking — a CSS comment containing a stray `--vp-c-*/--vp-*`accidentally closed
early (the `*/` inside it), and the default theme's mobile hero ordering put the code panel *above*
the headline (fine for an avatar-style image, wrong for a code sample) — forced `.main`/`.image`
order explicitly instead. `npm run build` clean before and after both fixes.

### M4 — Site-wide visual consistency pass

- Extend M3's tokens to `guide/`, `reference/`, `grammar.md`, `editor.md`, `playground/index.md`.
- Restyle (not rewrite) the Playground.vue and the 6 live editor-demo Vue components
  (`editor/*.vue`) to match the new chrome — their actual parser/LSP wiring is untouched.
- Verify the shiki `tflw`/`tflw-config` syntax highlighting (via the VS Code TextMate grammar,
  `.vitepress/config.ts`'s `markdown.languages`) still reads well against the new palette.

**M4 done (2026-07-29):** First checked how much of this was already covered by M3's token
overrides, since `custom.css` redefines `--vp-c-*`/`--vp-*` at `:root`/`.dark` scope, which
VitePress's own default theme already threads through everything, not just the homepage. Confirmed
by reading the shipped default-theme CSS directly: `guide/`, `reference/`, `grammar.md`, `editor.md`,
and `playground/index.md` are all plain `.vp-doc` markdown content — headings, prose, `<table>`s
(the four generated reference pages), and code-fence chrome all consume the same tokens M3 already
repointed, so no new CSS was needed for the content pages themselves.

What did need work: **`Playground.vue`** and the **6 live editor-demo components**
(`editor/*.vue`) each hand-roll their own scoped `<style>` chrome (outer panel border/radius,
textareas, dropdowns, popups) using `var(--vp-c-*)` already, but at the *old* theme's `8px`/`6px`
radii, which now reads inconsistent next to M3's `4px` hairline identity. Standardized every
site-token-styled element (the outer `.{name}-demo`/`.playground` wrapper, textareas, the
autocomplete dropdown, and its list items) down to `4px` across all 7 files.

Deliberately left alone: the 5 components that render a live code panel (`DiagnosticsHoverDemo`,
`GoToDefinitionDemo`, `HighlightingDemo`, `RenameDemo`, `SignatureHelpDemo`) hardcode VS-Code-dark
colors (`#1e1e1e` bg, `#d4d4d4` text, syntax-token hex values) and a couple of `6px`/`3px`/`2px`
radii *inside* that emulated-editor chrome, independent of the site's own light/dark toggle —
`HighlightingDemo.vue`'s own comment already flags this as deliberate ("picked for legibility, not
to match any specific VS Code theme"). Confirmed with the user before proceeding: keep it exactly
as-is, since it's a legitimate "this is a real editor" visual choice, not drift to fix.

Verified the shiki `tflw`/`tflw-config` highlighting in a real browser, both themes:
`guide/first-test.md`'s three tagged code fences render full syntax coloring, and the keyword color
in both themes lands close to the site's own brand amber — a happy reinforcement of the new
identity rather than a clash. Along the way, found (but left out of scope, since it's a content-
tagging question, not a token/palette one) that many guide chapters have plain, untagged ` ``` `
fences alongside their `tflw`-tagged ones — those render with zero shiki coloring by design (no
language, nothing to tokenize), e.g. `guide/debugging.md` has 14 bare fences vs. none tagged `tflw`.
Not a regression from this milestone and not the same axis M1 already audited (messaging staleness,
not highlighting coverage) — noted here as a possible future follow-up, not fixed.

`npm run build` clean throughout. Real-browser spot check (Playwright, both themes, desktop 1400px):
`/editor` (all 6 live demos), `/playground`, `/reference/matchers` (generated table), and
`/guide/first-test` (tagged code fences) — all read correctly, hairline chrome now matches the
homepage's 4px identity, no regressions.

**Nav-chrome follow-up (user feedback after the pass above):** `grammar.md`/`editor.md`/
`playground/index.md` had no left sidebar at all (`config.ts` only defined sidebar keys for
`/guide/` and `/reference/`), which the user flagged as inconsistent next to guide/reference's
page-list sidebar. Added a `'/'` fallback sidebar (a "More" group linking Grammar/Editor/Playground/
Changelog — VitePress matches the longest path prefix, so this never overrides the more specific
`/guide/`/`/reference/` keys, and the `layout: home` homepage ignores sidebar config entirely).
Also tried moving the "On this page" heading outline to the left via `themeConfig.aside: 'left'`,
per an initial follow-up request — reverted immediately after, per explicit feedback that the
outline reads better in VitePress's default right-hand position, not sandwiched between the two
left-hand lists. Verified in a real browser, both themes: every page now has the same left
page-list sidebar, and the outline stays on the right where it always was.

### M5 — "What's new" page

- New `packages/docs-site/whats-new.md`, new nav item (see decision 2 for exact placement/naming),
  short hand-written "recently shipped" + "coming next" sections, link down to `/changelog`.
- Sidebar/nav wiring in `.vitepress/config.ts`.

**M5 done (2026-07-29):** New `whats-new.md` — a ~20-line hand-written page (per decision 2, not
generated): a "Recently shipped" list (browser interaction steps, network stubbing/a11y/visual-
regression, `tflw watch`/`pick`, the real LSP powering the VS Code extension, `tflw
check`/`refactor apply`/`migrate`) and a "Coming next" list in plain capability language —
"Performance and load testing," "Security-testing features" — no internal M-numbers or PLAN.md
decision IDs, per decision 2's explicit instruction. Opens with a line pointing down to
`/changelog` for the full version-by-version record; doesn't replace changelog.md's own nav slot,
per decision 2's rejection of that option.

New nav item `"What's new"` added between Playground and Changelog (`.vitepress/config.ts`), and
added to the `'/'` fallback sidebar group alongside Grammar/Editor support/Playground/Changelog (M4's
nav-chrome fix) so the page gets the same left page-list + right outline chrome as every other
standalone page. `npm run build` clean; `scripts/verify-samples.mjs` still 21/21 (the page has no
`.tflw` code fences). Verified in a real browser, both themes, desktop 1400px.

### M6 — Final verification

- `npm run docs:build` (or equivalent) clean.
- Internal link check across the whole site (nothing pointing at a renamed/removed page from M1-M5).
- Real-browser spot check (light + dark) of the homepage and at least one guide/reference/editor
  page — this workspace's standing rule: UI changes get verified in an actual browser, not just a
  clean build.
- `docs-site`'s existing sample-verification script (`scripts/verify-samples.mjs`, 21/21 today)
  still green.

**M6 done (2026-07-29):** `npm run build` clean on a fully cache-cleared build (`rm -rf
.vitepress/cache .vitepress/dist` first) — VitePress's own dead-link checker runs on every build
and stays on by default (`ignoreDeadLinks` is unset), so this doubles as the link check. Cross-
checked by hand too: every `](/...)` content link across the site, plus every `link:` value in
`.vitepress/config.ts`'s nav/sidebar, resolves to a real page. `scripts/verify-samples.mjs`: 21/21.

Real-browser spot check (Playwright MCP): homepage in light + dark + a 420px mobile width (the
highest-risk page, given M3's viewport-dependent hero-ordering CSS — confirmed no regression:
headline still leads, code panel still second), `guide/browser-basics` (dark), `reference/cli`
(dark — a reference page with real headings, unlike `matchers.md`), and `editor` (dark + light).
Nav's `What's new` item and the M4 nav-chrome fix (left page-list sidebar, outline back on the
right per the last revert) all render correctly everywhere checked.

All six milestones of this plan are now done. The docs site accurately represents the shipped
API+browser+LSP surface, carries the "Systems Console" visual identity site-wide, and has a
lightweight "what's new" summary alongside the full changelog.

// What each panel is for, one entry per panel — `M240` `D` (`D1312`).
//
// The paragraphs every view used to draw at rest, moved behind the legend's `?` with the docs page
// that says the rest. A panel's own prose is now its facts; its explanation is here, once.

import type { LegendEntry } from './Legend';

const DOCS = 'https://deepak-tuteja.github.io/tflw/';

export const LEGEND_PANELS: readonly LegendEntry[] = [
  {
    title: 'Compose',
    text: 'The file as a sequence of statements. Pick a row to edit it; send shows what came back and grades nothing — Run grades.',
    href: `${DOCS}ui/api`,
  },
  { title: 'Source', text: 'The file’s bytes, and what the checker says about them. Edits here and in Compose are one buffer.', href: `${DOCS}ui/spine` },
  { title: 'Run', text: 'Every run of this project, newest first. A run is kept as a report you can reopen and compare.', href: `${DOCS}ui/a-run` },
  {
    title: 'Auth',
    text:
      'Who each test runs as, in the env this page reads — switch it with --env or TFLW_ENV. anonymous is built in and reserved: a test with no `as` runs as it, and has no authorization violations probes with it. A session does not log the browser in: its cookie jar is never applied to a test’s browser context. A target with no probe opt-in gets read-only probes: no mutating request, oversized input, traversal payload or cipher handshake. On SCANS every request is replayed as each declared session; a privileged one is left out, because reaching others’ resources is its job.',
    href: `${DOCS}guide/sessions`,
  },
  { title: 'Config', text: 'tflw.config for this env: base URLs, timeouts, and the credentials the env names.', href: `${DOCS}guide/config` },
];

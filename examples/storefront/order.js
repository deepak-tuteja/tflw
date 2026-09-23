// The order page's behaviour. A file and not an inline `<script>`, for the same reason
// `shelf.css` is a file: `Content-Security-Policy: default-src 'self'` blocks inline scripts, and
// a page that inlines one still passes `sec/csp-missing` while doing nothing at all.
//
// Nothing here is a framework and nothing here is a trick. Every handler is the smallest thing
// that makes the gesture above it real, because a test that drives a fake is a test of the fake.
'use strict';

const $ = (id) => document.getElementById(id);

// ---- the delivery estimate, which is the one thing on this page a shop does not own -----------
//
// It is fetched from another origin on purpose: `stub` in tflw answers a request the PAGE makes,
// and a page that only ever talks to its own server gives that statement nothing to do. Without a
// stub — and without that service existing — this says `unavailable`, which is the honest
// rendering of a supplier being down and is what the un-stubbed test asserts.
fetch('https://delivery.example.test/v1/estimate')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .then((d) => { $('estimate').textContent = `arrives ${d.day}`; })
  .catch(() => { $('estimate').textContent = 'unavailable'; });

// ---- search: type, press Enter, the list narrows -----------------------------------------------
$('q').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const needle = $('q').value.trim().toLowerCase();
  const rows = [...$('matches').querySelectorAll('li')];
  let shown = 0;
  for (const row of rows) {
    const hit = needle === '' || row.textContent.toLowerCase().includes(needle);
    row.hidden = !hit;
    if (hit) shown += 1;
  }
  $('matches-count').textContent = `Showing ${shown} of ${rows.length}`;
});

// ---- the saved line: remove behind a confirmation, or drag it into the basket -------------------
$('saved').querySelector('button').addEventListener('click', () => {
  // A real `confirm()`, which is what `accept dialog` and `dismiss dialog` are about. A page that
  // draws its own modal would exercise neither.
  if (window.confirm('Remove Filter coffee, 1kg from your saved items?')) {
    $('saved-line').remove();
    $('kept').hidden = true;
  } else {
    $('kept').hidden = false;
  }
});

const line = $('saved-line');
line.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'saved-line'); });
for (const type of ['dragenter', 'dragover']) $('basket').addEventListener(type, (e) => e.preventDefault());
$('basket').addEventListener('drop', (e) => {
  e.preventDefault();
  if (!document.body.contains(line) || line.parentElement === $('basket')) return;
  // **`append` MOVES the node; it does not copy it — and the first draft removed it instead.**
  // That is what a shop means: it is the same line, in a different list.
  //
  // It was also, for one milestone, what tflw's `drag` *required*, and this comment said so.
  // `performDrag` finished by dispatching `dragend` on the source **locator**, so a handler that
  // removed its own source left that last dispatch waiting 30 s for an element that was gone —
  // measured, with the drop itself already landed. **That is fixed** (`M234-01`, repaired in
  // `M236` `A`: the source element is held, not re-queried), so `append` is here because it is
  // what a shop means and for no other reason. A handler that removed or re-rendered the line
  // would work too, and `packages/runtime/test/browser-steps.test.ts` proves all three.
  $('basket').append(line);
  $('moved').hidden = false;
});

// ---- the purchase order, dropped as a file rather than chosen from a picker --------------------
for (const type of ['dragenter', 'dragover']) $('po-drop').addEventListener(type, (e) => e.preventDefault());
$('po-drop').addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (!file) return;
  file.text().then((text) => {
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    // The header row is not an order line, which is the sort of thing a bulk importer gets wrong.
    $('po-read').textContent = `${lines.length - 1} order lines read from ${file.name}`;
    $('po-read').hidden = false;
  });
});

// ---- the form says back what it was told --------------------------------------------------------
//
// A shop that swallows what you typed is a shop you cannot check, and so is a test: `expect field
// "Town" equals "Bristol"` is `TF042` — `equals` reads a value and a locator is not one — so the
// page has to *show* what it took. Echoing the two fields that change the order is what a
// delivery form does anyway.
$('delivery').addEventListener('input', () => {
  const town = $('delivery').elements.city.value.trim();
  $('to').textContent = town === '' ? 'Delivering to nowhere yet' : `Delivering to ${town}`;
});
$('delivery').elements.grind.addEventListener('change', (e) => {
  $('grind-note').textContent = `Ground for ${e.target.value}`;
});

// ---- saving: the answer arrives after the click, not with it -----------------------------------
$('save').addEventListener('click', () => {
  // A deliberate delay. `wait until … is visible` exists for the gap between a press and its
  // answer, and a page that answers synchronously never opens one.
  window.setTimeout(() => { $('toast').hidden = false; }, 400);
});

// ---- the note that only a pointer reveals ------------------------------------------------------
$('why').addEventListener('mouseenter', () => { $('why-note').hidden = false; });
$('why').addEventListener('focus', () => { $('why-note').hidden = false; });

// **`+ step…` — the rest of the browser vocabulary, as a dialog** (`M219` `E`, `D1164`).
//
// WHY A DIALOG AND NOT MORE BUTTONS. The sequence column is **300 px** and the API door's four
// `+` buttons already wrap to two rows in it. Twenty-one would be six rows of chrome under every
// test, which is the *"still a lot of mess on compose page"* the whole `M214`–`M219` arc was
// opened by.
//
// WHY THESE ARE THE ONES BEHIND IT, MEASURED. `click` (874), `fill` (493) and `open` (378) are
// **73% of the corpus's 2395 browser statements**; the tail is 217 occurrences spread over the
// rest. So the foot keeps the three everybody writes plus `let` and `record`, and the tail is one
// press away rather than always on screen.
//
// **`within` is not in this list, and that is `D1163` rather than an omission.** A scope is a
// *field on a row* now — the `⤹` on a statement wraps it — so its 433 occurrences leave the `+`
// vocabulary entirely, which is most of why the tail is as small as it is.
//
// IT IS `M217`'s DIALOG SHAPE, AND IT INHERITS ITS DEFECT REPORT (`D1141`). `NewThing` previewed
// and wrote from the **saved** bytes while the pane was holding a pending edit, so creating wrote
// one file to disk while the pane showed another. This builds its preview from the same text it
// stages, which is the text the author has — the buffer, never the disk.
import { useMemo, useState } from 'react';
import { buildClick, insertIntoSource, print, STEP_LENS, type Step, type StepPath } from '@tflw/lang';
import { ScriptRow, type RowEditing, type StatementEdit } from './parts';
import { SourceText } from './Source';
import { buildStatement } from './statements';
import type { OutlineStatement, OutlineTest } from './outline';

/** What each kind is called in the list, and the one line that says when you would reach for it.
 *  The order is the corpus's, commonest first — a list sorted alphabetically puts `accept dialog`
 *  above `press` for no reason a reader benefits from. */
const CATALOGUE: readonly { readonly kind: Step['type']; readonly label: string; readonly about: string }[] = [
  { kind: 'SelectStmt', label: 'select', about: 'choose an option in a dropdown' },
  { kind: 'PressStmt', label: 'press', about: 'a key or a chord — `Enter`, `Control+A`' },
  { kind: 'TickStmt', label: 'tick', about: 'check a checkbox' },
  { kind: 'UntickStmt', label: 'untick', about: 'uncheck a checkbox' },
  { kind: 'HoverStmt', label: 'hover', about: 'put the pointer on something without clicking it' },
  { kind: 'ScrollStmt', label: 'scroll to', about: 'bring an element into view' },
  { kind: 'FillFormStmt', label: 'fill form', about: 'several fields in one step, as a table' },
  { kind: 'WaitUntilUiStmt', label: 'wait until', about: 're-read the page until the condition holds, instead of pausing and hoping' },
  { kind: 'AcceptDialogStmt', label: 'accept dialog', about: 'answer a native confirm or prompt' },
  { kind: 'DismissDialogStmt', label: 'dismiss dialog', about: 'cancel a native dialog' },
  { kind: 'ScreenshotStmt', label: 'screenshot', about: 'an image in the report — kept when the run has `evidence full`' },
  { kind: 'StubStmt', label: 'stub', about: 'answer a request the page makes, without the real service' },
  { kind: 'SwitchToTabStmt', label: 'switch to tab', about: 'work against a tab that is already open, by number' },
  { kind: 'CloseTabStmt', label: 'close tab', about: 'close the tab in front and go back to the one before it' },
  { kind: 'SwitchToNewTabBlock', label: 'switch to new tab', about: 'the gesture inside it runs against the tab the page just opened' },
  { kind: 'DownloadBlock', label: 'download as', about: 'bind the file the gesture inside it downloads' },
  { kind: 'DragStmt', label: 'drag', about: 'drag one element onto another' },
  { kind: 'DropFileStmt', label: 'drop file', about: 'drop a file from disk onto an element' },
];

/**
 * The kinds this dialog offers on a door — the vocabulary's own `constructs`, minus what the foot
 * already has and minus `within`.
 *
 * **It is filtered from the table rather than listed again**, so a kind the language gains reaches
 * the dialog the day `STEP_LENS` and `CATALOGUE` agree about it — and a kind in `CATALOGUE` that
 * the door cannot construct is dropped rather than drawn dead.
 */
export function stepCatalogue(constructs: ReadonlySet<Step['type']>, inFoot: readonly string[]): typeof CATALOGUE {
  return CATALOGUE.filter((c) => constructs.has(c.kind) && !inFoot.includes(c.label) && STEP_LENS[c.kind] !== null);
}

/**
 * A kind's starting values — the placeholders `+ click` has written since `M213` `S4`.
 *
 * **`change me` reads as unfinished on purpose** (`M213` `S4`'s own finding): an empty locator is
 * refused outright by the builder, so the choice was never *blank or plausible* — it was
 * *plausible or obviously unfinished*, and a default reading `"Buy"` is a test that looks written
 * and asserts about an element nobody chose.
 */
export function defaultEdit(kind: Step['type']): StatementEdit | null {
  switch (kind) {
    case 'HoverStmt':
    case 'ScrollStmt':
      return { kind: 'locatorOnly', of: kind, locatorKind: 'button', locator: 'change me' };
    case 'TickStmt':
    case 'UntickStmt':
      return { kind: 'locatorOnly', of: kind, locatorKind: 'field', locator: 'change me' };
    case 'SelectStmt':
      return { kind: 'select', locatorKind: 'field', locator: 'change me', value: '"change me"' };
    case 'PressStmt':
      return { kind: 'press', keys: 'Enter', locatorKind: 'field', locator: '' };
    case 'DismissDialogStmt':
    case 'CloseTabStmt':
      return { kind: 'bare', of: kind };
    case 'AcceptDialogStmt':
      return { kind: 'acceptDialog', text: '' };
    case 'SwitchToTabStmt':
      return { kind: 'switchToTab', index: '0' };
    case 'ScreenshotStmt':
      return { kind: 'screenshot', name: 'change me' };
    case 'DropFileStmt':
      return { kind: 'dropFile', filePath: './change-me', locatorKind: 'css', locator: 'change me' };
    case 'DragStmt':
      return { kind: 'drag', fromKind: 'css', from: 'change me', toKind: 'css', to: 'change me' };
    case 'FillFormStmt':
      return { kind: 'fillForm', rows: [{ field: 'change me', value: '"change me"' }] };
    case 'StubStmt':
      return { kind: 'stub', method: 'GET', urlPattern: '**/change-me', status: '200', body: '' };
    case 'WaitUntilUiStmt':
      /* `text "…" is visible` is the shape 31 of the corpus's 34 `wait until` steps take. */
      return {
        kind: 'waitUntilUi',
        expect: {
          soft: false, negated: false, quantifier: '', subject: 'locator', argument: 'change me',
          locatorKind: 'text', matcher: 'visible', operand: '', subset: [], severityFloor: '',
          schemaName: '', schemaSource: '', schemaService: '', filePath: '', snapshotName: '',
        },
        hold: '',
        wait: '',
      };
    case 'SwitchToNewTabBlock':
      return { kind: 'switchToNewTab' };
    case 'DownloadBlock':
      return { kind: 'download', name: 'file' };
    default:
      return null;
  }
}

/**
 * The body a block starts with — one placeholder gesture, for the reason every other placeholder
 * exists: `buildSwitchToNewTab` refuses an empty body and it is right to, because the bytes would
 * not parse back. A block offered and then refused on press is a control that does not work.
 */
export const BLOCK_SEED: Step = (() => {
  const built = buildClick({ locator: { kind: 'button', value: 'change me' }, kind: 'single' });
  /* Through the builder, like everything else: this is a node the page writes into a file, and
     `D1087` does not have an exception for a seed. */
  if (!built.ok) throw new Error(built.reason);
  return built.node;
})();

export function AddStep({ decl, into, anchor, offers, pick, onStage, onCancel }: {
  readonly decl: OutlineTest;
  /** The file **as the author has it** — the buffer, never the disk (`D1141`). */
  readonly into: string;
  /** Where the step lands: under a statement, or at the foot of the body when there is none. */
  readonly anchor: StepPath | null;
  readonly offers: typeof CATALOGUE;
  readonly pick: RowEditing['pick'];
  readonly onStage: (text: string) => void;
  readonly onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<Step['type']>(offers[0]?.kind ?? 'HoverStmt');
  const [filter, setFilter] = useState('');
  const [values, setValues] = useState<StatementEdit | null>(() => defaultEdit(offers[0]?.kind ?? 'HoverStmt'));

  const shown = offers.filter((o) => `${o.label} ${o.about}`.toLowerCase().includes(filter.trim().toLowerCase()));

  const built = useMemo(
    () => (values === null ? { ok: false as const, reason: 'nothing chosen yet' } : buildStatement(values, seedFor(chosen))),
    [values, chosen],
  );

  /** The bytes that land, from the text the author has — one value, previewed and staged. */
  const result = useMemo(() => {
    if (!built.ok) return { ok: false as const, reason: built.reason };
    return anchor === null
      ? insertIntoSource(into, { kind: 'steps', testName: decl.name, nodes: [built.node] })
      : insertIntoSource(into, { kind: 'stepsAfter', path: anchor, nodes: [built.node] });
  }, [built, into, anchor, decl.name]);

  /** A stand-in row, so the fields are the same controls the editor draws — `D1087` again: two
   *  field sets for one kind is how a dialog starts spelling a `press` the row cannot read back. */
  const row: OutlineStatement | null = built.ok
    ? {
        kind: built.node.type,
        line: 0,
        lens: STEP_LENS[built.node.type],
        text: print(built.node).ok ? (print(built.node) as { text: string }).text : '',
        note: null,
        nested: false,
        stepPath: null,
        inner: null,
        body: null,
        owner: null,
        node: built.node,
      }
    : null;

  return (
    <div className="new-thing" role="dialog" aria-modal="true" aria-label="a new step" data-add-step>
      <div className="new-thing-card">
        <h3>a new step in {decl.name}</h3>
        <label className="field">
          which
          <input value={filter} onChange={(e) => setFilter(e.target.value)} data-add-step-filter aria-label="filter" placeholder="type to narrow — press, dialog, tab…" />
        </label>
        <ul className="add-step-list" data-add-step-count={shown.length}>
          {shown.map((o) => (
            <li key={o.kind}>
              <button
                type="button"
                className={o.kind === chosen ? 'on' : ''}
                aria-pressed={o.kind === chosen}
                onClick={() => {
                  setChosen(o.kind);
                  setValues(defaultEdit(o.kind));
                }}
                data-add-step-kind={o.kind}
              >
                <code>{o.label}</code>
                <span className="muted">{o.about}</span>
              </button>
            </li>
          ))}
          {shown.length > 0 ? null : (
            <li className="muted" data-add-step-none>
              nothing here matches “{filter.trim()}”
            </li>
          )}
        </ul>

        {row === null || values === null || values.kind === 'expect' ? null : (
          <ScriptRow statement={row} edit={values} onEdit={setValues} trailing={null} pick={pick} />
        )}

        {/* The bytes, before the button — the same value the press stages (`D1087`, `M217` `C`). */}
        <pre className="preview" data-add-step-preview>{result.ok ? <SourceText text={result.text} /> : ''}</pre>
        {result.ok ? null : (
          <p className="muted" data-add-step-problem>
            {result.reason}
          </p>
        )}
        <div className="row">
          <button className="run" onClick={() => result.ok && onStage(result.text)} disabled={!result.ok} data-add-step-go>
            add it
          </button>
          <button onClick={onCancel} data-add-step-cancel>
            cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** A block needs a body before it can be built at all; everything else starts from nothing. */
function seedFor(kind: Step['type']): Step | null {
  if (kind === 'SwitchToNewTabBlock') return { type: 'SwitchToNewTabBlock', body: [BLOCK_SEED], span: BLOCK_SEED.span } as Step;
  if (kind === 'DownloadBlock') return { type: 'DownloadBlock', name: 'file', body: [BLOCK_SEED], span: BLOCK_SEED.span } as Step;
  return null;
}

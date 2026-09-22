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
  /* **The door-agnostic five** — `M213-06`, `M232` (`D1273`). Constructible on every door,
     `buildStatement` has had a case for each since `M214`, and none of them was offered anywhere.
     `let` is not among them because all four doors carry `+ let` in the foot, and `expect` because
     an assertion is a row of its own rather than a step you add. */
  { kind: 'CaptureStmt', label: 'capture', about: 'bind a value out of the last response, so a later step can use it' },
  { kind: 'LogStmt', label: 'log', about: 'a line in the report — what this step saw, in the run’s own output' },
  { kind: 'CallStmt', label: 'call', about: 'run an `action` declared elsewhere, without binding what it gives back' },
  { kind: 'GiveStmt', label: 'give', about: 'hand a value back from an `action` to whoever called it' },
  { kind: 'PauseStmt', label: 'pause', about: 'wait a fixed length of time — a last resort beside `wait until`' },
];

/**
 * The kinds this dialog offers on a door — the vocabulary's own `constructs`, minus what the foot
 * already has.
 *
 * **It is filtered from the table rather than listed again**, so a kind the language gains reaches
 * the dialog the day the door's vocabulary and `CATALOGUE` agree about it — and a kind in
 * `CATALOGUE` that the door cannot construct is dropped rather than drawn dead.
 *
 * **THE THIRD CLAUSE IS GONE AND IT WAS KEYED ON A PROXY** — `M213-06`, `M232` (`D1273`).
 *
 * It read `STEP_LENS[c.kind] !== null`, and its own docblock justified it as *a kind the door
 * cannot construct is dropped rather than drawn dead* — which is the **first** clause's job, and
 * the first clause does it correctly by asking the door. `STEP_LENS[kind] === null` does not mean
 * *no door*; it means **door-agnostic**, which is the opposite: `capture`, `let`, `log`, `give`,
 * `call` and `pause` are constructible on every door there is.
 *
 * It filtered nothing on the day it was written, because every `CATALOGUE` entry was a browser
 * kind — so it was not a live defect, it was a **trap**: the five rows added above would have been
 * accepted into the table, drawn nowhere, and reported by no gate. That is the shape this arc has
 * now met four times (`M225`–`M227` a rule keyed on one of three tenants, `M228` a proxy that
 * gained a second member, `M229` `A` a gate asserting the wrong property), and the fourth is the
 * only one that was harmless until somebody tried to use the thing it guarded.
 *
 * Refused, and named so it is not retried: giving the six a lens in `STEP_LENS` instead.
 * `STEP_LENS` decides which door a whole **test** appears behind (`D1043`), so lensing `LetStmt`
 * would move every test containing one and reshape the 4×5 landing grid. A page-local filter
 * defect must not become a language-wide reclassification.
 */
export function stepCatalogue(constructs: ReadonlySet<Step['type']>, inFoot: readonly string[]): typeof CATALOGUE {
  return CATALOGUE.filter((c) => constructs.has(c.kind) && !inFoot.includes(c.label));
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
    /* **The door-agnostic five** (`D1273`). Each seed is the shape its construct most often takes
       in the corpus, with `change me` wherever the author must choose — the same rule as above. */
    case 'CaptureStmt':
      /* `capture body.<path> as <name>` is what a capture almost always is: it exists to carry a
         value from one response into the next request. */
      /* `changeMe` and not `change me`: a body path is a path, and the builder refuses a name with
         a space in it — so the seed has to be unfinished-looking AND buildable, which is the same
         constraint `+ click`'s `change me` meets by sitting in a string. */
      return { kind: 'capture', subject: 'body', argument: 'changeMe', locatorKind: 'button', name: 'changeMe' };
    case 'LogStmt':
      return { kind: 'log', level: 'info', message: 'change me', destination: '' };
    case 'CallStmt':
      return { kind: 'call', name: 'change me', args: [] };
    case 'GiveStmt':
      return { kind: 'give', value: '"change me"' };
    case 'PauseStmt':
      /* Blank upper bound is a fixed pause, which all four in the corpus are. */
      return { kind: 'pause', min: '500ms', max: '' };
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

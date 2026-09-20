// **ONE CONSTRUCTION PATH, AS A FUNCTION** — `M219` `E` (`D1087`, `D1162`).
//
// Every statement the page writes goes through here: the row editor when a field changes, and
// `+ step…` when a kind is chosen from the dialog. It was a `switch` inside `ComposeDoor`'s
// `applyExpectEdit` until this round, which was fine while the only way to make a statement was
// to edit one that existed — and stopped being fine the moment a dialog had to build the same
// nineteen kinds before anything existed to edit. **A second switch beside this one is how a
// dialog starts writing a `press` the row editor cannot read back**, which is the drift `D1087`
// exists to refuse and the exact shape the legacy form failed in.
//
// It builds nothing itself. Each branch calls the language's own builder and returns its refusal
// unchanged, so the sentence a field shows is the sentence the parser would have produced.
import {
  buildAcceptDialog,
  buildCall,
  buildCapture,
  buildCheck,
  buildClick,
  buildCloseTab,
  buildDismissDialog,
  buildDownload,
  buildDrag,
  buildDropFile,
  buildExpect,
  buildFill,
  buildFillForm,
  buildGive,
  buildHover,
  buildLet,
  buildLog,
  buildOpen,
  buildPause,
  buildPress,
  buildScreenshot,
  buildScroll,
  buildSelect,
  buildStub,
  buildSwitchToNewTab,
  buildSwitchToTab,
  buildWaitUntilUi,
  buildWithin,
  type ApiStepSpec,
  type CaptureStmt,
  type DownloadBlock,
  type ExpectStmt,
  type Step,
  type SwitchToNewTabBlock,
  type WaitUntilUiStmt,
  type WithinBlock,
} from '@tflw/lang';
import { expectSpecOf, subjectSpecOf, type StatementEdit } from './parts';

export type BuiltStep = { readonly ok: true; readonly node: Step } | { readonly ok: false; readonly reason: string };

/**
 * A statement's controls, as a node.
 *
 * `original` is the node the row is editing, or `null` when nothing exists yet. It is what the
 * **carry** branches read: five of the language's sixteen subjects have no `SubjectSpec`, a
 * `status of request to "…"` carries a clause the spec has no room for, and a block's body is not
 * a thing a form can hold — so those go back on from the node rather than being rebuilt. With no
 * original, a `carried` subject or a block with no body is a refusal rather than a silent empty,
 * which is the honest answer to *build this from nothing*.
 */
export function buildStatement(next: StatementEdit, original: Step | null): BuiltStep {
  return ((): BuiltStep => {
    switch (next.kind) {
      case 'expect': {
        const from = original as ExpectStmt | null;
        const out = buildExpect(expectSpecOf(next.expect, from));
        if (!out.ok) return out;
        return {
          ok: true,
          node: {
            ...out.node,
            subject: next.expect.subject === 'carried' && from !== null ? from.subject : out.node.subject,
            masks: next.expect.matcher === 'matchesSnapshot' && from?.matcher.name === 'matchesSnapshot' ? from.masks : out.node.masks,
          },
        };
      }
      case 'capture': {
        const from = original as CaptureStmt | null;
        const out = buildCapture({ subject: subjectSpecOf(next.subject, next.argument, next.locatorKind, from?.subject ?? null), name: next.name });
        if (!out.ok) return out;
        return { ok: true, node: { ...out.node, subject: next.subject === 'carried' && from !== null ? from.subject : out.node.subject } };
      }
      case 'let':
        return buildLet({ name: next.name, value: next.value });
      case 'log':
        return buildLog({ level: next.level, message: next.message, destination: next.destination === '' ? null : next.destination });
      case 'call':
        return buildCall({ name: next.name, args: next.args });
      case 'give':
        return buildGive(next.value);
      case 'pause':
        return buildPause({ min: next.min, max: next.max });
      /* **The BROWSER door's whole vocabulary** — three until `M219` `C` (`D1162`). A locator
         is two fields on the node and two fields here, on all 2,296 corpus instances with no
         optional clause anywhere, which is why there is no panel for it. */
      case 'open':
        return buildOpen(next.path);
      case 'click':
        return buildClick({ locator: { kind: next.locatorKind, value: next.locator }, kind: next.clickKind });
      case 'fill':
        return buildFill({ locator: { kind: next.locatorKind, value: next.locator }, value: next.value });
      case 'locatorOnly': {
        const locator = { kind: next.locatorKind, value: next.locator };
        if (next.of === 'HoverStmt') return buildHover(locator);
        if (next.of === 'ScrollStmt') return buildScroll(locator);
        return buildCheck({ locator, ticked: next.of === 'TickStmt' });
      }
      case 'bare':
        return next.of === 'CloseTabStmt' ? buildCloseTab() : buildDismissDialog();
      case 'acceptDialog':
        return buildAcceptDialog(next.text);
      case 'switchToTab':
        return buildSwitchToTab(next.index);
      case 'screenshot':
        return buildScreenshot(next.name);
      case 'select':
        return buildSelect({ locator: { kind: next.locatorKind, value: next.locator }, value: next.value });
      case 'press':
        return buildPress({
          keys: next.keys,
          /* Blank is the page, which is a spelling rather than an empty field — `buildLocator`
             would refuse `field ""` and it would be right to, so the blank never reaches it. */
          locator: next.locator.trim() === '' ? null : { kind: next.locatorKind, value: next.locator },
        });
      case 'dropFile':
        return buildDropFile({ filePath: next.filePath, locator: { kind: next.locatorKind, value: next.locator } });
      case 'drag':
        return buildDrag({ from: { kind: next.fromKind, value: next.from }, to: { kind: next.toKind, value: next.to } });
      /* **A block's body is carried, never rebuilt** (`build.ts`'s family note, and `S2`'s
         rule). An edit to a block's head is an edit to its locator or its name; rebuilding the
         statements inside it from a form would be a second authoring surface for every one of
         them, which is what `D1087` exists to refuse. */
      case 'within':
        return buildWithin({
          locator: { kind: next.locatorKind, value: next.locator },
          frame: next.frame,
          body: (original as WithinBlock | null)?.body ?? [],
        });
      case 'switchToNewTab':
        return buildSwitchToNewTab((original as SwitchToNewTabBlock | null)?.body ?? []);
      case 'download':
        return buildDownload({ name: next.name, body: (original as DownloadBlock | null)?.body ?? [] });
      case 'fillForm':
        return buildFillForm({ rows: next.rows });
      case 'stub':
        return buildStub({ method: next.method as ApiStepSpec['method'], urlPattern: next.urlPattern, status: next.status, body: next.body });
      case 'waitUntilUi': {
        /* Same carry as an `expect`'s: five of the language's sixteen subjects have no
           `SubjectSpec`, so while the select still says `carried` the build runs against a
           stand-in and the node's own subject goes back on. */
        const from = original as WaitUntilUiStmt | null;
        const out = buildWaitUntilUi({
          expect: expectSpecOf({ ...next.expect, soft: false, quantifier: '' }, null),
          hold: next.hold,
          wait: next.wait,
        });
        if (!out.ok) return out;
        return { ok: true, node: next.expect.subject === 'carried' && from !== null ? { ...out.node, subject: from.subject } : out.node };
      }
    }
  })();
}

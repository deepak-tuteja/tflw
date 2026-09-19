// The Source tab — the file itself, and, while you are composing, the bytes the write will produce.
//
// `M205` `S5a` built this inside `ApiForm`; `M206` `S2a` lifted it out unchanged in behaviour,
// because **every door's Source tab is the same tab**. The rule says a tab is a stage of one file's
// life, and *reading the file* is a stage that does not vary by the kind of work you came to do —
// only Compose does. So this module is what the strip's second tab is, on all four doors, and the
// duplicate it would otherwise have become in BROWSER, LOAD and SCANS never exists.
//
// THE ATTRIBUTES LOST THEIR `api-` PREFIX HERE, and that is the point of the move rather than tidying
// after it. `data-api-source` on the BROWSER door would be a name asserting something untrue about
// the thing it labels — the exact drift class this repository files findings against — and a gate
// reading it would go on passing while saying the wrong word.
//
// `M209` `S2` GAVE IT AN INDEX (`D1067`). The sidebar has carried a row per test since `M192` U2,
// and three of the facts on that row are **derived** rather than read out of the file: the `crawl`
// and `workload` badges, and *this test is behind another door too*. `M209` `S3` takes the test
// rows out of the sidebar to make it a file tree, so those three facts had to land somewhere
// first, and the rule (`M205` §2) decides where: a tab is a stage of one file's life or a project
// fact it resolves against, so an *Outline* tab is not available and reading the file is exactly
// Source's stage. The index is built **before** the rows leave the tree, so no fact is ever absent
// from the page for the length of a commit.
//
// The index is NOT door-filtered, and that is `D1044` rather than an oversight: what a test shows
// is decided by its constructs and never by the door you came through. Every test in the file is
// listed; the door is a mark on the row and never a reason to omit one.
import { useRef } from 'react';
import type { diagnose } from './diagnose';
import type { FileView } from './api';
import type { Lens, ProjectView } from './contract';
import { DOOR_BY_ID } from './doors';
import { SourceText } from './Source';

export function SourcePanel({ file, pending, diagnostics, project, door }: {
  readonly file: FileView | null;
  readonly pending: { ok: true; text: string } | { ok: false; reason: string };
  readonly diagnostics: ReturnType<typeof diagnose>;
  /** The project as the server derived it — where the three derived facts come from. */
  readonly project: ProjectView;
  /** The door the reader came through, for the `also` badges. It marks rows; it hides none. */
  readonly door: Lens;
}) {
  const pendingText = pending.ok ? pending.text : null;
  const unwritten = pendingText !== null && file !== null && pendingText !== file.text;
  const shown = unwritten ? pendingText : (file?.text ?? '');
  const pre = useRef<HTMLPreElement>(null);

  const entry = file === null ? undefined : project.files.find((f) => f.path === file.path);
  /** Crawls and tests as one list in line order — the index is about the file, and the file does
   *  not sort its declarations by kind. */
  const index = [
    ...(entry?.crawls ?? []).map((c) => ({ kind: 'crawl' as const, name: c.name, line: c.line, lenses: c.lenses, tags: [] as readonly string[], workload: false })),
    ...(entry?.tests ?? []).map((t) => ({ kind: 'test' as const, name: t.name, line: t.line, lenses: t.lenses, tags: t.tags, workload: t.workload })),
  ].sort((a, b) => a.line - b.line);

  /** Scroll the text to a declaration's own line. The lines are spans so that there is something
   *  with a position to scroll to — `scrollIntoView` on a text node is not a thing. */
  const goToLine = (line: number) => {
    const target = pre.current?.querySelector(`[data-source-line="${line}"]`);
    target?.scrollIntoView({ block: 'center' });
  };

  return (
    <div className="authoring source-panel" data-source={unwritten ? 'pending' : 'written'}>
      <p className="muted" data-source-state>
        {file === null
          ? 'no file open'
          : unwritten
            ? <>what <code>{file.path}</code> becomes when you press <em>write</em> — not what is on disk yet</>
            : <>{file.path} — as it is on disk</>}
      </p>

      {/* The index (`D1067`). Empty is a real answer and says so out loud: six files in the sibling
          hold no test at all, and they are the most depended-on files in the project. A pane that
          rendered nothing for them would read as a failure to load. */}
      {file !== null ? (
        <div className="test-index" data-test-index={index.length} data-test-index-stale={unwritten ? 'yes' : 'no'}>
          {unwritten ? (
            <p className="muted warn" data-test-index-note>
              this index is what the file on disk holds — the bytes above are not written yet
            </p>
          ) : null}
          {index.length === 0 ? (
            <p className="muted" data-test-index-empty>
              this file declares no test — it is a fragment other files resolve against
            </p>
          ) : (
            <ul className="index-rows">
              {index.map((d) => (
                <li
                  key={`${d.kind}-${d.line}-${d.name}`}
                  className={d.lenses.includes(door) ? undefined : 'muted'}
                  data-source-test={d.name}
                  data-line={d.line}
                  data-test-lenses={d.lenses.join(' ')}
                  data-test-here={d.lenses.includes(door) ? 'yes' : 'no'}
                >
                  <button className="index-row" onClick={() => goToLine(d.line)} data-source-goto={d.line} title={`scroll to line ${d.line}`}>
                    <span className="muted ln">{d.line}</span> {d.name}
                  </button>
                  {d.kind === 'crawl' ? <span className="badge">crawl</span> : null}
                  {d.workload ? <span className="badge">workload</span> : null}
                  {/* Every OTHER door this declaration is behind — `D1043`'s membership-by-constructs,
                      which exists nowhere else on the page and would have been deleted rather than
                      moved if this tab had not taken it. */}
                  {d.lenses
                    .filter((l) => l !== door)
                    .map((l) => (
                      <span key={l} className="badge also" data-also={l}>
                        {DOOR_BY_ID[l].label}
                      </span>
                    ))}
                  {d.tags.map((tag) => (
                    <span key={tag} className="tag">
                      @{tag}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* Each line is its own span so the index has something with a position to scroll to. The
          text is reassembled exactly — `textContent` here is the file, byte for byte, which is
          what `D985` requires of a projection and what every gate reading `[data-preview]` asserts. */}
      <pre className="preview" data-preview ref={pre}>
        <SourceText text={shown} />
      </pre>
      {/* `D1052` — what `tflw check` will say about these bytes. Shown, never blocking: the write
          route refuses what cannot be read (`D1049`), and an unbound `{'{'}token{'}'}` reads fine — it is
          just wrong, and the author should hear it here rather than in CI. */}
      {unwritten && diagnostics.length > 0 ? (
        <ul className="preview-diagnostics" data-diagnostics={diagnostics.length}>
          {diagnostics.map((d, i) => (
            <li key={i} className={d.severity} data-diagnostic-code={d.code}>
              <code>{d.code}</code> line {d.span.start.line} — {d.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

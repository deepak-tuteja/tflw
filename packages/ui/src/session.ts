// What a recording hands back, before it is a test — `M219` `F` (`D1165`), drawn since `M256` `C`
// (`D1408`) as provisional rows in the steps column rather than in a panel of its own.
//
// **THE LINES ARE EVIDENCE UNTIL THEY ARE KEPT.** `D1095` appended the recorder's statements straight
// into the buffer, on the argument that the buffer is reversible. It is; what it is not is
// *reviewable* — a two-minute session writes thirty statements into the file, and the four
// mis-clicks are somewhere among them. So a line is kept by a gesture, and the statements are the
// recorder's own, parsed before they are believed. Nothing here builds anything.
//
// **A `pick` is no longer a session.** It answers *what goes in this field*, and the field is where
// its answer lands (`PickField`); the list of suggestions the panel used to repeat was the same
// answer drawn a second time.
import type { Step } from '@tflw/lang';

/** One line a recording produced. */
export type SessionLine =
  | { readonly id: number; readonly kind: 'step'; readonly text: string; readonly node: Step }
  /**
   * A line the recorder sent **on stdout** that the language could not read. Kept and shown rather
   * than dropped: a recorder that silently loses a gesture is one nobody can trust, and the raw line
   * is what a defect report needs (`D1076`). Reachable since `D1265` moved the banners to stderr.
   */
  | { readonly id: number; readonly kind: 'unreadable'; readonly text: string }
  /** Something the command said about itself on **stderr** — its banners, and the word it writes
   *  when it skips a gesture the builders refused. Never a statement, never keepable (`D1265`). */
  | { readonly id: number; readonly kind: 'notice'; readonly text: string };

export interface Session {
  readonly kind: 'record';
  /** Whether the browser is still open. Stopping keeps what was kept and drops the rest (`D1408`). */
  readonly live: boolean;
  readonly lines: readonly SessionLine[];
  /** The test a recording writes into, by name — the one address an insertion cannot move. */
  readonly into: string | null;
}

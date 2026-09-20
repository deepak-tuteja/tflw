// A column grip — the reader's own width, on a pane the builder used to pick for them (`M216`).
//
// **One mechanism, used twice** (`D1135`). It arrived in `A2` as the grip between the project pane
// and the work, and `E` needed the same thing between the Compose sequence and its editor. A
// second implementation of *drag, clamp, remember* is two places for a clamp to be wrong in, so
// this is the first one generalised: a `GripSpec` is the four numbers and the name, and everything
// below is the same for both.
//
// **Why it exists.** Both panes were one number in a grid and nothing moved either. Measured on
// `examples/storefront` at 1440x900: a declaration label gets **215 px** and the five in
// `tests/checkout.tflw` need **336-596 px**, so **5 of 5 were ellipsised** while **0 of 8** request
// rows were. `M210` `S1` had already measured that split and accepted it, because the full name is
// on the row's hover — which is true, and a tooltip is not something you can scan a list with.
//
// **It does not abolish truncation and is not meant to.** Showing the longest of those names whole
// needs a ~700 px pane, half a 1440 window, which is a worse trade than the ellipsis for anyone not
// currently hunting that one name. What a grip buys is that the trade is the READER'S, per project
// and per moment, rather than one number chosen once by the builder.
//
// **Keyboard, not just pointer** — the arrow keys move it 16 px and `Home` returns it to the
// default, because a control that only a mouse can reach is a control some readers do not have.
// `aria-valuenow` carries the width so the value is announced rather than inferred from a drag.
//
// **The width is the READER'S, so it is remembered here and nowhere else.** `localStorage`, keyed
// per origin, which is per served project: two projects open in two tabs keep their own widths, and
// nothing about a pane's width belongs in the project's files or on the server. `D1045`'s rule —
// *a view of a project rather than a fact about one* — is what puts the door in the hash; the same
// rule is what keeps this out of both.
import { useCallback, useEffect, useRef, useState } from 'react';

/** What a grip needs to know: its bounds, where it starts, what it remembers itself as, and what
 *  it is called out loud. Nothing else about the two instances differs. */
export interface GripSpec {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
  readonly key: string;
  readonly label: string;
}

/** The project pane. The floor is where the file tree's own indentation stops being readable; the
 *  ceiling is half of a 1440 window, past which the work is narrower than the index of it. */
export const SIDEBAR: GripSpec = {
  name: 'sidebar', min: 200, max: 720, fallback: 320,
  key: 'tflw.sidebar.width', label: 'project pane width',
};

/** The Compose sequence column (`D1135`). It was `minmax(220px, 300px)` — a builder's guess at how
 *  wide a list of statements needs to be, made once for every file. The bounds are that guess's own
 *  floor and a ceiling where the editor beside it stops being usable. */
export const COMPOSE: GripSpec = {
  name: 'compose', min: 220, max: 620, fallback: 300,
  key: 'tflw.compose.width', label: 'sequence column width',
};

const clamp = (spec: GripSpec, n: number): number => Math.min(spec.max, Math.max(spec.min, Math.round(n)));

/** Reads the remembered width. Storage is wrapped because a browser set to block site data throws
 *  on ACCESS, not on read — and a page that cannot lay out because it cannot remember a width is a
 *  worse failure than forgetting one. */
export function storedWidth(spec: GripSpec): number {
  try {
    const raw = window.localStorage.getItem(spec.key);
    if (raw === null) return spec.fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(spec, n) : spec.fallback;
  } catch {
    return spec.fallback;
  }
}

export function Grip({ spec, width, onWidth }: {
  readonly spec: GripSpec;
  readonly width: number;
  readonly onWidth: (width: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const from = useRef<{ x: number; w: number } | null>(null);

  const set = useCallback((next: number) => {
    const w = clamp(spec, next);
    onWidth(w);
    try {
      window.localStorage.setItem(spec.key, String(w));
    } catch {
      // a browser that will not remember it still lays out correctly this session
    }
  }, [onWidth, spec]);

  // The move and release listeners are on the WINDOW rather than the grip, because a pointer that
  // leaves a 6 px target mid-drag is the normal case and not an edge one.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      if (from.current === null) return;
      set(from.current.w + (e.clientX - from.current.x));
    };
    const up = () => {
      setDragging(false);
      from.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, set]);

  return (
    <div
      className={`col-grip ${spec.name}-grip${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={spec.label}
      aria-valuenow={width}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      tabIndex={0}
      data-grip={spec.name}
      data-grip-state={dragging ? 'dragging' : 'idle'}
      data-grip-width={width}
      data-tip="drag to resize · arrow keys to nudge · Home to reset"
      onPointerDown={(e) => {
        from.current = { x: e.clientX, w: width };
        setDragging(true);
        e.preventDefault();
      }}
      onDoubleClick={() => set(spec.fallback)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { set(width - 16); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { set(width + 16); e.preventDefault(); }
        else if (e.key === 'Home') { set(spec.fallback); e.preventDefault(); }
      }}
    />
  );
}

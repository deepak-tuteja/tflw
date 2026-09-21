// A column grip — the reader's own width, on a pane the builder used to pick for them (`M216`).
//
// **One mechanism, used THREE times** (`D1135`, and `D1199` for the third). It arrived in `A2` as
// the grip between the project pane and the work, `E` needed the same thing between the Compose
// sequence and its editor, and `M223` `E` needed it a third time between the authoring pane and
// the playback region. A second implementation of *drag, clamp, remember* is two places for a
// clamp to be wrong in, so this is the first one generalised: a `GripSpec` is the numbers, the
// name, and — since `M223` — which way it moves and which side of it grows.
//
// **`axis` and `sizes` are two fields because they are two facts, and collapsing them would be
// wrong.** A column grip lies vertically and sizes the pane BEFORE it; a row grip lies
// horizontally and, here, sizes the region AFTER it. Neither follows from the other: a row grip
// sizing the region above it is a perfectly ordinary arrangement, and a spec that inferred the
// sign from the axis would be right for these three instances and silently wrong for the fourth.
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

/** What a grip needs to know: which way it moves, which side of it it sizes, its bounds, where it
 *  starts, what it remembers itself as, and what it is called out loud. Nothing else about the
 *  three instances differs. */
export interface GripSpec {
  readonly name: string;
  /** `x` — a vertical bar between two columns; `y` — a horizontal bar between two rows. */
  readonly axis: 'x' | 'y';
  /** Which neighbour the stored number is the size of. A pointer moving *away* from that
   *  neighbour makes it bigger, which is what decides the sign of every delta below. */
  readonly sizes: 'before' | 'after';
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
  readonly key: string;
  readonly label: string;
}

/** The project pane. The floor is where the file tree's own indentation stops being readable; the
 *  ceiling is half of a 1440 window, past which the work is narrower than the index of it. */
export const SIDEBAR: GripSpec = {
  name: 'sidebar', axis: 'x', sizes: 'before', min: 200, max: 720, fallback: 320,
  key: 'tflw.sidebar.width', label: 'project pane width',
};

/** The Compose sequence column (`D1135`). It was `minmax(220px, 300px)` — a builder's guess at how
 *  wide a list of statements needs to be, made once for every file. The bounds are that guess's own
 *  floor and a ceiling where the editor beside it stops being usable. */
export const COMPOSE: GripSpec = {
  name: 'compose', axis: 'x', sizes: 'before', min: 220, max: 620, fallback: 300,
  key: 'tflw.compose.width', label: 'sequence column width',
};

/**
 * **The playback region** — `M223` `E` (`D1199`).
 *
 * The third instance, and the one the user asked for by pointing at a **gap**: with a trace up,
 * `.compose-pane` sits on its 320 px floor and the viewer on its 620 px one, which is 994 px of
 * want in a 900 px window — so the page scrolls and the two can never be seen together at a size
 * anybody chose. The 14 px between them is `.stage`'s own `margin-top` and reads as a seam because
 * the two columns' bottom borders run across the full width immediately above it: a line that is
 * not a control, which is the same misreading `.split` produced before `D1197`.
 *
 * **It sizes the FRAME and not the section**, so `Home` restores `M221`'s viewer exactly — 620 is
 * the number `.stage-frame`'s own `min-height` has carried since that round, and a fallback
 * measured in section height would have been a different picture wearing the same number.
 *
 * **`min` is 160 and deliberately below the viewer's measured 606 px floor.** `M221` refused to
 * squeeze the viewer on the reader's behalf and was right to, on a builder's default; this is not
 * a default, it is a drag. `D1135`'s whole claim is that the trade is the reader's per project and
 * per moment, and a clamp that enforced 606 would hand back the refusal the user has just taken.
 */
export const STAGE: GripSpec = {
  name: 'stage', axis: 'y', sizes: 'after', min: 160, max: 1600, fallback: 620,
  key: 'tflw.compose.stage', label: 'playback height',
};

const clamp = (spec: GripSpec, n: number): number => Math.min(spec.max, Math.max(spec.min, Math.round(n)));

/** Reads the remembered size. Storage is wrapped because a browser set to block site data throws
 *  on ACCESS, not on read — and a page that cannot lay out because it cannot remember a size is a
 *  worse failure than forgetting one. */
export function storedSize(spec: GripSpec): number {
  try {
    const raw = window.localStorage.getItem(spec.key);
    if (raw === null) return spec.fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(spec, n) : spec.fallback;
  } catch {
    return spec.fallback;
  }
}

export function Grip({ spec, size, onSize }: {
  readonly spec: GripSpec;
  /** **`size`, not `width`, since `M223` `E`.** The name was accurate while both instances were
   *  columns and became a lie the moment one of them was a height — and a prop whose name says
   *  the wrong axis is the shape `M213-19` filed a defect about. */
  readonly size: number;
  readonly onSize: (size: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const from = useRef<{ pos: number; size: number } | null>(null);

  const set = useCallback((next: number) => {
    const w = clamp(spec, next);
    onSize(w);
    try {
      window.localStorage.setItem(spec.key, String(w));
    } catch {
      // a browser that will not remember it still lays out correctly this session
    }
  }, [onSize, spec]);

  /** Where the pointer is along this grip's axis, and which way *away from the neighbour it sizes*
   *  points. `sizes: 'after'` inverts the sign: the region below a row grip gets BIGGER as the
   *  pointer goes up. */
  const along = useCallback((e: PointerEvent): number => (spec.axis === 'x' ? e.clientX : e.clientY), [spec.axis]);
  const away = spec.sizes === 'before' ? 1 : -1;

  // The move and release listeners are on the WINDOW rather than the grip, because a pointer that
  // leaves a 6 px target mid-drag is the normal case and not an edge one.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      if (from.current === null) return;
      set(from.current.size + away * (along(e) - from.current.pos));
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
  }, [dragging, set, along, away]);

  /* A separator's `aria-orientation` is the orientation of the SEPARATOR, not of the axis it moves
     along: a grip between two columns is a vertical bar. Getting this backwards announces every
     grip as the opposite of what it is, which no visual gate can see. */
  const less = spec.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
  const more = spec.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
  return (
    <div
      className={`${spec.axis === 'x' ? 'col-grip' : 'row-grip'} ${spec.name}-grip${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation={spec.axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={spec.label}
      aria-valuenow={size}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      tabIndex={0}
      data-grip={spec.name}
      data-grip-state={dragging ? 'dragging' : 'idle'}
      data-grip-width={size}
      data-tip="drag to resize · arrow keys to nudge · Home to reset"
      onPointerDown={(e) => {
        from.current = { pos: spec.axis === 'x' ? e.clientX : e.clientY, size };
        setDragging(true);
        e.preventDefault();
      }}
      onDoubleClick={() => set(spec.fallback)}
      onKeyDown={(e) => {
        // The key that moves the pointer AWAY from the sized neighbour is the one that grows it,
        // which for `sizes: 'after'` is the one that reads as "less" along the axis.
        if (e.key === less) { set(size - 16 * away); e.preventDefault(); }
        else if (e.key === more) { set(size + 16 * away); e.preventDefault(); }
        else if (e.key === 'Home') { set(spec.fallback); e.preventDefault(); }
      }}
    />
  );
}

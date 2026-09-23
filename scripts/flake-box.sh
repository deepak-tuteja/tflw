#!/bin/bash
# flake-box.sh — the page gate, repeated, on the 2-core profile CI actually fails on (`M235` `A3`).
#
# WHY THIS EXISTS. Eight distinct tests in `ui-page.test.ts` and `ui-appearance.test.ts` failed on
# CI between 2026-09-18 and 2026-09-23 — 11 of 17 runs red — and the box was green on every one of
# them, every time. Four repairs were therefore diagnosed from CI logs after the fact rather than
# from a failure anyone could produce. This makes the failure producible.
#
# IT IS `sweep-box.sh` WITH THE SHARD REDEFINED. That script already builds the profile this needs
# and says so in its own comment: K rsync'd trees, each under its own virtual display, each pinned
# with `taskset`, because "Node's `availableParallelism()` sees the affinity mask, so a tree on two
# threads behaves as the 2-core runner every suite in this repository was tuned for". On a 16-thread
# box, K=8 gives `per=2` — `ubuntu-latest` exactly. `M194` §1 measured the case: eight page gates at
# once at 1.4x their solo time, 4.9 GB. So a shard here is a REPETITION, not a mutation.
#
# `--test-name-pattern` IS NEVER USED, AND THAT IS A RULE RATHER THAN A PREFERENCE (`A1b-3`). A
# filtered run of `ui-page.test.ts` that selects nothing runs no test and never exits; measured
# 2026-09-23, `rc=124` with a 15-byte log reading only `TAP version 13`. The rule stands; the
# harness must not produce the shape, and sharding by repetition sidesteps it entirely.
#
# **THIS COMMENT SAID `opens `before()`'s handles` UNTIL 2026-09-24 AND THAT WAS FALSE** (`M236`
# `E`, `M235-02`). It does not open them: `before()` is never run when zero tests are selected —
# `ui-page.test.ts`'s own `after()` docblock says so correctly — and `chromium.launch()` lives
# inside it. Re-measured on the box against a Chromium census: **0 before, 0 after**, `ps` naming
# no chrome process at all, on a run that hung the full 120 s. So this shape hangs with **no
# browser**, and the orphan Chromium that `A1b-2`'s process table caught belongs to a filtered run
# whose pattern MATCHED tests — a different shape, attributed to this one for a day. Two files in
# this repository disagreed and the disagreement was the diagnosis `M235-02` was filed missing.
#
# EVERY RUN IS BOUNDED BY ITS PROCESS GROUP, NOT BY ITS CHILD (`A1b-2`). `timeout` kills the process
# it spawned; `node --test`'s worker sits in another process group and outlives it. The same
# measurement above left an orphan worker running 10m55s after `timeout -k` had "killed" the run,
# on a box whose lease had already been released. So each run is `setsid`'d and killed by PGID.
# A bound that leaves the runaway behind is not a bound.
#
# AND EVERY RUN STATES ITS DENOMINATOR. A run that selected zero tests and a run still in progress
# look identical from outside; 52 minutes went by on that ambiguity. `tests_ran` is read off the TAP
# before any verdict is believed, and a zero makes the shard red however cleanly it exited.
set -u

# `A1b-2` — A BOUND MUST REACH TWO THINGS, AND MEASUREMENT IS WHAT SAID SO.
#
# `timeout` signals the process it spawned; an orphan worker was still running 10m55s after
# `timeout -k` had "killed" a run, on a box whose lease had already been released. Two drafts of the
# repair guessed at why. The process table answered it, taken live on 2026-09-23 while a hung run
# was up (`pid ppid pgid sess comm`):
#
#     3113395 3113393 3113395 3113395 xvfb-run     <- setsid took: its own session
#     3113405 3113395 3113395 3113395 Xvfb
#     3113420 3113395 3113395 3113395 node         <- the runner
#     3113426 3113420 3113395 3113395 node-22      <- THE WORKER: same session
#     3113483 3113426 3113483 3113483 chrome-headless  <- ITS OWN SESSION
#
# So there are two escapes and they need two mechanisms. **The node worker stays in the session**,
# which is why killing the session reaches it and why `timeout`, signalling one process, never did.
# **Chromium detaches into a session of its own**, so nothing session-scoped can reach it, ever —
# the descendants are therefore snapshotted while the tree is still alive and killed by pid.
#
# THE REFUSAL BELOW IS THERE BECAUSE THE FIRST DRAFT KILLED ITS OWN CALLER. If `setsid` does not
# take, the resolved session is this script's own and `pkill -s` on it kills the shell, the ssh
# command and the exec driver — observed as `exit 137` on a 24-second run. A cleanup that can
# destroy its caller is worse than no cleanup.
descendants () {                      # every pid under $1, depth-first, while the tree is alive
  local p=$1 c
  for c in $(pgrep -P "$p" 2>/dev/null); do echo "$c"; descendants "$c"; done
}

run_bounded () {                      # $1 seconds  $2 log  $3.. command
  local secs=$1 log=$2; shift 2
  local mysid; mysid=$(ps -o sess= -p $$ 2>/dev/null | tr -d ' ')
  setsid "$@" > "$log" 2>&1 &
  local pid=$! sid waited=0 kids=''
  sid=$(ps -o sess= -p "$pid" 2>/dev/null | tr -d ' ')
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$secs" ]; do
    kids=$(descendants "$pid")       # refreshed while alive; the snapshot is the only way to
    sleep 2; waited=$(( waited + 2 ))  # name a process that will re-parent itself out of reach
  done
  kill -0 "$pid" 2>/dev/null || { wait "$pid"; return $?; }

  if [ -n "$sid" ] && [ -n "$mysid" ] && [ "$sid" != "$mysid" ]; then
    pkill -9 -s "$sid" 2>/dev/null     # the runner, its worker, xvfb-run and Xvfb
  else
    echo "run_bounded: REFUSING the session kill — child session '${sid:-?}' is our own '${mysid:-?}'" >&2
  fi
  # shellcheck disable=SC2086
  [ -n "$kids" ] && kill -9 $kids 2>/dev/null   # chromium, which is in no session we own
  kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  return 124
}

# `A1b-2`'s control, and it models BOTH escapes the table above found: a descendant orphaned into
# our session, and a descendant that starts a session of its own the way Chromium does.
#
# THE CONTROL ASSERTS ITSELF FIRST (`M141`). If a plain `timeout` already leaves nothing behind, the
# repair below would pass for free — so that is checked, and a failure to reproduce is reported as a
# failure of the test rather than as a pass.
#
# The marker is a file on disk rather than a command string. The first draft matched `sleep 300`
# through a layer of shell quoting that ate the `&`, so `bash -c` got half the command and the rest
# ran in this script's own process group — which is exactly what the refusal above now catches.
if [ "${1:-}" = "--self-test" ]; then
  tmp=$(mktemp -d) || exit 2
  marker=$tmp/flake-sleeper.sh
  printf '#!/bin/bash\nsleep 600\n' > "$marker"; chmod +x "$marker"
  alive () { pgrep -f -c "$marker" 2>/dev/null || true; }
  reap ()  { pkill -9 -f "$marker" 2>/dev/null; sleep 1; }
  shape="'$marker' & setsid '$marker' & exec '$marker'"   # orphan + session-escapee + direct child
  fail=0

  timeout -k 1 3 bash -c "$shape" > /dev/null 2>&1
  sleep 2
  n=$(alive)
  if [ "${n:-0}" -eq 0 ]; then
    echo "self-test: CONTROL DID NOT REPRODUCE — plain timeout left nothing behind, so the repair"
    echo "self-test: below would pass for free. Do not trust it until this reproduces." >&2
    fail=1
  else
    echo "self-test: control ok — a plain timeout left ${n} descendant(s) running"
  fi
  reap

  run_bounded 4 "$tmp/st.log" bash -c "$shape"
  rc=$?
  sleep 2
  left=$(alive); left=${left:-0}
  echo "self-test: run_bounded rc=$rc (want 124), survivors=$left (want 0)"
  [ "$rc" -eq 124 ] || { echo "self-test: FAIL — the bound did not fire" >&2; fail=1; }
  [ "$left" -eq 0 ] || { echo "self-test: FAIL — $left descendant(s) outlived the bound" >&2; fail=1; }
  reap

  echo "self-test: the caller survived — this line printing at all is that assertion"
  rm -rf "$tmp"
  if [ "$fail" -eq 0 ]; then echo "self-test: PASS"; else echo "self-test: FAIL"; fi
  exit "$fail"
fi

K=${TFLW_FLAKE_K:-8}
REPEATS=${1:-50}
SUITE=${TFLW_FLAKE_SUITE:-test/ui-page.test.ts}
PER_RUN_TIMEOUT=${TFLW_FLAKE_TIMEOUT:-1200}
SRC=$PWD
OUT=$SRC/.flake-out
TREES=${TFLW_FLAKE_TREES:-$(dirname "$SRC")/flake}

if [ ! -f "$SRC/packages/cli/$SUITE" ]; then echo "flake-box.sh: no packages/cli/$SUITE in $SRC — run from the synced tree" >&2; exit 2; fi
if ! [[ "$K" =~ ^[1-9][0-9]*$ ]]; then echo "flake-box.sh: TFLW_FLAKE_K must be a positive integer, got '$K'" >&2; exit 2; fi
if ! [[ "$REPEATS" =~ ^[1-9][0-9]*$ ]]; then echo "flake-box.sh: repeats must be a positive integer, got '$REPEATS'" >&2; exit 2; fi

PER_TREE=$(( (REPEATS + K - 1) / K ))
TOTAL=$(( PER_TREE * K ))
rm -rf "$OUT"; mkdir -p "$OUT" "$TREES"
started=$(date +%s)
threads=$(nproc)
per=$(( threads / K )); [ "$per" -lt 1 ] && per=1
echo "flake: $SUITE x $TOTAL ($K tree(s) x $PER_TREE), $per thread(s) per tree of $threads"

for k in $(seq 1 "$K"); do
  rsync -a --delete --exclude coverage --exclude runs --exclude '.m*-scratch' --exclude .sweep-out \
        --exclude .flake-out "$SRC/" "$TREES/t$k/" || { echo "flake: copying tree $k failed" >&2; exit 2; }
done
echo "flake: copies made in $(( $(date +%s) - started ))s"

for k in $(seq 1 "$K"); do
  (
    cd "$TREES/t$k/packages/cli" || exit 2
    first=$(( ((k - 1) * per) % threads )); last=$(( first + per - 1 )); [ "$last" -ge "$threads" ] && last=$(( threads - 1 ))
    for r in $(seq 1 "$PER_TREE"); do
      log=$OUT/t$k-r$r.log
      s=$(date +%s)
      run_bounded "$PER_RUN_TIMEOUT" "$log" \
        taskset -c "$first-$last" xvfb-run -a node --import tsx --test --test-concurrency=1 "$SUITE"
      rc=$?
      ran=$(grep -cE '^(ok|not ok) [0-9]+ -' "$log")
      printf '%s\t%s\t%s\t%s\n' "$rc" "$ran" "$(( $(date +%s) - s ))" "t$k-r$r" > "$OUT/t$k-r$r.rc"
    done
  ) &
done
wait

# The tally. A run is red if it exited non-zero, if it timed out, or if it selected nothing.
{
  echo "flake: $TOTAL run(s) in $(( $(date +%s) - started ))s"
  red=0; hung=0; empty=0
  for f in "$OUT"/*.rc; do
    IFS=$'\t' read -r rc ran secs name < "$f"
    [ "$rc" -ne 0 ] && red=$(( red + 1 ))
    [ "$rc" -eq 124 ] && hung=$(( hung + 1 ))
    [ "$ran" -eq 0 ] && empty=$(( empty + 1 ))
  done
  echo "flake: $red red, $hung hung (rc=124), $empty selected nothing, of $TOTAL"
  echo "flake: per-test failures across all runs —"
  grep -h '^not ok [0-9]* - ' "$OUT"/*.log 2>/dev/null \
    | sed 's/^not ok [0-9]* - //' | sort | uniq -c | sort -rn | head -20
  echo "flake: (no lines above = no test failed in any run)"
  # THE DIAGNOSIS GOES TO STDOUT, NOT ONLY INTO `.flake-out`. `exec.mjs` rsyncs with `--delete`, so
  # the next `exec` that touches the box removes this directory — a summary whose detail lives only
  # in an artefact is a summary that can be lost by the next command anyone runs. Measured the hard
  # way on the first real sweep: the tally survived because it was `tee`d, the failure text did not.
  echo "flake: first failure detail —"
  for f in "$OUT"/*.log; do
    if grep -q '^not ok [0-9]* - ' "$f" 2>/dev/null; then
      echo "  (from $(basename "$f"))"
      sed -n '/^not ok [0-9]* - /,/^  \.\.\./p' "$f" | head -24 | sed 's/^/  /'
      break
    fi
  done
  echo "flake: slowest runs —"
  sort -t$'\t' -k3 -rn "$OUT"/*.rc 2>/dev/null | head -3 | awk -F'\t' '{print "  " $4 "  rc=" $1 "  ran=" $2 "  " $3 "s"}'
} | tee "$OUT/summary.txt"

grep -q . "$OUT"/*.rc || exit 2
awk -F'\t' '$1 != 0 || $2 == 0 { bad++ } END { exit (bad ? 1 : 0) }' "$OUT"/*.rc

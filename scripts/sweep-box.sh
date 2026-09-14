#!/bin/bash
# sweep-box.sh — the whole mutation registry on one machine, K trees at once (`M194`).
#
# Run on the box by `npm run sweep` (through `scripts/exec.mjs`, which syncs this tree, takes the
# box lease and hands off here), never from a checkout by hand: it copies the directory it is run
# in. K copies of the tree are made by rsync beside the synced tree, each runs one shard of
# `mutate.mjs` under its own virtual display, and `verify-shards.mjs` reassembles the K manifests
# into the registry — the same guard the runners' 33 shards used, with K in place of 33. Every
# artefact lands in `.sweep-out/` inside the synced tree so `exec.mjs pull .sweep-out` brings it
# back: one manifest and one log per shard, a return code per shard, and `summary.json`.
#
# K is 8 by measurement (`PLAN_M194_BOX_SWEEP.md` §1: eight page gates at once at 1.4× their solo
# time, 4.9 GB) and `TFLW_SWEEP_K` overrides it for a busy box. A shard's exit is the sweep's
# verdict about its mutations (a survivor exits non-zero); the reassembly is the verdict about the
# split. Both are in the summary and in this script's exit, and the summary is what `sweep.mjs`
# reads — a green line from a shard that never ran is the shape the manifests exist to refuse.
set -u

K=${TFLW_SWEEP_K:-8}
SRC=$PWD
OUT=$SRC/.sweep-out
TREES=${TFLW_SWEEP_TREES:-$(dirname "$SRC")/sweep}

if [ ! -f "$SRC/scripts/mutate.mjs" ]; then echo "sweep-box.sh: run from the synced tree (no scripts/mutate.mjs in $SRC)" >&2; exit 2; fi
if ! [[ "$K" =~ ^[1-9][0-9]*$ ]]; then echo "sweep-box.sh: TFLW_SWEEP_K must be a positive integer, got '$K'" >&2; exit 2; fi

rm -rf "$OUT"; mkdir -p "$OUT" "$TREES"
started=$(date +%s)
echo "sweep: $K tree(s) under $TREES, registry $(node -e "import('./scripts/mutate.mjs').then(m => console.log(m.MUTATIONS.length))")"

# The copies. `coverage/`, `runs/`, scratch and the previous output are not part of a tree a sweep
# needs, and the first one is 4.8 GB. `--delete` so a copy from a previous sweep converges on this
# tree rather than accumulating.
for k in $(seq 1 "$K"); do
  rsync -a --delete --exclude coverage --exclude runs --exclude '.m*-scratch' --exclude .sweep-out "$SRC/" "$TREES/t$k/" \
    || { echo "sweep: copying tree $k failed" >&2; exit 2; }
done
echo "sweep: copies made in $(( $(date +%s) - started ))s"

# One shard per tree, all at once. `xvfb-run -a` gives each its own display; a shard's stdout is
# its log, its manifest is what the reassembly reads, its return code is its verdict.
#
# Each tree is pinned to its own slice of the machine's threads. The first K=8 run without this
# sat at a load of ~60 on 16 threads: `node --test` runs a process per test file at a concurrency
# of cores-1, so eight runtime suites at once were ~120 processes fighting for sixteen threads.
# Under `taskset` Node's `availableParallelism()` sees the affinity mask, so a tree on two threads
# behaves as the 2-core runner every suite in this repository was tuned for, and the load caps at
# the thread count. With more trees than threads the slices wrap, which is oversubscription by
# choice rather than by accident.
threads=$(nproc)
per=$(( threads / K )); [ "$per" -lt 1 ] && per=1
for k in $(seq 1 "$K"); do
  (
    cd "$TREES/t$k" || exit 2
    first=$(( ((k - 1) * per) % threads )); last=$(( first + per - 1 )); [ "$last" -ge "$threads" ] && last=$(( threads - 1 ))
    s=$(date +%s)
    taskset -c "$first-$last" xvfb-run -a node scripts/mutate.mjs "--shard=$k/$K" "--manifest=$OUT/shard-$k.json" > "$OUT/shard-$k.log" 2>&1
    echo "$? $(( $(date +%s) - s ))" > "$OUT/shard-$k.rc"
  ) &
done
wait

# The verdicts, one line per shard, then the reassembly.
failed=0
summary="$OUT/summary.json"
{
  echo '{'
  echo "  \"k\": $K,"
  echo "  \"startedAt\": \"$(date -u -d @"$started" +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"wallSeconds\": $(( $(date +%s) - started )),"
  echo '  "shards": ['
  for k in $(seq 1 "$K"); do
    read -r rc wall < "$OUT/shard-$k.rc"
    survivors=$(grep -E '^✗ SURVIVED ' "$OUT/shard-$k.log" | sed -E 's/^✗ SURVIVED +([^ ]+).*/\1/' | tr '\n' ' ')
    killed=$(grep -cE '^✓ killed ' "$OUT/shard-$k.log")
    stale=$(grep -cE '^⚠ .* NOT RUN\.$' "$OUT/shard-$k.log")
    [ "$rc" != 0 ] && failed=1
    printf '    {"shard": %d, "exit": %d, "seconds": %d, "killed": %d, "stale": %d, "survivors": [%s]}%s\n' \
      "$k" "$rc" "$wall" "$killed" "$stale" "$(for s in $survivors; do printf '"%s",' "$s"; done | sed 's/,$//')" "$([ "$k" -lt "$K" ] && echo ,)"
    echo "shard $k/$K: exit $rc, ${wall}s, $killed killed${survivors:+, SURVIVED: $survivors}" >&2
  done
  echo '  ],'
  if (cd "$SRC" && node scripts/verify-shards.mjs "$OUT" "--of=$K" > "$OUT/reassembly.log" 2>&1); then
    echo '  "reassembled": true'
  else
    echo '  "reassembled": false'; failed=1
  fi
  echo '}'
} > "$summary"

cat "$OUT/reassembly.log"
echo "sweep: $(( $(date +%s) - started ))s wall; summary in .sweep-out/summary.json"
exit $failed

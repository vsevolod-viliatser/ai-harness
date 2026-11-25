#!/bin/bash
# The PR gate, run inside the box: the project's checks (project/config.json "checks", passed in by bin/box
# as HARNESS_CHECKS, one command per line; keep them the same as CI minus the slow build), then a lint ratchet.
# Arguments: the changed .ts/.tsx files.
set -eo pipefail
cd /work

while IFS= read -r check; do
  [ -n "$check" ] || continue
  bash -o pipefail -c "$check"
done <<< "${HARNESS_CHECKS:?bin/box passes HARNESS_CHECKS}"

# Lint ratchet: many files already carry lint errors (a real repo often has hundreds), so "the file lints clean" would
# force a small task to clean up debt it didn't create. Each changed file may not end up with MORE problems
# than it has on origin/main. A brand-new file starts from 0, so it must be clean.
count() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).reduce((n,r)=>n+r.errorCount+r.warningCount,0))}catch{console.log(0)}})'
}
fail=0
for f in "$@"; do
  # eslint exits 1 when it finds problems; `|| true` keeps that from tripping set -e/pipefail.
  before=$( { git show "origin/main:$f" 2>/dev/null | npx eslint --stdin --stdin-filename "$f" -f json 2>/dev/null || true; } | count)
  after=$( { npx eslint "$f" -f json 2>/dev/null || true; } | count)
  if [ "$after" -gt "$before" ]; then
    echo "LINT: $f went from $before to $after problems:"
    npx eslint "$f" | tail -25 || true
    fail=1
  else
    echo "lint ok: $f ($before -> $after problems)"
  fi
done
exit $fail

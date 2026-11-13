#!/usr/bin/env bash
# usage: run.sh <instdir> <script|-> <log> <termAfterSec|none> [killAfterSec]
# Boots <instdir>/Cuis7.8.image headless; optional SIGTERM after N s; reports rc and image change.
V=$HOME/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CuisVM.app/Contents/MacOS/Squeak
cd "$1" || exit 1; before=$(md5 -q Cuis7.8.image)
if [ "$2" = - ]; then S=(); else S=(-s "$2"); fi
"$V" -headless Cuis7.8.image "${S[@]}" -ApplePersistenceIgnoreState YES </dev/null > "$3" 2>&1 &
P=$!
( sleep "${5:-60}"; kill -9 $P 2>/dev/null ) & W=$!
if [ "$4" != none ]; then sleep "$4"; kill -TERM $P; fi
wait $P; rc=$?; kill $W 2>/dev/null
after=$(md5 -q Cuis7.8.image)
echo "$(basename "$1") $2 term=$4: rc=$rc image_changed=$([ "$before" != "$after" ] && echo yes || echo no)"
grep -v ApplePersistence "$3" | grep -E 'LOADED|REPORT|UNINST|RELOAD|IDLE|QUIT|rror|Undeclared' | cut -c33-200

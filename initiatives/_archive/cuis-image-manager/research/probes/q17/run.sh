#!/usr/bin/env bash
# usage: run.sh <instdir> <script|-> <log> <termAfterSec|none> [killAfterSec] [gui]
# Boots <instdir>/Cuis7.8.image (headless unless 6th arg is gui); optional SIGTERM after N s.
# Reports rc, image change and seconds from SIGTERM to exit.
V=$HOME/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CuisVM.app/Contents/MacOS/Squeak
cd "$1" || exit 1; before=$(md5 -q Cuis7.8.image)
if [ "$2" = - ]; then S=(); else S=(-s "$2"); fi
if [ "$6" = gui ]; then H=(); else H=(-headless); fi
"$V" "${H[@]}" Cuis7.8.image "${S[@]}" -ApplePersistenceIgnoreState YES </dev/null > "$3" 2>&1 &
P=$!
( sleep "${5:-60}"; kill -9 $P 2>/dev/null ) & W=$!
t0=0
if [ "$4" != none ]; then sleep "$4"; t0=$(perl -MTime::HiRes=time -e 'printf "%.2f", time'); kill -TERM $P; fi
wait $P; rc=$?; kill $W 2>/dev/null
t1=$(perl -MTime::HiRes=time -e 'printf "%.2f", time')
after=$(md5 -q Cuis7.8.image)
echo "$(basename "$1") term=$4: rc=$rc image_changed=$([ "$before" != "$after" ] && echo yes || echo no) exit_after_term=$(echo "$t1 - $t0" | bc)s"

#!/usr/bin/env bash
# usage: run.sh <dir> <script> <log> <timeout>   (foreground, kill -9 on timeout)
V=$HOME/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CuisVM.app/Contents/MacOS/Squeak
cd "$1"
"$V" -headless Cuis7.8.image -s "$2" -ApplePersistenceIgnoreState YES </dev/null > "$3" 2>&1 &
P=$!
( sleep "$4"; kill -9 $P 2>/dev/null ) &
W=$!
wait $P; rc=$?
kill $W 2>/dev/null
echo "rc=$rc"

#!/usr/bin/env bash
# usage: run.sh <instdir> <script> <log> <timeoutSec> [noapple]
# Boots headless with the script; kills -9 after timeout. Prints rc and the marker lines.
V=$HOME/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CuisVM.app/Contents/MacOS/Squeak
cd "$1" || exit 1
if [ "$5" = noapple ]; then A=(); else A=(-ApplePersistenceIgnoreState YES); fi
"$V" -headless Cuis7.8.image -s "$2" "${A[@]}" </dev/null > "$3" 2>&1 & P=$!
( sleep "$4"; kill -9 $P 2>/dev/null ) & W=$!
wait $P; rc=$?; kill $W 2>/dev/null
echo "$(basename "$2") $5: rc=$rc ($([ $rc = 137 ] && echo hung/killed || echo exited)) markers: $(grep -oE 'M[0-9][A-Za-z]*' "$3" | tr '\n' ' ')"

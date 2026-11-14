#!/usr/bin/env bash
# usage: run.sh <instance dir> <log> <timeout> <vm args...>   (cwd = <instance>/files)
V=$HOME/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CuisVM.app/Contents/MacOS/Squeak
D=$1; L=$2; T=$3; shift 3
cd "$D/files"
"$V" -headless ../image/Cuis7.8.image "$@" -ApplePersistenceIgnoreState YES </dev/null > "$L" 2>&1 &
P=$!
( sleep "$T"; kill -9 $P 2>/dev/null ) 2>/dev/null &
W=$!
wait $P; rc=$?
kill $W 2>/dev/null
echo "rc=$rc"

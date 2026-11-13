#!/usr/bin/env bash
# usage: relaunch.sh <dir>  -> boots image with idle script, SIGTERM after 10s, reports
SP=$(cd "$(dirname "$0")" && pwd)
V=$HOME/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CuisVM.app/Contents/MacOS/Squeak
cd "$SP/$1"; before=$(md5 -q Cuis7.8.image)
"$V" -headless Cuis7.8.image -s ../idle.st -ApplePersistenceIgnoreState YES </dev/null > relaunch.log 2>&1 &
P=$!
sleep 10; kill -TERM $P
( sleep 15; kill -9 $P 2>/dev/null ) & W=$!
wait $P; rc=$?; kill $W 2>/dev/null
after=$(md5 -q Cuis7.8.image)
echo "$1: rc=$rc image_changed=$([ $before != $after ] && echo yes || echo no)"
grep -v ApplePersistence relaunch.log | cut -c1-160 | tail -6

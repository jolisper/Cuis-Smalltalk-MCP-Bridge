#!/usr/bin/env bash
# usage: probe.sh <instdir> <script|-> <log> [seconds]
# Boots the image headless, every 0.5 s counts LISTEN sockets on 17901 owned by the VM,
# prints the first time a listener appears and the max count, then tries a handshake and kills -9.
V=$HOME/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CuisVM.app/Contents/MacOS/Squeak
cd "$1" || exit 1
if [ "$2" = - ]; then S=(); else S=(-s "$2"); fi
t0=$(perl -MTime::HiRes=time -e 'print time')
"$V" -headless Cuis7.8.image "${S[@]}" -ApplePersistenceIgnoreState YES </dev/null > "$3" 2>&1 &
P=$!; first=none; max=0; n=$(( ${4:-15} * 2 )); trace=""
for i in $(seq 1 $n); do
  sleep 0.5
  c=$(lsof -nP -a -p $P -iTCP:17901 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
  trace="$trace$c"
  [ "$c" -gt 0 ] && [ "$first" = none ] && first=$(perl -MTime::HiRes=time -e "printf '%.1f', time - $t0")
  [ "$c" -gt "$max" ] && max=$c
done
hs=$(printf '{"op": "handshake", "params": {"protocol_version": 3}}\n' | nc -w 2 127.0.0.1 17901 2>&1 | head -1)
kill -9 $P 2>/dev/null; wait $P 2>/dev/null
echo "$(basename "$1") $(basename "$2"): first_listen=${first}s max_listeners=$max trace=$trace"
echo "  handshake: $hs"

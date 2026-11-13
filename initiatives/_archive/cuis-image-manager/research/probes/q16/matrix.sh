#!/usr/bin/env bash
# For each kind of listener, on its own fresh port, run every check and print one row.
SP=$(cd "$(dirname "$0")" && pwd); BASE=${1:-17920}
check() { # $1 label, $2 port
  # connect runs last: a one-shot listener such as nc exits after accepting it
  l=$(lsof -nP -iTCP:$2 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
  b1=$(node "$SP/bindcheck.mjs" $2 127.0.0.1); b2=$(node "$SP/bindcheck.mjs" $2 0.0.0.0)
  b3=$(node "$SP/bindcheck.mjs" $2 default); c=$(node "$SP/connectcheck.mjs" $2)
  printf '%-22s lsof=%-3s bind127=%-10s bind0000=%-10s bindDefault=%-10s connect=%s\n' "$1" "$l" "$b1" "$b2" "$b3" "$c"
}
check "nothing" $BASE
i=1
for spec in "127.0.0.1" "0.0.0.0" ":: v6"; do
  P=$((BASE+i)); i=$((i+1)); set -- $spec
  python3 -I "$SP/holder.py" $1 $P $2 & H=$!; sleep 0.5
  kill -0 $H 2>/dev/null || { echo "python $spec: holder failed to start"; continue; }
  check "python $spec" $P; kill $H; wait $H 2>/dev/null
done
P=$((BASE+i)); nc -l $P >/dev/null 2>&1 & H=$!; sleep 0.5; check "nc -l (no host)" $P; kill $H 2>/dev/null; wait $H 2>/dev/null

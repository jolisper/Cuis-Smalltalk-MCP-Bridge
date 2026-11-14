#!/usr/bin/env bash
# usage: fresh.sh <name> -> instances/<name> with a pristine copy of the base image
D=$HOME/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CuisImage
SP=$(cd "$(dirname "$0")" && pwd); I="$SP/instances/$1"
rm -rf "$I"; mkdir -p "$I"; cp "$D"/Cuis7.8.image "$D"/Cuis7.8.changes "$D"/Cuis7.8.sources "$I"/; chmod u+w "$I"/*
echo "$I"

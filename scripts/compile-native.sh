#!/bin/sh
# Build the cpuminer-style GNFPHash loop. macOS: CommonCrypto. Linux: OpenSSL.
set -eu
root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
src="$root/src/native/gnfphash.c"
out="$root/src/native/gnfphash"
cc="${CC:-cc}"
if [ "$(uname -s)" = "Darwin" ]; then
  "$cc" -O3 -std=c11 -o "$out" "$src"
else
  "$cc" -O3 -std=c11 -o "$out" "$src" -lcrypto
fi
echo "built $out"

# Windows leftover — GNFPHash 1.0.4

**Operator index:** https://github.com/rgsneddon/handoff/blob/main/HANDOFF.md

**This Mac already attached** Node 18+ source packs on https://github.com/rgsneddon/GNFPHash/releases/tag/v1.0.4 :

| Asset | Notes |
|-------|--------|
| `GNFPHash-1.0.4-macos.tar.gz` | shipped |
| `GNFPHash-1.0.4-linux.tar.gz` | shipped — **no** Darwin `gnfphash` binary |
| `GNFPHash-1.0.4-windows.zip` | shipped source + `pack/win/gnfp-mine.cmd` — **no** PE, **no** Darwin binary |

**Laptop leftover:** compile native hasher with OpenSSL and optionally replace the zip:

```
cc -O3 -std=c11 -o src/native/gnfphash.exe src/native/gnfphash.c -lssl -lcrypto
```

Set `GNFP_NATIVE=1`. JS fallback hashes if native cannot run.

Pin: `package.json` / `src/miner.js` `VERSION = '1.0.4'`. **1 thread = 1 physical core.** `--threads 10` on 12 cores stays 10; on 6-core/12-SMT honors 6. Do not rebuild 1.0.3. No sibling tags.

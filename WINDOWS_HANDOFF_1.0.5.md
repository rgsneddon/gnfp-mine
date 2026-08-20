# Windows leftover — GNFPHash 1.0.5

**Operator index:** https://github.com/rgsneddon/handoff/blob/main/HANDOFF.md

Pin **1.0.5** — `--threads 10` on a **12-thread** CPU (6c/12t) runs and reports **10**, not 6. Hard clamp **256**. Stale jobIds are not submitted; pool rejects unknown jobId as `stale_job`.

This Mac attaches source packs on https://github.com/rgsneddon/GNFPHash/releases/tag/v1.0.5

| Asset | Notes |
|-------|--------|
| `GNFPHash-1.0.5-macos.tar.gz` | shipped |
| `GNFPHash-1.0.5-linux.tar.gz` | shipped — no Darwin `gnfphash` |
| `GNFPHash-1.0.5-windows.zip` | source + `pack/win/gnfp-mine.cmd` |

Laptop leftover: compile `src/native/gnfphash.exe` with OpenSSL (`GNFP_NATIVE=1`). JS fallback hashes if native cannot run.

Do not rebuild 1.0.4 as the viable pin. No sibling tags.

# Goal: honest device cores on the wire

**Imperative.** Later we bottleneck cheats to 1 core. That only works if the miner reads the machine and the pool trusts `cpuCores`.

## Repos

- Miner (this tree): https://github.com/rgsneddon/GNFPHash (`~/gnfp-mine`)
- Pool: `~/gnfp` (Germany book `rpt-gnfp-pool`)

Standalone miner is **desktop CLI only**. No iOS/Android miner app. Mobile hashing is the in-wallet miner in `gnfp-wallet` (out of scope unless you also ship `cpuCores` there).

## Rule

**1 thread = 1 CPU core.**

- Miner reads `os.availableParallelism()` / `os.cpus()`.
- `--threads X` on a box with **X or more cores** is HONEST (10 on 12, or 12 on 12).
- Claim more workers than cores → CHEAT inflate.
- Claim far fewer threads than proven work → CHEAT hide (under-report a farm). Not a fake hash.
- Fake GPU/ASIC/old client is a different refuse, not these labels.

## Already on disk (do not revert; finish, test, ship)

GNFPHash **1.0.4** (uncommitted vs `142f6d2` 1.0.3):

- `deviceCpuCount`, `deviceCpuReport`, cap at cores (not cores-1)
- login/stats/submit send `threads` (farm.running) + `cpuCores` + `maxThreads`
- tests include 10 workers on 12 cores
- `WINDOWS_HANDOFF_1.0.4.md` — this Mac ships **macOS** only; laptop does Windows / Linux / Arch

Pool (`~/gnfp`, uncommitted):

- H/s = accepted shares × `2^14` (proven hashes), not share-count/s
- honesty uses `cpuCores` first (`matches_device_cores`)
- block bits climb on fast intervals; share jobs stay 14-bit; start block bits at genesis 21
- HTTP `/api/submit` cannot pass `blockHashMet`
- wallet persist debounced 2s (sync 2.7MB `wallet.json` per share hung `:8014` — 504, same as 24h ago)
- Germany pool was restarted; tip answered. Hang will return without the persist debounce deployed.

## Done when

1. `node --test tests/test_miner.js` in `~/gnfp-mine` is green.
2. A miner `--print-config` / login JSON has `cpuCores` ≥ `threads`, and `--threads 10` on a 12-core stays 10.
3. Pool test: 10 threads + 12 `cpuCores` → `threadHonesty === 'honest'`. 240 threads + 8 cores → inflate.
4. macOS pack `dist/GNFPHash-1.0.4-macos.tar.gz` built. Do **not** attach Linux/Windows from this Mac.
5. Do **not** deploy a half-tested pool to Germany unless persist debounce is isolated and proven. Do not bottleneck cheats to 1 core in this goal.

Pin: **GNFPHash 1.0.4**. Do not invent a sibling tag. Do not rebuild 1.0.3.

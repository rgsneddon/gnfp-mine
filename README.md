# GNFPHash

Official **$GNFP** CPU miner. CLI only (a GUI comes later).

- Coin: GNFP
- Algo: **GNFPHash** (dedicated CPU work hash). BeamHash III, old gnfp-mine, GPU, and ASIC mint nothing.
- Pin: **1.0.6** — https://github.com/rgsneddon/GNFPHash/releases
- Stratum: TLS by default to `de.restoreprivacy.online:1474` (`--notls` for local plaintext)
- Login/stats/submit report **running farm threads** plus **cpuCores** / **cpuThreads**. `--threads 10` on a 12-thread CPU runs 10 (hard clamp 256).
- Miner identities stay hashed. The client does not publish wallets, IPs, or logins to the public explorer.
- Also: `sg.restoreprivacy.online:1474`

The miner **refuses to connect or hash** unless `--user` is a real `gnfp1` payout address. After a valid run it remembers pool, user, and threads so the next launch can omit those flags.

Needs **Node.js 18+** on your PATH (`node -v`). The pack wrappers (`pack/unix/gnfp-mine`, `pack/win/gnfp-mine.cmd`) say so if `node` is missing. Installing Node from https://nodejs.org includes **npm**; you do **not** `npm install` this miner (no packages). `exec: node: not found` means Node is not on PATH — install Node 18+, not an npm package.

## Get a gnfp1 address

Create one with [gnfp-wallet](https://github.com/rgsneddon/gnfp-wallet). A payout login looks like:

```
gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c.worker
```

That is `gnfp1` + 20–80 lowercase letters or digits, optional `.worker` tag. Anything else is refused.

## How to run

From a clone of this repo:

```
git clone https://github.com/rgsneddon/GNFPHash.git
cd GNFPHash
```

### macOS

```
node src/miner.js --pool de.restoreprivacy.online:1474 --user gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c.worker --threads 8
```

Or the pack wrapper:

```
chmod +x pack/unix/gnfp-mine
./pack/unix/gnfp-mine --user gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c.worker --threads 8
```

### Linux

Same as macOS:

```
node src/miner.js --pool de.restoreprivacy.online:1474 --user gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c.worker --threads 8
```

```
chmod +x pack/unix/gnfp-mine
./pack/unix/gnfp-mine --user gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c.worker --threads 8
```

### Windows

In Command Prompt or PowerShell, from the repo root:

```
node src\miner.js --pool de.restoreprivacy.online:1474 --user gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c.worker --threads 8
```

Or:

```
pack\win\gnfp-mine.cmd --user gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c.worker --threads 8
```

`--threads` starts that many real CPU `worker_threads`. **1 thread = 1 CPU core** (default = device cores minus 1 so the OS keeps a core; max = the cores this machine actually has). The miner reads the device and reports `cpuCores` on every login/stats/submit so the pool can mark a 10-thread farm on a 12-core box HONEST. Pick your own worker tag (`--user gnfp1….NAME` or `--worker NAME`, 1–24 letters/digits/`_`/`-`). The default tag if omitted is `worker`.

## Remembered config

A successful start with a real `gnfp1` writes `~/.gnfp-mine/config.json` (override with `GNFP_MINE_CONFIG`). Later:

```
node src/miner.js
```

reuses the last pool, user, and thread count. Print what will be used:

```
node src/miner.js --print-config
```

Help:

```
node src/miner.js --help
```

A missing or fake address exits without starting workers:

```
gnfp-mine: refuse — need a real gnfp1 payout address (--user gnfp1….worker)
```

## Live output

Once connected you get job lines and a status line with:

- hashrate
- worker name
- shares accepted
- shares rejected
- blocks found
- threads
- height
- pool

Each pool share reply is printed as `accepted share`, `rejected share`, or `BLOCK FOUND`. Counters follow those replies (code `1` / description `accepted`, negative code / `rejected`, or a formed-block mark).

Shares shown on the public pool page are **this block only**. This miner submits difficulty-valid work hashes only. A share is bound to the job it was found on, re-checked locally, and sent one at a time — stale or duplicate lines are dropped here so the book does not reject them.

## How-to: solo mine

Solo means **your miner talks to a local equal/solo node**, not to Germany’s pool. The node is [gnfp-node](https://github.com/rgsneddon/gnfp-node) **1.2.6** (or later). `--equal` / `--book` **mints a local book** — it can fork if it is not kept in sync with the live chain. Default node mode is **join** (relay into Germany). Solo is operator-only.

Needs Node.js 18+ for **both** the node and this miner.

1. Start an equal/solo node (separate terminal, leave it running):

```
git clone https://github.com/rgsneddon/gnfp-node.git
cd gnfp-node
git checkout v1.2.6
node src/node.js --equal --data-dir ~/.gnfp-equal --notls
```

Unix pack: `./pack/unix/gnfp-node --equal --data-dir ~/.gnfp-equal --notls`  
Windows: `pack\win\gnfp-node.cmd --equal --data-dir %USERPROFILE%\.gnfp-equal --notls`

`--notls` is local plaintext stratum on this machine. Public books stay TLS.

Check the node:

```
node src/node.js --print-config --equal
curl -sS http://127.0.0.1:8014/api/tip
```

`--print-config` `join` is false and `equalNode` is true. Tip HTTP is `:8014`; stratum is `:1474`.

2. Point **GNFPHash 1.0.6** at that local stratum (`--notls` because the solo node was started `--notls`):

```
cd GNFPHash
node src/miner.js --pool 127.0.0.1:1474 --user gnfp1YOURADDRESS.worker --threads 8 --notls
```

Or:

```
./pack/unix/gnfp-mine --pool 127.0.0.1:1474 --user gnfp1YOURADDRESS.worker --threads 8 --notls
```

Windows:

```
pack\win\gnfp-mine.cmd --pool 127.0.0.1:1474 --user gnfp1YOURADDRESS.worker --threads 8 --notls
```

Use **1.0.4 or newer**. 1.0.3 and lower earn nothing (`miner_update_required`). `--threads` is utilised workers; the miner also reports device `cpuCores` / `cpuThreads`.

3. Confirm work on the solo node:

```
curl -sS http://127.0.0.1:8014/api/network
```

You should see your worker, proven hashrate, and height moving on **that** data dir — not on https://gnfp.restoreprivacy.online unless you also run a join miner at Germany.

To mine the **live** book instead, omit `--equal` on the node (join) or point this miner at `de.restoreprivacy.online:1474` **with TLS** (no `--notls`).

## Flags

| Flag | Meaning |
|------|---------|
| `--pool HOST:PORT` | Stratum host (default `de.restoreprivacy.online:1474`) |
| `--user gnfp1….NAME` | Real payout address, optional `.NAME` worker tag (1–24) |
| `--worker NAME` | Worker tag 1–24 chars (overrides the `.tag` on `--user`) |
| `--threads N` | Real CPU workers, default CPUs−1, max 256 |
| `--notls` | Local plaintext only. Public `*.restoreprivacy.online` books are TLS. |
| `--print-config` | Print resolved config and exit |
| `--help` | Usage |

1.0.7 saved `"tls": false` in `~/.gnfp-mine/config.json`. 1.0.9 ignores that on the public book so an upgrade no longer speaks plaintext to a TLS listener (that showed up as `reconnect in 2s` with no job). Delete the file or just run 1.0.9.

## Tests

```
node --test tests/*.js
```

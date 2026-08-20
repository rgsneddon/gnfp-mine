# GNFPHash

Official **$GNFP** CPU miner. CLI only (a GUI comes later).

- Coin: GNFP
- Algo: **GNFPHash** (dedicated CPU work hash). BeamHash III, old gnfp-mine, GPU, and ASIC mint nothing.
- Pin: **1.0.5** — https://github.com/rgsneddon/GNFPHash/releases
- Stratum: TLS by default to `de.restoreprivacy.online:1474` (`--notls` for local plaintext)
- Login/stats/submit report **running farm threads** plus **cpuCores** / **cpuThreads**. `--threads 10` on a 12-thread CPU runs 10 (hard clamp 256).
- Miner identities stay hashed. The client does not publish wallets, IPs, or logins to the public explorer.
- Also: `sg.restoreprivacy.online:1474`

The miner **refuses to connect or hash** unless `--user` is a real `gnfp1` payout address. After a valid run it remembers pool, user, and threads so the next launch can omit those flags.

Needs **Node.js 18+**.

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

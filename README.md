# gnfp-mine

Dedicated **$GNFP** CPU miner for the live Germany book. CLI only (a GUI comes later).

- Coin: GNFP (not PERC, not Beam)
- Algo: BeamHash III
- Stratum: plain TCP `de.restoreprivacy.online:1474`
- Also: `sg.restoreprivacy.online:1474` (join) and `hel.restoreprivacy.online:1474` (Helsinki front)

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
git clone https://github.com/rgsneddon/gnfp-mine.git
cd gnfp-mine
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

`--threads` starts that many real CPU `worker_threads` (default = machine CPU count, max 256).

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

Shares shown on the public pool page are **this block only**. This miner submits difficulty-valid work hashes only.

## Flags

| Flag | Meaning |
|------|---------|
| `--pool HOST:PORT` | Stratum host (default `de.restoreprivacy.online:1474`) |
| `--user gnfp1….worker` | Real payout address (required unless remembered) |
| `--threads N` | Real CPU workers, 1–256 |
| `--print-config` | Print resolved config and exit |
| `--help` | Usage |

## Tests

```
node --test tests/*.js
```

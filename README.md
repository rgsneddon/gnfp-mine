# gnfp-mine

Dedicated **$GNFP** CPU miner for the live pool.

- Stratum: `de.restoreprivacy.online:1474` (plain TCP)
- Coin: GNFP (not PERC, not Beam)
- Submits **difficulty-valid hashes** that accumulate toward the current block

## Run

Needs Node.js 18+.

```
node src/miner.js --pool de.restoreprivacy.online:1474 --user YOUR_GNFP1.worker --threads 8
```

`--threads` starts that many real CPU `worker_threads` (default = machine CPU count, max 256). Every valid share is submitted immediately. Shares shown on the pool page are **this block only**.

## Install packs

See GitHub Releases on [rgsneddon/gnfp-mine](https://github.com/rgsneddon/gnfp-mine/releases):

- `gnfp-mine-1.0.0-windows.zip`
- `gnfp-mine-1.0.0-linux.tar.gz`
- `gnfp-mine-1.0.0-macos.tar.gz`

Windows: `pack\win\gnfp-mine.cmd --user gnfp1....worker --threads 4`  
Unix: `./pack/unix/gnfp-mine --user gnfp1....worker --threads 4`

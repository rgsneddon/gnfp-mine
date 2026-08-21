# Windows pointer — GNFPHash 1.0.6

**Do not use this file as the pin list.** All GNFP client leftover lives in:

**https://github.com/rgsneddon/handoff/blob/main/HANDOFF.md**

Current pin here: **1.0.6**. Do **not** rebuild 1.0.5.

Unix/Windows launchers now print **Node.js 18+** (and that you do **not** `npm install` this miner) instead of `exec: node: not found`. Installing Node from https://nodejs.org includes npm; that is the correct fix for the screenshot error — not `npm install` inside the miner tree.

Laptop leftover: compile `src/native/gnfphash.exe` with OpenSSL (`GNFP_NATIVE=1`) if a native PE is still wanted. Source + `pack\win\gnfp-mine.cmd` on the tag is enough for Node 18+.

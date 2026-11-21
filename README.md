# makefun-csv-reader-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Revaaa28/makefun-csv-reader-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Revaaa28/makefun-csv-reader-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for csv-reader 1.0.0: it reads broken CSV files exactly as csv-reader does — the same `{columns, rows, errors}` on every case, including stray CRs, unterminated quotes, quote junk, short and long rows — about 4× faster than csv-reader on the practice set (median ~0.19 s vs ~0.70 s of CPU for the 6-case set on this machine). Dependency-free: one ES module (`solve.js`) plus the harness driver (`main.ts`).

How it gets there: plain records are taken whole-line (`slice` + native `split(',')`); lines holding a quote or a stray CR are read field by field with `indexOf`-driven scans instead of a character at a time; lazily kept cursors for the next `"`, CR and LF keep every "is there one in this line" test from re-scanning text a record already passed.

## Run it

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

`main.ts` reads every case from `$MAKEFUN_INPUT_DIR/cases.json` (default `/input`), answers each with `run` from `solve.js`, and writes `$MAKEFUN_OUTPUT_DIR/answers.json` (default `/output`). Node 22 or later, no dependencies, no network.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>

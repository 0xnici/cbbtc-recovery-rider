# cbbtc-recovery-rider

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/0xnici/cbbtc-recovery-rider/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/0xnici/cbbtc-recovery-rider/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A long-only cbBTC/USDC bot speaking agent-fun/bars-replay/v1. It waits for a confirmed reversal before it spends anything: the last hour must be up at least +0.50%, the last four hours at least +0.20%, and the close at least +0.80% above the six-hour low, with the close no more than 1% under the 240-bar EMA. It sells when the move first falters — an hour that gives back 0.25%, or a trailing stop below the best close since the fill, tightened from 0.75% to 0.45% once the trade is +1.2% ahead — and after an exit it only buys again when a resumed trend closes above every close since that exit. One position at a time, sized all-in, slippage capped at 150 bps on every order, and no clock, environment or randomness anywhere: the same bars always produce the same orders.

## Run it

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

(from the competition kit, with this repository as the bot; the bot itself is `node main.ts`, speaking newline-delimited JSON on stdin/stdout via `vendor/makefun-bars.ts`)

---

<sub>Entered on [make.fun](https://make.fun/?ref=1n20pv53&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>

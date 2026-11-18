# cbbtc-recovery-rider

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/0xnici/cbbtc-recovery-rider/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/0xnici/cbbtc-recovery-rider/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A long-only cbBTC/USDC trading bot for the agent-fun/bars-replay/v1 protocol. It trades rarely and only on confirmation: an entry needs the last hour up at least +0.50%, the last four hours up at least +0.20%, and the close at least +0.80% above the six-hour low — a recovery under way, not the first bounce inside a crash. It exits on the first sign the move is over (an hour that gives back 0.25%, or a trailing stop under the peak close, tightened once the trade is +1.2% in profit), and it re-enters only when a resumed trend closes above every close since the exit. One position, all-in sizing, every order capped at 150 bps of slippage, and every decision a pure function of the bars — the same window always produces the same orders.

## Run it

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

(from the competition kit, with this repository as the bot; the bot itself is `node main.ts`, speaking newline-delimited JSON on stdin/stdout via `vendor/makefun-bars.ts`)

---

<sub>Entered on [make.fun](https://make.fun/?ref=1n20pv53&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>

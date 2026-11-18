// Confirmed-reversal rider for cbBTC/USDC — bars-replay/v1.
//
// Why this bot trades so rarely: in this replay a round trip at full size
// costs roughly 26 bps once the fee, the modelled slippage and the pool
// impact are added up, and the dev gate only lets a bot race when its dev
// window ends in profit. A bot that chases every wiggle pays that toll over
// and over; a bot that simply buys and holds loses on every falling day.
// So each hello starts a long watch, and a batch only produces orders when
// several independent readings agree that a fall has genuinely reversed:
//
//   First entry, while flat — the return over the last 60 bars is at least
//   +0.50%, the return over the last 240 bars is at least +0.20%, the
//   latest close is at least +0.80% above the lowest close of the last
//   360 bars, and the close is no more than 1% below the 240-bar EMA.
//   The two momentum windows filter out the first bounce inside a crash
//   (the four-hour window is still negative there), and the distance
//   above the low filters out rallies that began from nowhere.
//
//   Exit, while holding — the last 60 bars give back 0.25%, or the close
//   drops 0.75% below the highest close seen since the fill. After the
//   trade has gained +1.2% over its fill price the trailing distance
//   tightens to 0.45%, banking most of a good move before it can fade.
//
//   Later entries — the bar is set much higher than for the first one:
//   the 240-bar return must reach +0.60%, the 60-bar return at least
//   +0.25%, and the close must exceed every close printed since the
//   previous exit. Post-exit chop meets none of those; a trend that
//   resumes to fresh highs meets all of them.
//
// Sizing is a single all-in order: the weight room for the one symbol is
// 100% of equity, and splitting an order over several bars would pay the
// fee and slippage twice against the same pool depth. Every order caps
// slippage at 150 bps from the close it was decided on, so a gap through
// a thin bar refuses the fill instead of accepting a bad price.
//
// The bot is deterministic: decisions depend only on the bars and fills
// in the batches it has received — no wall clock, no environment, no
// randomness — and the arithmetic is float64 addition, subtraction,
// multiplication and division only, so two runs over one window produce
// identical orders.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const ASSET = 'CBBTC';

// Horizons, counted in one-minute bars.
const HOUR = 60;
const FOUR_HOURS = 240;
const SIX_HOURS = 360;
const TREND_SPAN = 240;

// First-entry gates, as price fractions.
const GATE_HOUR = 0.005;
const GATE_FOUR_HOUR = 0.002;
const GATE_OFF_LOW = 0.008;
const GATE_EMA_GAP = 0.01;

// Exit gates.
const GIVE_BACK = -0.0025;
const TRAIL_WIDE = 0.0075;
const TRAIL_NEAR = 0.0045;
const ARM_AT = 0.012;

// Re-entry gates.
const GATE_RESUME_SLOW = 0.006;
const GATE_RESUME_FAST = 0.0025;

// Slippage ceiling carried by every order, in basis points.
const SLIPPAGE_CAP = 150;

// ---- run state -------------------------------------------------------

const closeHistory: number[] = [];
let trendEma: number | null = null;
let bestCloseInTrade = 0;
let entryFillPrice = 0;
let filledBuys = 0;
let bestCloseAfterExit = 0;
let heldLastBatch = false;

function advanceTrend(close: number): void {
  if (trendEma === null) {
    trendEma = close;
    return;
  }
  const alpha = 2 / (TREND_SPAN + 1);
  trendEma = trendEma + alpha * (close - trendEma);
}

function returnOver(span: number): number | null {
  if (closeHistory.length <= span) return null;
  const latest = closeHistory[closeHistory.length - 1]!;
  const earlier = closeHistory[closeHistory.length - 1 - span]!;
  return latest / earlier - 1;
}

function liftAboveRecentLow(): number | null {
  if (closeHistory.length < FOUR_HOURS) return null;
  const latest = closeHistory[closeHistory.length - 1]!;
  let low = latest;
  const start = Math.max(0, closeHistory.length - SIX_HOURS);
  for (let i = start; i < closeHistory.length; i++) {
    if (closeHistory[i]! < low) low = closeHistory[i]!;
  }
  return latest / low - 1;
}

function wantsEntry(): boolean {
  const hourRet = returnOver(HOUR);
  const fourHourRet = returnOver(FOUR_HOURS);
  const lift = liftAboveRecentLow();
  if (hourRet === null || fourHourRet === null || lift === null || trendEma === null) return false;
  const latest = closeHistory[closeHistory.length - 1]!;
  if (lift < GATE_OFF_LOW) return false;
  if (latest < trendEma * (1 - GATE_EMA_GAP)) return false;
  if (filledBuys === 0) {
    return hourRet >= GATE_HOUR && fourHourRet >= GATE_FOUR_HOUR;
  }
  return fourHourRet >= GATE_RESUME_SLOW && hourRet >= GATE_RESUME_FAST && latest > bestCloseAfterExit;
}

function wantsExit(): boolean {
  // The give-back rule fires first: an hour that has already surrendered
  // 0.25% says the move is over without waiting for the trailing stop.
  const hourRet = returnOver(HOUR);
  if (hourRet !== null && hourRet <= GIVE_BACK) return true;
  // Otherwise the trailing stop decides. Its distance shrinks once the
  // trade is armed (+1.2% over the fill), so a winner keeps less room.
  const latest = closeHistory[closeHistory.length - 1]!;
  const armed = entryFillPrice > 0 && latest >= entryFillPrice * (1 + ARM_AT);
  const trailDistance = armed ? TRAIL_NEAR : TRAIL_WIDE;
  const stopLevel = bestCloseInTrade * (1 - trailDistance);
  return bestCloseInTrade > 0 && latest <= stopLevel;
}

// ---- main loop ---------------------------------------------------------

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    // Fills first: they report orders decided on earlier batches, and the
    // position they opened or closed is what this batch decides from.
    for (const fill of batch.fills) {
      if (fill.symbol !== ASSET || fill.status !== 'filled') continue;
      if (fill.side === 'buy') {
        filledBuys += 1;
        entryFillPrice = Number(fill.price);
        bestCloseInTrade = closeHistory.length > 0 ? closeHistory[closeHistory.length - 1]! : 0;
      }
    }

    // Then fold every new bar into the history and the running marks.
    for (const bar of batch.bars) {
      if (bar.symbol !== ASSET) continue;
      const close = Number(bar.c);
      closeHistory.push(close);
      advanceTrend(close);
      if (state.positions.has(ASSET)) {
        if (close > bestCloseInTrade) bestCloseInTrade = close;
      } else if (heldLastBatch || filledBuys > 0) {
        if (close > bestCloseAfterExit) bestCloseAfterExit = close;
      }
    }

    const holdingNow = state.positions.has(ASSET);
    if (heldLastBatch && !holdingNow) {
      bestCloseAfterExit = closeHistory.length > 0 ? closeHistory[closeHistory.length - 1]! : 0;
      bestCloseInTrade = 0;
      entryFillPrice = 0;
    }
    heldLastBatch = holdingNow;

    if (state.warmingUp || closeHistory.length === 0) return [];

    if (holdingNow) {
      if (!wantsExit()) return [];
      const position = state.positions.get(ASSET)!;
      const sellAll: SellInput = {
        side: 'sell',
        symbol: ASSET,
        qty: position.qty,
        max_slippage_bps: SLIPPAGE_CAP,
      };
      return [sellAll];
    }

    if (!wantsEntry()) return [];
    const room = state.weightRoom(ASSET);
    const stake = state.cash < room ? state.cash : room;
    if (stake < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const buyAll: BuyInput = {
      side: 'buy',
      symbol: ASSET,
      notional_quote_units: stake,
      max_slippage_bps: SLIPPAGE_CAP,
    };
    return [buyAll];
  },
});

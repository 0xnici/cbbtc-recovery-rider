// Recovery rider — a long-only cbBTC/USDC bot for agent-fun/bars-replay/v1.
//
// The race this enters grades twice: a frozen dev window decides who races,
// then a live 24-hour window decides the prizes. Both windows punish the two
// easy bots: buying and holding loses every falling day, and a fast crossover
// whipsaws itself to death on fees (a full-size round trip costs ~26 bps).
// This bot therefore trades rarely and only on confirmation:
//
//   Entry (flat): the last hour is up at least +0.50% AND the last four hours
//   are up at least +0.20% AND the close sits at least +0.80% above the low
//   of the last six hours AND at most 1% under the 240-bar EMA. Two momentum
//   windows agreeing, off a real low, is a recovery under way — not the first
//   bounce inside a crash, which fails the four-hour test, and not a rally
//   that started from nowhere, which fails the off-low test.
//
//   Exit (holding): the first sign the move is over — the last hour gives
//   back 0.25%, or the close falls 0.75% under the highest close since the
//   fill. Once the trade is +1.2% above its fill price the trailing stop
//   tightens to 0.45%, so a good trade keeps most of what it made.
//
//   Re-entry: allowed, but the bar is far higher than for the first entry —
//   the four-hour momentum must reach +0.60% and the close must beat every
//   close since the exit. Chop after an exit never qualifies; only a trend
//   that resumes to new highs does.
//
// Sizing is all-in (one symbol, the weight cap is 100%): with impact near
// 10 bps on a full-size order against this pool's depth, splitting a position
// across bars would pay the fee and slippage twice for nothing. Every order
// caps its slippage at 150 bps past the close it was decided on, so a gap
// through a thin minute refuses the fill instead of taking a bad price.
//
// Determinism: every decision is a pure function of the bars and fills the
// harness sent — no clock, no environment, no randomness. Indicators run in
// float64 on + - * / alone, so two runs of the same window agree exactly.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

/** Momentum windows, in bars (one bar is one minute). */
const MOM_FAST = 60;
const MOM_SLOW = 240;
/** The trailing low and the trend EMA share the slow horizon's scale. */
const LOW_SPAN = 360;
const EMA_SPAN = 240;

/** First-entry thresholds, as fractions of price. */
const ENTER_FAST = 0.005;
const ENTER_SLOW = 0.002;
const OFF_LOW = 0.008;
const EMA_TOLERANCE = 0.01;

/** Exit thresholds. */
const EXIT_FAST = -0.0025;
const TRAIL = 0.0075;
const TRAIL_TIGHT = 0.0045;
const PROFIT_ARM = 0.012;

/** A re-entry needs this much four-hour momentum and a close above the post-exit high. */
const REENTER_SLOW = 0.006;

/** No fill may land further than this from the close the order was decided on. */
const MAX_SLIPPAGE_BPS = 150;

/** Every close the harness has sent, in order; a minute with no bar adds nothing. */
const closes: number[] = [];
/** The 240-bar EMA of the closes, seeded on the first close. */
let ema: number | null = null;
/** Highest close since the current position filled; 0 while flat. */
let peakClose = 0;
/** The price the current position filled at (its bar's fill price); 0 while flat. */
let fillPrice = 0;
/** How many buys have filled this run. */
let entries = 0;
/** Highest close since the last exit; a re-entry must close above it. */
let highSinceExit = 0;
/** Whether the previous batch still held the position (to spot the exit bar). */
let wasHolding = false;

function stepIndicators(close: number): void {
  if (ema === null) ema = close;
  else ema += (2 / (EMA_SPAN + 1)) * (close - ema);
}

/** Return of the close over the last `span` bars, or null before enough bars exist. */
function trailingReturn(span: number): number | null {
  if (closes.length <= span) return null;
  const now = closes[closes.length - 1]!;
  const then = closes[closes.length - 1 - span]!;
  return now / then - 1;
}

/** How far the latest close sits above the lowest close of the last LOW_SPAN bars. */
function distanceAboveLow(): number | null {
  if (closes.length < MOM_SLOW) return null;
  const now = closes[closes.length - 1]!;
  let low = now;
  for (let i = Math.max(0, closes.length - LOW_SPAN); i < closes.length; i++) {
    if (closes[i]! < low) low = closes[i]!;
  }
  return now / low - 1;
}

function entrySignal(state: BarsState): boolean {
  const fast = trailingReturn(MOM_FAST);
  const slow = trailingReturn(MOM_SLOW);
  const offLow = distanceAboveLow();
  if (fast === null || slow === null || offLow === null || ema === null) return false;
  const close = closes[closes.length - 1]!;
  if (offLow < OFF_LOW) return false;
  if (close < ema * (1 - EMA_TOLERANCE)) return false;
  if (entries === 0) return fast >= ENTER_FAST && slow >= ENTER_SLOW;
  // A re-entry must prove the trend resumed: stronger slow momentum, a close
  // above every close since the exit, and the fast window at least half-way
  // to its first-entry strength — the chop after an exit has none of these.
  return slow >= REENTER_SLOW && fast >= ENTER_FAST / 2 && close > highSinceExit;
}

function exitSignal(): boolean {
  const fast = trailingReturn(MOM_FAST);
  const close = closes[closes.length - 1]!;
  if (fast !== null && fast <= EXIT_FAST) return true;
  const trail = fillPrice > 0 && close >= fillPrice * (1 + PROFIT_ARM) ? TRAIL_TIGHT : TRAIL;
  return peakClose > 0 && close <= peakClose * (1 - trail);
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    // Bookkeeping first: fills the harness reports belong to orders decided
    // on earlier batches, and they set the state this batch decides from.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      if (fill.side === 'buy') {
        entries += 1;
        fillPrice = Number(fill.price);
        peakClose = closes.length > 0 ? closes[closes.length - 1]! : 0;
      }
    }
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      const close = Number(bar.c);
      closes.push(close);
      stepIndicators(close);
      if (state.positions.has(SYMBOL)) {
        if (close > peakClose) peakClose = close;
      } else if (wasHolding || entries > 0) {
        if (close > highSinceExit) highSinceExit = close;
      }
    }
    const holding = state.positions.has(SYMBOL);
    if (wasHolding && !holding) {
      // The position left on this batch's fills: the post-exit high starts
      // from the latest close, and the fill bookkeeping resets.
      highSinceExit = closes.length > 0 ? closes[closes.length - 1]! : 0;
      peakClose = 0;
      fillPrice = 0;
    }
    wasHolding = holding;

    if (state.warmingUp || closes.length === 0) return [];

    if (holding) {
      if (!exitSignal()) return [];
      const held = state.positions.get(SYMBOL)!;
      const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
      return [sell];
    }

    if (!entrySignal(state)) return [];
    const room = state.weightRoom(SYMBOL);
    const stake = state.cash < room ? state.cash : room;
    if (stake < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});

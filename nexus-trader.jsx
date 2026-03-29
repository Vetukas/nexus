import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, Area, AreaChart
} from "recharts";

// ================================================================
// TECHNICAL ANALYSIS ENGINE
// ================================================================
const sma = (d, p) => d.map((_, i) =>
  i < p - 1 ? null : d.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
const ema = (d, p) => {
  const k = 2 / (p + 1); let prev = null;
  return d.map((v, i) => {
    if (i < p - 1) return null;
    if (i === p - 1) { prev = d.slice(0, p).reduce((a, b) => a + b, 0) / p; return prev; }
    prev = v * k + prev * (1 - k); return prev;
  });
};
const calcRSI = (cls, p = 14) => cls.map((_, i) => {
  if (i < p) return null;
  let g = 0, l = 0;
  for (let j = i - p + 1; j <= i; j++) { const d = cls[j] - cls[j - 1]; d > 0 ? g += d : l -= d; }
  return 100 - 100 / (1 + (g / p) / (l / p || 0.001));
});
const calcMACD = (cls) => {
  const e12 = ema(cls, 12), e26 = ema(cls, 26);
  const ml = e12.map((v, i) => v && e26[i] ? v - e26[i] : null);
  const valids = ml.filter(v => v !== null);
  const sig9 = ema(valids, 9);
  let si = 0; const sig = ml.map(v => v === null ? null : sig9[si++] || null);
  return { ml, sig, hist: ml.map((v, i) => v && sig[i] ? v - sig[i] : null) };
};
const calcBB = (cls, p = 20) => sma(cls, p).map((m, i) => {
  if (!m) return { u: null, m: null, l: null };
  const sl = cls.slice(i - p + 1, i + 1);
  const std = Math.sqrt(sl.reduce((a, v) => a + Math.pow(v - m, 2), 0) / p);
  return { u: m + 2 * std, m, l: m - 2 * std };
});
const calcATR = (candles, p = 14) => candles.map((_, i) => {
  if (i < 1) return null;
  const slice = candles.slice(Math.max(1, i - p + 1), i + 1);
  const trs = slice.map((c, j) => {
    const prev = candles[i - p + 1 + j - 1] || candles[0];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return trs.reduce((a, b) => a + b, 0) / trs.length;
});

// ================================================================
// VWAP + PIVOT POINTS
// ================================================================
const calcVWAP = (candles) => {
  let cumVP = 0, cumV = 0;
  return candles.map(c => {
    const tp = (c.high + c.low + c.close) / 3;
    cumVP += tp * (c.volume || 0);
    cumV  += (c.volume || 0);
    return cumV ? cumVP / cumV : tp;
  });
};

const calcPivots = (candles) => {
  if (candles.length < 2) return null;
  const p = candles[candles.length - 2]; // prior completed candle
  const pp = (p.high + p.low + p.close) / 3;
  const rng = p.high - p.low;
  return {
    pp,
    r1: 2 * pp - p.low,   s1: 2 * pp - p.high,
    r2: pp + rng,         s2: pp - rng,
    r3: p.high + 2 * (pp - p.low), s3: p.low - 2 * (p.high - pp),
  };
};

// Alert beep — Web Audio API
const playBeep = (freq = 880, dur = 0.35) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq; osc.type = "sine";
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur);
  } catch {}
};

// ================================================================
// FIBONACCI AUTO-DRAW
// ================================================================
const FIB_RATIOS = [
  { r: 0,     label: "0%",     color: "#ffffff55", ext: false },
  { r: 0.236, label: "23.6%",  color: "#00d4ffaa", ext: false },
  { r: 0.382, label: "38.2%",  color: "#00ff9daa", ext: false },
  { r: 0.5,   label: "50%",    color: "#ffcc00aa", ext: false },
  { r: 0.618, label: "61.8%",  color: "#ff8c00cc", ext: false }, // golden ratio
  { r: 0.786, label: "78.6%",  color: "#ff3355aa", ext: false },
  { r: 1.0,   label: "100%",   color: "#ffffff55", ext: false },
  { r: 1.272, label: "127.2%", color: "#a855f780", ext: true  },
  { r: 1.618, label: "161.8%", color: "#a855f7aa", ext: true  },
];

const calcFib = (candles, lookback = 120) => {
  const n = candles.length;
  if (n < 20) return null;
  const slice = candles.slice(-Math.min(n, lookback));
  const offset = n - slice.length;
  let hiIdx = 0, loIdx = 0;
  slice.forEach((c, i) => {
    if (c.high  > slice[hiIdx].high) hiIdx = i;
    if (c.low   < slice[loIdx].low)  loIdx = i;
  });
  const uptrend = hiIdx > loIdx; // high formed after low → uptrend, retrace down
  const swingHi = slice[hiIdx], swingLo = slice[loIdx];
  const diff = swingHi.high - swingLo.low;
  if (diff <= 0) return null;
  const levels = FIB_RATIOS.map(({ r, label, color, ext }) => ({
    ratio: r, label, color, ext,
    // Uptrend: levels count down from high (0% = high, 100% = low, extensions below)
    // Downtrend: levels count up from low  (0% = low,  100% = high, extensions above)
    price: uptrend
      ? swingHi.high - diff * r
      : swingLo.low  + diff * r,
  }));
  return { uptrend, swingHi, swingLo, absHiIdx: offset + hiIdx, absLoIdx: offset + loIdx, levels, diff };
};

// ================================================================
// DIVERGENCE DETECTION
// ================================================================
const detectDivergence = (candles, rsiArr, macdHistArr) => {
  const n = candles.length;
  const LB = 4; // candles each side for pivot confirmation
  const divs = [];

  // Build swing-low and swing-high pivot lists
  const swLow = [], swHigh = [];
  for (let i = LB; i < n - LB; i++) {
    if (rsiArr[i] == null) continue;
    const lo = candles[i].low, hi = candles[i].high;
    if (candles.slice(i - LB, i).every(c => c.low  >= lo) &&
        candles.slice(i + 1, i + LB + 1).every(c => c.low  >= lo))
      swLow.push({ i, price: lo, rsi: rsiArr[i], macd: macdHistArr[i] });
    if (candles.slice(i - LB, i).every(c => c.high <= hi) &&
        candles.slice(i + 1, i + LB + 1).every(c => c.high <= hi))
      swHigh.push({ i, price: hi, rsi: rsiArr[i], macd: macdHistArr[i] });
  }

  // Check consecutive pivot pairs (last 6 of each)
  const recent = (arr, n) => arr.slice(-n);
  const pairs = (arr) => {
    const r = [];
    for (let k = 0; k < arr.length - 1; k++) {
      const a = arr[k], b = arr[k + 1];
      if (b.i - a.i >= 5 && b.i - a.i <= 60) r.push([a, b]);
    }
    return r;
  };

  for (const [a, b] of pairs(recent(swLow, 8))) {
    // Regular Bullish: price LL, RSI HL
    if (b.price < a.price && a.rsi != null && b.rsi != null && b.rsi > a.rsi)
      divs.push({ type: "bull_reg", label: "Bull Div 📈", idx1: a.i, idx2: b.i,
        price1: a.price, price2: b.price, rsi1: a.rsi, rsi2: b.rsi, color: "#00ff9d" });
    // Hidden Bullish: price HL, RSI LL
    if (b.price > a.price && a.rsi != null && b.rsi != null && b.rsi < a.rsi)
      divs.push({ type: "bull_hid", label: "Hidden Bull 🔮", idx1: a.i, idx2: b.i,
        price1: a.price, price2: b.price, rsi1: a.rsi, rsi2: b.rsi, color: "#00d4ff" });
  }
  for (const [a, b] of pairs(recent(swHigh, 8))) {
    // Regular Bearish: price HH, RSI LH
    if (b.price > a.price && a.rsi != null && b.rsi != null && b.rsi < a.rsi)
      divs.push({ type: "bear_reg", label: "Bear Div 📉", idx1: a.i, idx2: b.i,
        price1: a.price, price2: b.price, rsi1: a.rsi, rsi2: b.rsi, color: "#ff3355" });
    // Hidden Bearish: price LH, RSI HH
    if (b.price < a.price && a.rsi != null && b.rsi != null && b.rsi > a.rsi)
      divs.push({ type: "bear_hid", label: "Hidden Bear ⚠️", idx1: a.i, idx2: b.i,
        price1: a.price, price2: b.price, rsi1: a.rsi, rsi2: b.rsi, color: "#ff8c00" });
  }

  // Return most recent 6 divergences
  return divs.slice(-6);
};

// ================================================================
// PATTERN DETECTION
// ================================================================
const detectCandlePatterns = (candles) => {
  const out = [];
  // Avg body size for context-aware thresholds
  const avgBody = candles.reduce((a, c) => a + Math.abs(c.close - c.open), 0) / candles.length || 0.001;
  const avgRange = candles.reduce((a, c) => a + (c.high - c.low), 0) / candles.length || 0.001;

  for (let i = 4; i < candles.length; i++) {
    const c  = candles[i],     p  = candles[i-1], pp = candles[i-2];
    const p3 = candles[i-3],   p4 = candles[i-4];

    // ── Current candle helpers ──────────────────────────────────────
    const body  = Math.abs(c.close - c.open),   rng  = c.high - c.low || 0.001;
    const cOpen = Math.min(c.open, c.close),     cCls = Math.max(c.open, c.close);
    const uw    = c.high - cCls,                 lw   = cOpen - c.low;
    const bull  = c.close > c.open,              bear = c.close < c.open;
    const mid   = (c.open + c.close) / 2;

    // ── Previous candle helpers ─────────────────────────────────────
    const pb    = Math.abs(p.close - p.open),    prng = p.high - p.low || 0.001;
    const pOpen = Math.min(p.open, p.close),     pCls = Math.max(p.open, p.close);
    const puw   = p.high - pCls,                 plw  = pOpen - p.low;
    const pbull = p.close > p.open,              pbear = p.close < p.open;
    const pmid  = (p.open + p.close) / 2;

    // ── pp helpers ──────────────────────────────────────────────────
    const ppb   = Math.abs(pp.close - pp.open);
    const ppbull= pp.close > pp.open,            ppbear = pp.close < pp.open;

    // ── p3 / p4 helpers ────────────────────────────────────────────
    const p3b   = Math.abs(p3.close - p3.open);
    const p3bull= p3.close > p3.open,            p3bear = p3.close < p3.open;
    const p4bull= p4.close > p4.open,            p4bear = p4.close < p4.open;

    // ================================================================
    // 1-CANDLE PATTERNS
    // ================================================================

    // Doji family
    const isDoji = body < rng * 0.1;
    if (isDoji) {
      out.push({ i, name: "Doji", sig: "neutral" });
      // Long-Legged Doji: both wicks long
      if (uw > avgRange * 0.3 && lw > avgRange * 0.3)
        out.push({ i, name: "Long-Legged Doji", sig: "neutral" });
      // Gravestone Doji: long upper wick, no lower wick
      if (uw > avgRange * 0.6 && lw < rng * 0.05)
        out.push({ i, name: "Gravestone Doji 🪦", sig: "bearish" });
      // Dragonfly Doji: long lower wick, no upper wick
      if (lw > avgRange * 0.6 && uw < rng * 0.05)
        out.push({ i, name: "Dragonfly Doji 🐲", sig: "bullish" });
      // 4-Price Doji: open=high=low=close
      if (rng < avgRange * 0.02)
        out.push({ i, name: "4-Price Doji", sig: "neutral" });
    }

    // Spinning Top: small body, both wicks present
    if (body > rng * 0.1 && body < rng * 0.35 && uw > body * 0.7 && lw > body * 0.7)
      out.push({ i, name: "Spinning Top", sig: "neutral" });

    // Hammer / Hanging Man (context-aware)
    if (lw > body * 2 && uw < body * 0.5 && body > 0) {
      if (bull) out.push({ i, name: "Hammer 🔨", sig: "bullish" });
      else      out.push({ i, name: "Hanging Man 💀", sig: "bearish" });
    }

    // Inverted Hammer / Shooting Star
    if (uw > body * 2 && lw < body * 0.5 && body > 0) {
      if (bull) out.push({ i, name: "Inverted Hammer", sig: "bullish" });
      else      out.push({ i, name: "Shooting Star ⭐", sig: "bearish" });
    }

    // Marubozu (full body, tiny wicks)
    if (body > avgBody * 1.5) {
      if (bull && uw < body * 0.03 && lw < body * 0.03) out.push({ i, name: "Bull Marubozu", sig: "bullish" });
      if (bear && uw < body * 0.03 && lw < body * 0.03) out.push({ i, name: "Bear Marubozu", sig: "bearish" });
      // Closing Marubozu: no wick on close side
      if (bull && uw < body * 0.05) out.push({ i, name: "Closing Bull Marubozu", sig: "bullish" });
      if (bear && lw < body * 0.05) out.push({ i, name: "Closing Bear Marubozu", sig: "bearish" });
      // Opening Marubozu: no wick on open side
      if (bull && lw < body * 0.05) out.push({ i, name: "Opening Bull Marubozu", sig: "bullish" });
      if (bear && uw < body * 0.05) out.push({ i, name: "Opening Bear Marubozu", sig: "bearish" });
    }

    // High Wave: tiny body, very long both wicks
    if (body < rng * 0.15 && uw > avgRange * 0.35 && lw > avgRange * 0.35)
      out.push({ i, name: "High Wave", sig: "neutral" });

    // ================================================================
    // 2-CANDLE PATTERNS
    // ================================================================

    // Engulfing (classic)
    if (pbear && bull && c.open <= p.close && c.close >= p.open && body > pb)
      out.push({ i, name: "Bullish Engulfing", sig: "bullish" });
    if (pbull && bear && c.open >= p.close && c.close <= p.open && body > pb)
      out.push({ i, name: "Bearish Engulfing", sig: "bearish" });

    // Harami
    if (pbear && bull && c.open > p.close && c.close < p.open)
      out.push({ i, name: "Bull Harami", sig: "bullish" });
    if (pbull && bear && c.open < p.close && c.close > p.open)
      out.push({ i, name: "Bear Harami", sig: "bearish" });

    // Harami Cross (doji inside prior large candle)
    if (pbear && isDoji && c.high < p.open && c.low > p.close)
      out.push({ i, name: "Bull Harami Cross", sig: "bullish" });
    if (pbull && isDoji && c.high < p.close && c.low > p.open)
      out.push({ i, name: "Bear Harami Cross", sig: "bearish" });

    // Piercing Line: gap-down open, closes above midpoint of bearish prior
    if (pbear && bull && c.open < p.low && c.close > pmid && c.close < p.open)
      out.push({ i, name: "Piercing Line", sig: "bullish" });

    // Dark Cloud Cover: gap-up open, closes below midpoint of bullish prior
    if (pbull && bear && c.open > p.high && c.close < pmid && c.close > p.open)
      out.push({ i, name: "Dark Cloud Cover ☁️", sig: "bearish" });

    // On-Neck: bear candle, next opens below low and closes near prior close
    if (pbear && bull && c.open < p.low && Math.abs(c.close - p.close) / p.close < 0.003)
      out.push({ i, name: "On-Neck", sig: "bearish" });

    // In-Neck: bear candle, close inside prior body
    if (pbear && bull && c.open < p.low && c.close > p.close && c.close < (p.open + p.close) / 2)
      out.push({ i, name: "In-Neck", sig: "bearish" });

    // Thrusting: bear prior, bull close > midpoint of prior body (weaker than piercing)
    if (pbear && bull && c.open < p.low && c.close > pmid && c.close < p.open && c.close > p.close)
      out.push({ i, name: "Thrusting", sig: "neutral" });

    // Tweezer Top / Bottom (exact high/low match)
    if (Math.abs(c.high - p.high) / (p.high || 1) < 0.002 && bear && pbull)
      out.push({ i, name: "Tweezer Top 🎚️", sig: "bearish" });
    if (Math.abs(c.low - p.low) / (p.low || 1) < 0.002 && bull && pbear)
      out.push({ i, name: "Tweezer Bottom 🎚️", sig: "bullish" });

    // Matching Low: two bearish candles with same close (support test)
    if (pbear && bear && Math.abs(c.close - p.close) / p.close < 0.002)
      out.push({ i, name: "Matching Low", sig: "bullish" });

    // Matching High
    if (pbull && bull && Math.abs(c.close - p.close) / p.close < 0.002)
      out.push({ i, name: "Matching High", sig: "bearish" });

    // Belt Hold (Bullish): long bull candle opening near low (no lower wick)
    if (bull && lw < body * 0.03 && body > avgBody * 1.3)
      out.push({ i, name: "Bull Belt Hold", sig: "bullish" });
    if (bear && uw < body * 0.03 && body > avgBody * 1.3)
      out.push({ i, name: "Bear Belt Hold", sig: "bearish" });

    // Kicker (strong reversal gap): prior bar and current bar gap in opposite direction
    if (pbear && bull && c.open > p.open && body > avgBody)
      out.push({ i, name: "Bullish Kicker 🦵", sig: "bullish" });
    if (pbull && bear && c.open < p.open && body > avgBody)
      out.push({ i, name: "Bearish Kicker 🦵", sig: "bearish" });

    // Upside Gap Two Crows (small): bull large, gap-up doji/small bear, another bear that engulfs
    // Checked in 3-candle section below

    // ================================================================
    // 3-CANDLE PATTERNS
    // ================================================================

    // Morning / Evening Star
    if (ppbear && pb < ppb * 0.35 && bull && c.close > (pp.open + pp.close) / 2)
      out.push({ i, name: "Morning Star ⭐", sig: "bullish" });
    if (ppbull && pb < ppb * 0.35 && bear && c.close < (pp.open + pp.close) / 2)
      out.push({ i, name: "Evening Star ⭐", sig: "bearish" });

    // Morning / Evening Doji Star (middle candle is doji)
    if (ppbear && pb < ppb * 0.1 && bull && c.close > (pp.open + pp.close) / 2)
      out.push({ i, name: "Morning Doji Star ✨", sig: "bullish" });
    if (ppbull && pb < ppb * 0.1 && bear && c.close < (pp.open + pp.close) / 2)
      out.push({ i, name: "Evening Doji Star ✨", sig: "bearish" });

    // Abandoned Baby (gaps on both sides)
    if (ppbear && p.low > pp.high && pb < prng * 0.1 && bull && c.low > p.high)
      out.push({ i, name: "Abandoned Baby Bull 👶", sig: "bullish" });
    if (ppbull && p.high < pp.low && pb < prng * 0.1 && bear && c.high < p.low)
      out.push({ i, name: "Abandoned Baby Bear 👶", sig: "bearish" });

    // Three White Soldiers
    if (bull && pbull && ppbull
      && c.open > p.open && c.open < p.close
      && p.open > pp.open && p.open < pp.close
      && c.close > p.close && p.close > pp.close
      && uw < body * 0.3 && puw < pb * 0.3)
      out.push({ i, name: "3 White Soldiers 🪖", sig: "bullish" });

    // Three Black Crows
    if (bear && pbear && ppbear
      && c.open < p.open && c.open > p.close
      && p.open < pp.open && p.open > pp.close
      && c.close < p.close && p.close < pp.close
      && lw < body * 0.3 && plw < pb * 0.3)
      out.push({ i, name: "3 Black Crows 🐦‍⬛", sig: "bearish" });

    // Three Inside Up (Bull Harami + confirmation)
    if (ppbear && pbull && p.open > pp.close && p.close < pp.open && bull && c.close > pp.open)
      out.push({ i, name: "3 Inside Up", sig: "bullish" });

    // Three Inside Down
    if (ppbull && pbear && p.open < pp.close && p.close > pp.open && bear && c.close < pp.open)
      out.push({ i, name: "3 Inside Down", sig: "bearish" });

    // Three Outside Up (Engulfing + confirmation)
    if (ppbear && pbull && p.open < pp.close && p.close > pp.open && bull && c.close > p.close)
      out.push({ i, name: "3 Outside Up", sig: "bullish" });

    // Three Outside Down
    if (ppbull && pbear && p.open > pp.close && p.close < pp.open && bear && c.close < p.close)
      out.push({ i, name: "3 Outside Down", sig: "bearish" });

    // Upside Gap Two Crows
    if (ppbull && ppb > avgBody * 1.2
      && pbear && p.open > pp.close
      && bear && c.open < p.open && c.close < p.close && c.close > pp.close)
      out.push({ i, name: "Upside Gap 2 Crows", sig: "bearish" });

    // Stick Sandwich (bearish, bullish, bearish – same close on 1&3 = support)
    if (ppbear && pbull && bear && Math.abs(c.close - pp.close) / pp.close < 0.003)
      out.push({ i, name: "Stick Sandwich", sig: "bullish" });

    // Unique Three River Bottom (rare reversal)
    if (ppbear && ppb > avgBody && pbear && p.low < pp.low && pb < ppb * 0.5 && bull && c.close < pmid)
      out.push({ i, name: "Unique 3-River Bottom", sig: "bullish" });

    // ================================================================
    // 4+ CANDLE PATTERNS
    // ================================================================

    // Three Stars in the South (3 progressive hammers, bearish → bullish)
    if (i >= 3
      && p3bear && ppbear && pbear
      && pp.low > p3.low && p.low > pp.low
      && Math.abs(pp.close - pp.open) < p3b && pb < ppb
      && bull)
      out.push({ i, name: "3 Stars in South ⭐⭐⭐", sig: "bullish" });

    // Rising Three Methods: big bull, 3 small bears contained within it, big bull breakout
    { const bigO = p4.open, bigC = p4.close; // p4 is the big bull candle
      if (p4bull && Math.abs(bigC - bigO) > avgBody * 1.2
        && p3bear && ppbear && pbear
        && p3.high < bigC && pp.high < bigC && p.high < bigC   // all inside big bull body
        && p3.low > bigO && pp.low > bigO && p.low > bigO
        && bull && c.close > bigC)
        out.push({ i, name: "Rising 3 Methods 📈", sig: "bullish" });
    }
    // Falling Three Methods: big bear, 3 small bulls inside, big bear breakout
    { const bigO = p4.open, bigC = p4.close; // p4 is the big bear candle
      if (p4bear && Math.abs(bigO - bigC) > avgBody * 1.2
        && p3bull && ppbull && pbull
        && p3.high < bigO && pp.high < bigO && p.high < bigO
        && p3.low > bigC && pp.low > bigC && p.low > bigC
        && bear && c.close < bigC)
        out.push({ i, name: "Falling 3 Methods 📉", sig: "bearish" });
    }

    // Mat Hold (variant of rising three)
    if (p4bull && Math.abs(p4.close - p4.open) > avgBody * 1.2 && p3bear && ppbear && pbear
      && p3.high < p4.close && p.high < p4.close && bull && c.close > p4.close)
      out.push({ i, name: "Mat Hold", sig: "bullish" });

    // Deliberation (3 bulls, last small – weakening momentum)
    if (ppbull && ppb > avgBody && pbull && pb > avgBody * 0.8 && bull && body < pb * 0.4 && uw > body)
      out.push({ i, name: "Deliberation ⚠️", sig: "bearish" });

    // Advance Block (3 bulls but wicks getting bigger – bearish warning)
    if (ppbull && pbull && bull
      && c.close > p.close && p.close > pp.close
      && puw > ppb * 0.3 && uw > pb * 0.3 && body < pb)
      out.push({ i, name: "Advance Block ⚠️", sig: "bearish" });
  }

  // ── Post-loop: add .body to each candle ref for Rising/Falling helpers ──
  // (nothing extra needed — just return)
  return out;
};
const detectSMC = (candles) => {
  const out = [], n = candles.length;
  for (let i = 1; i < n - 1; i++) {
    const a = candles[i - 1], c2 = candles[i + 1];
    if (c2.low > a.high) out.push({ type: "FVG_BULL", i, lo: a.high, hi: c2.low, label: "Bullish FVG" });
    if (c2.high < a.low) out.push({ type: "FVG_BEAR", i, lo: c2.high, hi: a.low, label: "Bearish FVG" });
  }
  for (let i = 3; i < n - 1; i++) {
    const c = candles[i], nx = candles[i + 1];
    const avg = candles.slice(Math.max(0, i - 5), i).reduce((a, x) => a + (x.high - x.low), 0) / 5 || 0.001;
    if (c.close < c.open && (nx.close - c.close) > avg * 1.5) out.push({ type: "OB_BULL", i, lo: c.low, hi: c.high, label: "Bull Order Block" });
    if (c.close > c.open && (c.close - nx.close) > avg * 1.5) out.push({ type: "OB_BEAR", i, lo: c.low, hi: c.high, label: "Bear Order Block" });
  }
  for (let i = 10; i < n - 1; i++) {
    const prev = candles.slice(i - 10, i);
    const rh = Math.max(...prev.map(c => c.high)), rl = Math.min(...prev.map(c => c.low));
    const c = candles[i], nx = candles[i + 1];
    if (c.high > rh && c.close < rh && nx.close < c.close) out.push({ type: "LIQ_BEAR", i, price: c.high, label: "🪤 Bear Trap/Grab" });
    if (c.low < rl && c.close > rl && nx.close > c.close) out.push({ type: "LIQ_BULL", i, price: c.low, label: "🪤 Bull Trap/Grab" });
  }
  for (let i = 10; i < n; i++) {
    const prev = candles.slice(i - 10, i);
    const rh = Math.max(...prev.map(c => c.high)), rl = Math.min(...prev.map(c => c.low));
    const c = candles[i], pc = candles[i - 1];
    if (pc.close <= rh && c.close > rh) out.push({ type: "BOS_BULL", i, price: c.close, label: "📈 BOS Bullish" });
    if (pc.close >= rl && c.close < rl) out.push({ type: "BOS_BEAR", i, price: c.close, label: "📉 BOS Bearish" });
  }
  return out;
};
const detectSR = (candles) => {
  const lvls = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const nb = [candles[i - 2], candles[i - 1], candles[i + 1], candles[i + 2]];
    if (nb.every(c => c.high <= candles[i].high)) lvls.push({ p: candles[i].high, t: "R" });
    if (nb.every(c => c.low >= candles[i].low)) lvls.push({ p: candles[i].low, t: "S" });
  }
  const cls = [];
  for (const lv of lvls) {
    const ex = cls.find(c => Math.abs(c.p - lv.p) / lv.p < 0.015 && c.t === lv.t);
    ex ? ex.s++ : cls.push({ ...lv, s: 1 });
  }
  return cls.filter(l => l.s >= 2).sort((a, b) => b.s - a.s).slice(0, 8);
};
const detectChartPatterns = (candles) => {
  const out = [], n = candles.length;
  if (n < 20) return out;
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
  const swingHighs = [], swingLows = [];
  for (let i = 2; i < n - 2; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) swingHighs.push({ i, p: highs[i] });
    if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2]) swingLows.push({ i, p: lows[i] });
  }
  for (let k = 0; k < swingHighs.length - 1; k++) { const a = swingHighs[k], b = swingHighs[k+1]; if (Math.abs(a.p - b.p) / a.p < 0.02 && b.i - a.i > 5) out.push({ name: "Double Top", sig: "bearish", i: b.i }); }
  for (let k = 0; k < swingLows.length - 1; k++) { const a = swingLows[k], b = swingLows[k+1]; if (Math.abs(a.p - b.p) / a.p < 0.02 && b.i - a.i > 5) out.push({ name: "Double Bottom", sig: "bullish", i: b.i }); }
  if (swingHighs.length >= 3) { const l = swingHighs.slice(-3); if (l[0].p < l[1].p && l[1].p < l[2].p) out.push({ name: "Higher Highs (Uptrend)", sig: "bullish", i: l[2].i }); if (l[0].p > l[1].p && l[1].p > l[2].p) out.push({ name: "Lower Highs (Downtrend)", sig: "bearish", i: l[2].i }); }
  return out;
};

// ================================================================
// SHARED DATA UTILITIES
// ================================================================
const fetchYahoo = async (sym, interval = "1d", range = "3mo") => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.toUpperCase()}?interval=${interval}&range=${range}&includePrePost=false`;
  // Try multiple CORS proxies for reliability
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://thingproxy.freeboard.io/fetch/${url}`
  ];
  
  let res, error;
  for (const proxyUrl of proxies) {
    try {
      res = await fetch(proxyUrl);
      if (res.ok) break;
    } catch (e) {
      error = e;
    }
  }
  
  if (!res || !res.ok) throw new Error(`HTTP ${res?.status || 'Network error'}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error("No data");
  const ts = result.timestamp, q = result.indicators.quote[0];
  return {
    candles: ts.map((t, i) => ({ date: new Date(t * 1000).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" }), ts: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 })).filter(c => c.open !== null && c.close !== null),
    meta: result.meta
  };
};
const fetchQuickQuote = async (sym) => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.toUpperCase()}?interval=1d&range=2d`;
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://thingproxy.freeboard.io/fetch/${url}`
  ];
  
  let res;
  for (const proxyUrl of proxies) {
    try {
      res = await fetch(proxyUrl);
      if (res.ok) break;
    } catch {}
  }
  
  if (!res || !res.ok) throw new Error();
  const json = await res.json();
  const r = json.chart?.result?.[0]; if (!r) throw new Error();
  const q = r.indicators.quote[0];
  const closes = q.close.filter(v => v !== null);
  const c = closes[closes.length - 1], p2 = closes[closes.length - 2] || c;
  return { price: c, prev: p2, pct: ((c - p2) / p2 * 100), name: r.meta?.shortName || sym };
};

// Stock search using Yahoo Finance autocomplete
const searchStocks = async (query) => {
  if (!query || query.length < 2) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
  ];
  
  let res;
  for (const proxyUrl of proxies) {
    try {
      res = await fetch(proxyUrl);
      if (res.ok) break;
    } catch {}
  }
  
  if (!res || !res.ok) return [];
  const json = await res.json();
  return (json.quotes || []).map(q => ({
    symbol: q.symbol,
    name: q.shortname || q.longname || q.symbol,
    type: q.quoteType || 'EQUITY',
    exchange: q.exchange || ''
  })).filter(q => q.symbol);
};


// ================================================================
// VOLUME PROFILE ENGINE
// ================================================================
const calcVolumeProfile = (candles, bins = 40) => {
  if (!candles.length) return null;
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
  const hi = Math.max(...highs), lo = Math.min(...lows);
  const range = hi - lo || 0.001;
  const step = range / bins;
  const profile = Array.from({ length: bins }, (_, i) => ({
    price: lo + step * (i + 0.5), vol: 0, bullVol: 0, bearVol: 0,
  }));
  candles.forEach(c => {
    const bull = c.close >= c.open;
    const vol = c.volume || 0;
    const cRange = c.high - c.low || 0.001;
    profile.forEach(bin => {
      const overlap = Math.max(0, Math.min(bin.price + step/2, c.high) - Math.max(bin.price - step/2, c.low));
      if (overlap > 0) {
        const share = (overlap / cRange) * vol;
        bin.vol += share;
        if (bull) bin.bullVol += share; else bin.bearVol += share;
      }
    });
  });
  const maxVol = Math.max(...profile.map(b => b.vol), 1);
  const vpoc = profile.reduce((best, b) => b.vol > best.vol ? b : best, profile[0]);
  const totalVol = profile.reduce((a, b) => a + b.vol, 0);
  const sorted = [...profile].sort((a, b) => b.vol - a.vol);
  let vaCum = 0; const vaSet = new Set();
  for (const b of sorted) { vaCum += b.vol; vaSet.add(b.price); if (vaCum >= totalVol * 0.7) break; }
  const vaPrices = [...vaSet].sort((a, b) => a - b);
  return { profile, maxVol, vpoc, step,
    vah: vaPrices[vaPrices.length - 1] ?? vpoc.price,
    val: vaPrices[0] ?? vpoc.price };
};


// ================================================================
// REGIME DETECTION ENGINE
// ================================================================
const detectRegime = (candles, rsiarr, atrArr) => {
  if (candles.length < 30) return { regime: "unknown", sub: "", confidence: 0, detail: "", atrPct: "0", bbWidth: "0", dirRatio: "0", squeeze: false, slope: "0", rsiDist: "0" };
  const n = candles.length;
  const cls = candles.map(c => c.close);
  const last = cls[n - 1];
  const trs = candles.slice(-20).map((c, i, a) => {
    if (!i) return c.high - c.low;
    return Math.max(c.high - c.low, Math.abs(c.high - a[i-1].close), Math.abs(c.low - a[i-1].close));
  });
  const avgTR = trs.reduce((a, b) => a + b, 0) / trs.length;
  const upMoves = candles.slice(-20).filter((c, i, a) => i > 0 && c.close > a[i-1].close).length;
  const dirRatio = Math.abs(upMoves - (19 - upMoves)) / 19;
  const atr = atrArr.filter(v => v).slice(-1)[0] || avgTR;
  const atrPct = atr / last * 100;
  const rsi = rsiarr.filter(v => v).slice(-1)[0] || 50;
  const rsiDist = Math.abs(rsi - 50);
  const s20 = sma(cls, 20), s50 = sma(cls, 50);
  const s20v = s20.filter(v => v).slice(-1)[0], s20p = s20.filter(v => v).slice(-2)[0];
  const slope = s20v && s20p ? (s20v - s20p) / s20p * 100 : 0;
  const bbArr2 = calcBB(cls, 20);
  const bb = bbArr2.filter(v => v.u).slice(-1)[0];
  const bbWidth = bb ? (bb.u - bb.l) / bb.m * 100 : 3;
  const bbWidths = bbArr2.filter(v => v.u).slice(-20).map(b => (b.u - b.l) / b.m * 100);
  const avgBBW = bbWidths.length ? bbWidths.reduce((a, b) => a + b, 0) / bbWidths.length : 3;
  const squeeze = bbWidth < avgBBW * 0.6;
  const expansion = bbWidth > avgBBW * 1.5;
  let regime = "ranging", sub = "", confidence = 50, detail = "";
  if (atrPct > 3.5 || expansion) {
    regime = "volatile"; sub = atrPct > 5 ? "extreme" : "elevated";
    confidence = Math.min(95, 50 + atrPct * 8);
    detail = `ATR ${atrPct.toFixed(1)}% — high noise. Widen SL, reduce position size.`;
  } else if (squeeze && dirRatio < 0.3) {
    regime = "squeeze"; sub = "coiling";
    confidence = 70;
    detail = `BB squeeze (${bbWidth.toFixed(1)}% vs avg ${avgBBW.toFixed(1)}%). Coiling before breakout — wait for direction.`;
  } else if (dirRatio > 0.55 && Math.abs(slope) > 0.08 && rsiDist > 10) {
    regime = "trending"; sub = slope > 0 ? "uptrend" : "downtrend";
    confidence = Math.min(90, 50 + dirRatio * 50 + rsiDist);
    detail = `${dirRatio > 0.7 ? "Strong" : "Moderate"} ${sub}. Slope ${slope.toFixed(3)}%/bar. Trend-following preferred.`;
  } else if (dirRatio < 0.35 && atrPct < 1.5) {
    regime = "ranging"; sub = "tight";
    confidence = Math.min(85, 50 + (0.35 - dirRatio) * 80);
    detail = `Low-volatility range. S/R bounces and mean-reversion preferred.`;
  } else if (dirRatio < 0.5) {
    regime = "ranging"; sub = "choppy";
    confidence = 55;
    detail = `Choppy mixed action. High-confluence setups only.`;
  } else {
    regime = "transitional"; sub = "breakout_watch";
    confidence = 50;
    detail = `Regime unclear. Wait for confirmation before acting.`;
  }
  return { regime, sub, confidence: Math.round(confidence), detail, atrPct: atrPct.toFixed(2), bbWidth: bbWidth.toFixed(2), dirRatio: dirRatio.toFixed(2), squeeze, slope: slope.toFixed(4), rsiDist: rsiDist.toFixed(1) };
};

// ================================================================
// SVG CANDLESTICK CHART
// ================================================================
function CandleChart({ candles, s20arr, s50arr, s200arr, bbarr, srLvls, showSMA20, showSMA50, showSMA200, showBB, showSR, showVol, fibData, divergences, vwapArr, pivots, drawTool, drawings, onAddDrawing, onDeleteDrawing, volProfile }) {
  const ref = useRef(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const ro = new ResizeObserver(e => setW(e[0].contentRect.width));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const svgRef = useRef(null);
  const [inProg, setInProg] = useState(null); // in-progress drawing
  const vis = candles.slice(-90), n = vis.length, offset = candles.length - n;
  if (!n) return <div ref={ref} style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: "#4a5a7a", fontFamily: "monospace", fontSize: 12 }}>NO DATA — FETCH A TICKER</div>;
  const PL = 64, PR = 12, PT = 10, PB = 22, TH = 270, cH = TH * 0.68, vH = TH * 0.15, gH = TH * 0.17;
  const cWraw = (W - PL - PR) / n, CW = Math.max(1, Math.min(14, cWraw - 1.5));
  const allP = [...vis.flatMap(c => [c.high, c.low])];
  if (showBB) vis.forEach((_, i) => { const b = bbarr[offset + i]; if (b?.u) { allP.push(b.u); allP.push(b.l); } });
  const minP = Math.min(...allP) * 0.9996, maxP = Math.max(...allP) * 1.0004, pR = maxP - minP;
  const maxVol = Math.max(...vis.map(c => c.volume || 0)) || 1;
  const xOf = i => PL + (i + 0.5) * cWraw, yOf = p => PT + cH - ((p - minP) / pR) * cH;
  const mkPath = (arr, off) => { let d = "", pd = false; for (let i = 0; i < n; i++) { const v = arr[off + i]; if (v != null) { d += pd ? `L${xOf(i)},${yOf(v)} ` : `M${xOf(i)},${yOf(v)} `; pd = true; } else pd = false; } return d; };
  const mkBB = (upper) => { let d = "", pd = false; for (let i = 0; i < n; i++) { const b = bbarr[offset + i], v = upper ? b?.u : b?.l; if (v) { d += pd ? `L${xOf(i)},${yOf(v)} ` : `M${xOf(i)},${yOf(v)} `; pd = true; } else pd = false; } return d; };
  const gridPs = [0, 0.2, 0.4, 0.6, 0.8, 1].map(f => minP + pR * f);
  // Drawing coordinate converters (safe outside render path)
  const getSVGPoint = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div ref={ref} style={{ width: "100%", overflow: "hidden", cursor: drawTool && drawTool !== "none" ? "crosshair" : "default" }}>
      <svg ref={svgRef} width={W} height={TH + PB} style={{ display: "block" }}
        onMouseDown={e => {
          if (!drawTool || drawTool === "none") return;
          const { x, y } = getSVGPoint(e);
          if (x < PL || x > W - PR || y < PT || y > PT + cH) return;
          const barI = Math.round((x - PL) / cWraw - 0.5);
          const price = minP + (1 - (y - PT) / cH) * pR;
          setInProg({ type: drawTool, x1: x, y1: y, x2: x, y2: y, bar1: barI, price1: price, bar2: barI, price2: price });
        }}
        onMouseMove={e => {
          if (!inProg) return;
          const { x, y } = getSVGPoint(e);
          const barI = Math.round((x - PL) / cWraw - 0.5);
          const price = minP + (1 - (y - PT) / cH) * pR;
          setInProg(prev => ({ ...prev, x2: x, y2: y, bar2: barI, price2: price }));
        }}
        onMouseUp={e => {
          if (!inProg) return;
          const { x, y } = getSVGPoint(e);
          const barI = Math.round((x - PL) / cWraw - 0.5);
          const price2 = minP + (1 - (y - PT) / cH) * pR;
          const drawing = inProg.type === "hline"
            ? { id: Date.now(), type: "hline", price: inProg.price1 }
            : { id: Date.now(), type: inProg.type, bar1: inProg.bar1, price1: inProg.price1, bar2: barI, price2 };
          onAddDrawing?.(drawing);
          setInProg(null);
        }}
        onMouseLeave={() => setInProg(null)}>
        <rect x={PL} y={PT} width={W - PL - PR} height={cH + gH + vH} fill="#04040c" rx={2} />
        {gridPs.map((p, i) => (<g key={i}><line x1={PL} y1={yOf(p)} x2={W - PR} y2={yOf(p)} stroke="#1a2a40" strokeWidth={1} /><text x={PL - 5} y={yOf(p) + 4} textAnchor="end" fill="#e8f0f8" fontSize={9} fontFamily="monospace">{p < 10 ? p.toFixed(4) : p < 100 ? p.toFixed(2) : p.toFixed(1)}</text></g>))}
        {showSR && srLvls.map((lv, i) => (<g key={i}><line x1={PL} y1={yOf(lv.p)} x2={W - PR} y2={yOf(lv.p)} stroke={lv.t === "R" ? "#ff3355" : "#00ff9d"} strokeWidth={0.8} strokeDasharray="5,4" opacity={0.5} /><text x={W - PR - 2} y={yOf(lv.p) - 2} textAnchor="end" fill={lv.t === "R" ? "#ff3355" : "#00ff9d"} fontSize={7} fontFamily="monospace" opacity={0.7}>{lv.t} {lv.p < 10 ? lv.p.toFixed(4) : lv.p.toFixed(2)}</text></g>))}
        {showBB && <><path d={mkBB(true)} fill="none" stroke="#ffcc00" strokeWidth={1} opacity={0.4} strokeDasharray="3,2" /><path d={mkBB(false)} fill="none" stroke="#ffcc00" strokeWidth={1} opacity={0.4} strokeDasharray="3,2" /></>}
        {showSMA20 && <path d={mkPath(s20arr, offset)} fill="none" stroke="#00d4ff" strokeWidth={1.5} opacity={0.85} />}
        {showSMA50 && <path d={mkPath(s50arr, offset)} fill="none" stroke="#ff8c00" strokeWidth={1.5} opacity={0.85} />}
        {showSMA200 && s200arr && <path d={mkPath(s200arr, offset)} fill="none" stroke="#ff3355" strokeWidth={1.2} opacity={0.7} strokeDasharray="6,3" />}
        {vis.map((c, i) => { const x = xOf(i), bull = c.close >= c.open, col = bull ? "#00ff9d" : "#ff3355", bt = yOf(Math.max(c.open, c.close)), bb2 = yOf(Math.min(c.open, c.close)), bH = Math.max(1, bb2 - bt); return <g key={i}><line x1={x} y1={yOf(c.high)} x2={x} y2={yOf(c.low)} stroke={col} strokeWidth={Math.max(0.8, CW / 6)} /><rect x={x - CW / 2} y={bt} width={CW} height={bH} fill={col} opacity={bull ? 0.88 : 0.82} rx={0.5} /></g>; })}
        {showVol && <text x={PL - 5} y={PT + cH + gH + 6} textAnchor="end" fill="#6a7a9a" fontSize={7} fontFamily="monospace">VOL</text>}
        {showVol && vis.map((c, i) => { const x = xOf(i), bull = c.close >= c.open, h = ((c.volume || 0) / maxVol) * vH; return <rect key={i} x={x - CW / 2} y={PT + cH + gH + vH - h} width={CW} height={h} fill={bull ? "#00ff9d" : "#ff3355"} opacity={0.3} rx={0.3} />; })}
        {vis.map((c, i) => i % Math.ceil(n / 8) === 0 ? <text key={i} x={xOf(i)} y={TH + PB - 4} textAnchor="middle" fill="#e8f0f8" fontSize={8} fontFamily="monospace">{c.date}</text> : null)}

        {/* ── FIBONACCI LEVELS ── */}
        {fibData && fibData.levels.map((lv, fi) => {
          const y = yOf(lv.price);
          if (y < PT - 2 || y > PT + cH + 2) return null;
          const isGolden = lv.ratio === 0.618;
          return (
            <g key={fi}>
              <line x1={PL} y1={y} x2={W - PR} y2={y}
                stroke={lv.color} strokeWidth={isGolden ? 1.4 : 0.8}
                strokeDasharray={lv.ext ? "3,4" : isGolden ? "8,3" : "6,3"}
                opacity={isGolden ? 1 : 0.75} />
              <rect x={PL} y={y - 7} width={28} height={9} fill="#04040c" rx={1} opacity={0.85} />
              <text x={PL + 2} y={y} fill={lv.color} fontSize={7} fontFamily="monospace" opacity={0.9}>{lv.label}</text>
              <text x={W - PR - 2} y={y - 2} textAnchor="end" fill={lv.color} fontSize={7} fontFamily="monospace" opacity={0.85}>
                {lv.price < 10 ? lv.price.toFixed(5) : lv.price.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* ── SWING ANCHORS for Fib ── */}
        {fibData && (() => {
          const hiVis = fibData.absHiIdx - offset;
          const loVis = fibData.absLoIdx - offset;
          const hiX = hiVis >= 0 && hiVis < n ? xOf(hiVis) : null;
          const loX = loVis >= 0 && loVis < n ? xOf(loVis) : null;
          return (<>
            {hiX && <circle cx={hiX} cy={yOf(fibData.swingHi.high)} r={3} fill="#ff8c00" opacity={0.9} />}
            {loX && <circle cx={loX} cy={yOf(fibData.swingLo.low)}  r={3} fill="#ff8c00" opacity={0.9} />}
            {hiX && loX && <line x1={loX} y1={yOf(fibData.swingLo.low)} x2={hiX} y2={yOf(fibData.swingHi.high)} stroke="#ff8c0040" strokeWidth={1} strokeDasharray="2,4" />}
          </>);
        })()}

        {/* ── DIVERGENCE LINES ON PRICE CHART ── */}
        {divergences && divergences.map((d, di) => {
          const x1raw = d.idx1 - offset, x2raw = d.idx2 - offset;
          if (x1raw < 0 || x2raw >= n) return null;
          const x1 = xOf(x1raw), x2 = xOf(x2raw);
          const isBull = d.type.startsWith("bull");
          const y1 = yOf(isBull ? d.price1 : d.price1);
          const y2 = yOf(isBull ? d.price2 : d.price2);
          return (
            <g key={di}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={d.color} strokeWidth={1.8} strokeDasharray="5,2" opacity={0.85} />
              <circle cx={x1} cy={y1} r={3.5} fill="none" stroke={d.color} strokeWidth={1.5} opacity={0.9} />
              <circle cx={x2} cy={y2} r={3.5} fill={d.color} strokeWidth={0} opacity={0.9} />
            </g>
          );
        })}


        {/* ── VOLUME PROFILE ── */}
        {volProfile && (() => {
          const VP_W = 52; // max width of bars (left margin area + overlap)
          const barMaxW = VP_W - 4;
          return (<>
            {volProfile.profile.map((bin, bi) => {
              const yTop = yOf(bin.price + volProfile.step / 2);
              const yBot = yOf(bin.price - volProfile.step / 2);
              const bH   = Math.max(1, yBot - yTop);
              const bW   = (bin.vol / volProfile.maxVol) * barMaxW;
              const isVPOC = bin.price === volProfile.vpoc.price;
              const inVA   = bin.price >= volProfile.val && bin.price <= volProfile.vah;
              const bullW  = (bin.bullVol / volProfile.maxVol) * barMaxW;
              if (yTop < PT || yBot > PT + cH) return null;
              return (
                <g key={bi}>
                  {/* Full bar (bear portion) */}
                  <rect x={PL - bW - 2} y={yTop} width={bW} height={bH}
                    fill={isVPOC ? "#ff6b35" : inVA ? "#3a5a4080" : "#2a3a5060"} rx={0.5} />
                  {/* Bull sub-bar */}
                  <rect x={PL - bullW - 2} y={yTop} width={bullW} height={bH}
                    fill={isVPOC ? "#ff9d35" : inVA ? "#00ff9d50" : "#00ff9d25"} rx={0.5} />
                </g>
              );
            })}
            {/* VPOC label */}
            {(() => {
              const y = yOf(volProfile.vpoc.price);
              return y >= PT && y <= PT + cH ? (
                <g>
                  <line x1={PL - VP_W} y1={y} x2={W - PR} y2={y} stroke="#ff6b35" strokeWidth={1} strokeDasharray="6,3" opacity={0.7} />
                  <text x={PL - VP_W + 1} y={y - 2} fill="#ff6b35" fontSize={7} fontFamily="monospace">VPOC</text>
                </g>
              ) : null;
            })()}
            {/* VAH/VAL lines */}
            {[{ p: volProfile.vah, l: "VAH" }, { p: volProfile.val, l: "VAL" }].map(({ p, l }) => {
              const y = yOf(p);
              return y >= PT && y <= PT + cH ? (
                <g key={l}>
                  <line x1={PL - VP_W} y1={y} x2={PL - 2} y2={y} stroke="#ff6b3580" strokeWidth={0.8} />
                  <text x={PL - VP_W + 1} y={y - 1} fill="#ff6b3580" fontSize={6} fontFamily="monospace">{l}</text>
                </g>
              ) : null;
            })}
          </>);
        })()}
        {/* ── VWAP ── */}
        {vwapArr && (() => {
          let d = "", pd = false;
          for (let i = 0; i < n; i++) {
            const v = vwapArr[offset + i];
            if (v != null) { d += pd ? `L${xOf(i)},${yOf(v)} ` : `M${xOf(i)},${yOf(v)} `; pd = true; } else pd = false;
          }
          return <path d={d} fill="none" stroke="#00d4ff" strokeWidth={1.4} opacity={0.7} strokeDasharray="8,3" />;
        })()}
        {vwapArr && (() => {
          const last = vwapArr[offset + n - 1];
          if (!last) return null;
          return <><text x={W - PR - 2} y={yOf(last) - 2} textAnchor="end" fill="#00d4ff" fontSize={7} fontFamily="monospace" opacity={0.8}>VWAP</text></>;
        })()}

        {/* ── PIVOT POINTS ── */}
        {pivots && [
          { label: "PP", val: pivots.pp, col: "#ffffff80" },
          { label: "R1", val: pivots.r1, col: "#ff335570" }, { label: "R2", val: pivots.r2, col: "#ff335590" }, { label: "R3", val: pivots.r3, col: "#ff3355bb" },
          { label: "S1", val: pivots.s1, col: "#00ff9d70" }, { label: "S2", val: pivots.s2, col: "#00ff9d90" }, { label: "S3", val: pivots.s3, col: "#00ff9dbb" },
        ].map(({ label, val, col }) => {
          const y = yOf(val);
          if (y < PT - 2 || y > PT + cH + 2) return null;
          return (
            <g key={label}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke={col} strokeWidth={0.8} strokeDasharray="4,3" />
              <text x={W - PR - 2} y={y - 2} textAnchor="end" fill={col} fontSize={7} fontFamily="monospace">{label} {val < 10 ? val.toFixed(4) : val.toFixed(2)}</text>
            </g>
          );
        })}

        {/* ── SAVED DRAWINGS ── */}
        {drawings && drawings.map(d => {
          if (d.type === "hline") {
            const y = yOf(d.price);
            if (y < PT - 2 || y > PT + cH + 2) return null;
            return (
              <g key={d.id} style={{ cursor: "pointer" }} onClick={() => onDeleteDrawing?.(d.id)}>
                <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#00d4ff" strokeWidth={1.2} strokeDasharray="8,3" opacity={0.8} />
                <text x={W - PR - 2} y={y - 2} textAnchor="end" fill="#00d4ff" fontSize={7} fontFamily="monospace" opacity={0.7}>{d.price < 10 ? d.price.toFixed(5) : d.price.toFixed(2)} ✕</text>
              </g>
            );
          }
          if (d.type === "tline" || d.type === "ray") {
            const bx1 = d.bar1 - offset, bx2 = d.bar2 - offset;
            if ((bx1 < 0 && bx2 < 0) || (bx1 >= n && bx2 >= n)) return null;
            const col = d.type === "ray" ? "#a855f7" : "#ffcc00";
            const x1c = Math.max(PL, Math.min(W - PR, xOf(Math.max(0, bx1))));
            const x2c = Math.max(PL, Math.min(W - PR, xOf(Math.max(0, bx2))));
            const y1c = yOf(d.price1), y2c = yOf(d.price2);
            return (
              <g key={d.id} style={{ cursor: "pointer" }} onClick={() => onDeleteDrawing?.(d.id)}>
                <line x1={x1c} y1={y1c} x2={x2c} y2={y2c} stroke={col} strokeWidth={1.3} opacity={0.85} />
                <circle cx={x1c} cy={y1c} r={3} fill={col} opacity={0.6} />
                <circle cx={x2c} cy={y2c} r={3} fill={col} opacity={0.9} />
              </g>
            );
          }
          return null;
        })}

        {/* ── IN-PROGRESS DRAWING ── */}
        {inProg && (() => {
          if (inProg.type === "hline") {
            return <line x1={PL} y1={inProg.y1} x2={W - PR} y2={inProg.y1} stroke="#00d4ff" strokeWidth={1} strokeDasharray="6,3" opacity={0.7} />;
          }
          const col = inProg.type === "ray" ? "#a855f7" : "#ffcc00";
          return <line x1={inProg.x1} y1={inProg.y1} x2={inProg.x2} y2={inProg.y2} stroke={col} strokeWidth={1.2} strokeDasharray="5,3" opacity={0.8} />;
        })()}
      </svg>
    </div>
  );
}

function RSIChart({ chartData, divergences, totalCandles }) {
  const vis = chartData.slice(-90);
  const lastRSI = vis.filter(d => d.rsi !== null).slice(-1)[0]?.rsi;
  const rsiCol = lastRSI > 70 ? "#ff3355" : lastRSI < 30 ? "#00ff9d" : "#00d4ff";
  const wrapRef = useRef(null);
  const [wW, setWW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(e => setWW(e[0].contentRect.width));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Build RSI divergence overlay lines
  const RSI_ML = { left: 52, right: 12, top: 2, bottom: 2, h: 76 };
  const visLen = Math.min(totalCandles || 90, 90);
  const offset = (totalCandles || 90) - visLen;
  const rsiX = (absIdx) => {
    const vi = absIdx - offset;
    return RSI_ML.left + (vi + 0.5) / visLen * (wW - RSI_ML.left - RSI_ML.right);
  };
  const rsiY = (v) => RSI_ML.top + (100 - v) / 100 * RSI_ML.h;

  return (
    <div style={{ background: "#04040c", borderRadius: 4, padding: "6px 0 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px 4px", fontFamily: "monospace", fontSize: 11, flexWrap: "wrap" }}>
        <span style={{ color: "#e8f0f8" }}>RSI(14)</span>
        <span style={{ color: rsiCol, fontWeight: "bold", fontSize: 13 }}>{lastRSI?.toFixed(1)}</span>
        {lastRSI > 70 && <span style={{ color: "#ff3355", fontSize: 9, border: "1px solid #ff335560", padding: "1px 5px", borderRadius: 3 }}>OVERBOUGHT</span>}
        {lastRSI < 30 && <span style={{ color: "#00ff9d", fontSize: 9, border: "1px solid #00ff9d60", padding: "1px 5px", borderRadius: 3 }}>OVERSOLD</span>}
        {divergences?.filter(d => d.type.startsWith("bull")).map((d, i) => (
          <span key={i} style={{ fontSize: 8, color: d.color, border: `1px solid ${d.color}50`, padding: "1px 5px", borderRadius: 2 }}>{d.label}</span>
        ))}
        {divergences?.filter(d => d.type.startsWith("bear")).map((d, i) => (
          <span key={i} style={{ fontSize: 8, color: d.color, border: `1px solid ${d.color}50`, padding: "1px 5px", borderRadius: 2 }}>{d.label}</span>
        ))}
      </div>
      <div ref={wrapRef} style={{ position: "relative" }}>
        <ResponsiveContainer width="100%" height={80}>
          <ComposedChart data={vis} margin={{ top: 2, right: 12, bottom: 2, left: 52 }}>
            <defs><linearGradient id="rsiGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00d4ff" stopOpacity={0.3} /><stop offset="100%" stopColor="#00d4ff" stopOpacity={0} /></linearGradient></defs>
            <YAxis domain={[0, 100]} tick={{ fill: "#e8f0f8", fontSize: 8, fontFamily: "monospace" }} width={28} tickCount={5} />
            <ReferenceLine y={70} stroke="#ff3355" strokeDasharray="3 2" strokeOpacity={0.4} />
            <ReferenceLine y={30} stroke="#00ff9d" strokeDasharray="3 2" strokeOpacity={0.4} />
            <ReferenceLine y={50} stroke="#6a7a9a" strokeDasharray="2 3" />
            <Area type="monotone" dataKey="rsi" stroke="#00d4ff" fill="url(#rsiGrad)" dot={false} strokeWidth={1.5} connectNulls={false} />
            <Tooltip contentStyle={{ background: "#0a0a18", border: "1px solid #6a7a9a", fontSize: 10, fontFamily: "monospace", color: "#00d4ff" }} formatter={v => [v?.toFixed(2), "RSI"]} />
          </ComposedChart>
        </ResponsiveContainer>
        {/* SVG overlay for divergence lines on RSI */}
        {wW > 0 && divergences?.length > 0 && (
          <svg style={{ position: "absolute", top: 0, left: 0, width: wW, height: 80, pointerEvents: "none" }}>
            {divergences.map((d, di) => {
              const x1 = rsiX(d.idx1), x2 = rsiX(d.idx2);
              if (x1 < RSI_ML.left || x2 > wW - RSI_ML.right || d.rsi1 == null || d.rsi2 == null) return null;
              const y1 = rsiY(d.rsi1), y2 = rsiY(d.rsi2);
              return (
                <g key={di}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={d.color} strokeWidth={1.6} strokeDasharray="4,2" opacity={0.9} />
                  <circle cx={x1} cy={y1} r={3} fill="none" stroke={d.color} strokeWidth={1.5} opacity={0.85} />
                  <circle cx={x2} cy={y2} r={3} fill={d.color} opacity={0.9} />
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

function MACDChart({ chartData, divergences, totalCandles }) {
  const vis = chartData.slice(-90);
  const last = vis.filter(d => d.macd !== null).slice(-1)[0];
  const bullish = last?.macd > last?.macdSig;
  // MACD divergence uses macdHist values – build y mapping
  const wrapRef = useRef(null);
  const [wW, setWW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(e => setWW(e[0].contentRect.width));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const visLen = Math.min(totalCandles || 90, 90);
  const offset = (totalCandles || 90) - visLen;
  const macdVals = vis.map(d => d.macdHist).filter(v => v != null);
  const mMax = Math.max(...macdVals.map(Math.abs), 0.0001);
  const ML = { left: 52, right: 12, top: 2, bottom: 2, h: 76 };
  const mX = (absIdx) => ML.left + (absIdx - offset + 0.5) / visLen * (wW - ML.left - ML.right);
  // For MACD we use macdHist, not RSI – so divergence overlay uses rsi1/rsi2 fields as RSI proxy
  // (won't show MACD line divergence unless we detect it separately; for now just show badges)
  return (
    <div style={{ background: "#04040c", borderRadius: 4, padding: "6px 0 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px 4px", fontFamily: "monospace", fontSize: 11, flexWrap: "wrap" }}>
        <span style={{ color: "#e8f0f8" }}>MACD(12,26,9)</span>
        {last && <span style={{ color: bullish ? "#00ff9d" : "#ff3355", fontWeight: "bold" }}>{bullish ? "▲ BULL" : "▼ BEAR"}</span>}
        {divergences?.map((d, i) => <span key={i} style={{ fontSize: 8, color: d.color, border: `1px solid ${d.color}50`, padding: "1px 5px", borderRadius: 2 }}>{d.label}</span>)}
      </div>
      <div ref={wrapRef} style={{ position: "relative" }}>
      <ResponsiveContainer width="100%" height={80}>
        <ComposedChart data={vis} margin={{ top: 2, right: 12, bottom: 2, left: 52 }}>
          <YAxis tick={{ fill: "#e8f0f8", fontSize: 8, fontFamily: "monospace" }} width={28} />
          <ReferenceLine y={0} stroke="#6a7a9a" />
          <Bar dataKey="macdHist" radius={[1, 1, 0, 0]}>{vis.map((d, i) => <Cell key={i} fill={d.macdHist >= 0 ? "#00ff9d" : "#ff3355"} opacity={0.65} />)}</Bar>
          <Line type="monotone" dataKey="macd" stroke="#00d4ff" dot={false} strokeWidth={1.5} connectNulls={false} />
          <Line type="monotone" dataKey="macdSig" stroke="#ff8c00" dot={false} strokeWidth={1} strokeDasharray="3 2" connectNulls={false} />
          <Tooltip contentStyle={{ background: "#0a0a18", border: "1px solid #6a7a9a", fontSize: 10, fontFamily: "monospace", color: "#e8f0f8" }} formatter={v => [v?.toFixed(5)]} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}


// ================================================================
// RISK CALCULATOR
// ================================================================
function RiskCalculator({ setup, lastPrice }) {
  const [acct, setAcct] = useState(() => { try { return localStorage.getItem("nx_acct") || "10000"; } catch { return "10000"; } });
  const [riskPct, setRiskPct] = useState(() => { try { return localStorage.getItem("nx_rpct") || "1"; } catch { return "1"; } });

  const save = (a, r) => { try { localStorage.setItem("nx_acct", a); localStorage.setItem("nx_rpct", r); } catch {} };

  const entry   = parseFloat(setup?.entry)    || lastPrice;
  const sl      = parseFloat(setup?.stopLoss) || null;
  const tp1     = parseFloat(setup?.tp1)      || null;
  const tp2     = parseFloat(setup?.tp2)      || null;
  const acctNum = parseFloat(acct) || 0;
  const rPct    = parseFloat(riskPct) || 1;

  const dollarRisk = acctNum * rPct / 100;
  const slDist  = sl && entry ? Math.abs(entry - sl) : null;
  const posSize = slDist ? (dollarRisk / slDist) : null;
  const posVal  = posSize && entry ? posSize * entry : null;
  const rr      = slDist && tp1 ? (Math.abs(tp1 - entry) / slDist).toFixed(2) : null;

  return (
    <div style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 6 }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #1f2535", fontSize: 10, color: "#e8f0f8", letterSpacing: 2 }}>🧮 RISK CALCULATOR</div>
      <div style={{ padding: 10 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>ACCOUNT $</div>
            <input value={acct} onChange={e => { setAcct(e.target.value); save(e.target.value, riskPct); }}
              style={{ width: "100%", background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "4px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10, boxSizing: "border-box" }} />
          </div>
          <div style={{ width: 64 }}>
            <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>RISK %</div>
            <input value={riskPct} onChange={e => { setRiskPct(e.target.value); save(acct, e.target.value); }}
              style={{ width: "100%", background: "#04040c", border: "1px solid #6a7a9a", color: "#ffcc00", padding: "4px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10, boxSizing: "border-box" }} />
          </div>
        </div>
        {[
          ["DOLLAR RISK",  dollarRisk ? `$${dollarRisk.toFixed(2)}` : "—", "#ffcc00"],
          ["SL DISTANCE",  slDist     ? (entry < 10 ? slDist.toFixed(5) : slDist.toFixed(2)) : "—", "#ff3355"],
          ["POSITION SIZE",posSize    ? posSize.toFixed(entry > 100 ? 2 : 4) + " units" : "—", "#00ff9d"],
          ["POSITION VALUE",posVal    ? `$${posVal.toFixed(2)}` : "—", "#e8f0f8"],
          ["ACTUAL R:R",   rr         ? `1 : ${rr}` : "—", "#00d4ff"],
        ].map(([k, v, c]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #0a0a1a" }}>
            <span style={{ color: "#e8f0f8", fontSize: 8, letterSpacing: 1 }}>{k}</span>
            <span style={{ color: c, fontWeight: "bold", fontSize: 10 }}>{v}</span>
          </div>
        ))}
        {!sl && <div style={{ marginTop: 6, fontSize: 8, color: "#e8f0f8", lineHeight: 1.5 }}>Run AI analysis to auto-fill entry & SL</div>}
      </div>
    </div>
  );
}

// ================================================================
// AI CHAT
// ================================================================
function AIChatPanel({ ticker, tf, analysis, candles, groqKey, groqModel }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs]);

  const buildContext = () => {
    if (!analysis || !candles.length) return `Asset: ${ticker}`;
    const last = candles[candles.length - 1];
    const rsi  = analysis.rsiarr.filter(v => v).slice(-1)[0];
    const mh   = analysis.macdarr.hist.filter(v => v).slice(-1)[0];
    const pats = analysis.patterns.slice(-4).map(p => p.name).join(", ");
    const sr   = analysis.srLvls.map(l => `${l.t}@${l.p < 10 ? l.p.toFixed(4) : l.p.toFixed(2)}`).join(", ");
    const divs = analysis.divergences.length ? analysis.divergences.map(d => d.label).join(", ") : "none";
    const fib  = analysis.fib ? `${analysis.fib.uptrend ? "UP" : "DOWN"} fib 61.8%=${analysis.fib.levels.find(l => l.ratio === 0.618)?.price?.toFixed(2)}` : "";
    return `${ticker} | ${tf} | Price ${last.close?.toFixed(4)} | RSI ${rsi?.toFixed(1)} | MACD hist ${mh?.toFixed(5)} | Patterns: ${pats || "none"} | S/R: ${sr} | Divergences: ${divs} | ${fib}`;
  };

  const send = async () => {
    if (!input.trim() || !groqKey) return;
    const userMsg = { role: "user", content: input.trim() };
    const newMsgs = [...msgs, userMsg];
    setMsgs(newMsgs); setInput(""); setLoading(true);
    try {
      const systemMsg = {
        role: "system",
        content: `You are NEXUS, a concise expert trading assistant. Current chart context: ${buildContext()}. Give focused, actionable answers in 2-4 sentences. No markdown. No disclaimers.`
      };
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
        body: JSON.stringify({ model: groqModel || "llama-3.3-70b-versatile", messages: [systemMsg, ...newMsgs.slice(-8)], temperature: 0.4, max_tokens: 300 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const reply = data.choices?.[0]?.message?.content || "No response.";
      setMsgs(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (e) { setMsgs(prev => [...prev, { role: "assistant", content: `Error: ${e.message}` }]); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 6, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #1f2535", fontSize: 10, color: "#e8f0f8", letterSpacing: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>💬 AI CHAT</span>
        {msgs.length > 0 && <button onClick={() => setMsgs([])} style={{ background: "none", border: "none", color: "#e8f0f8", cursor: "pointer", fontSize: 9 }}>CLEAR</button>}
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", maxHeight: 220, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {msgs.length === 0 && (
          <div style={{ color: "#6a7a9a", fontSize: 9, lineHeight: 1.8 }}>
            {["Ask about the current chart...", "→ 'What invalidates this setup?'", "→ 'Where is the next target if price breaks R?'", "→ 'How does volume confirm this signal?'"].map(t => <div key={t}>{t}</div>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "88%", padding: "6px 10px", borderRadius: 6, fontSize: 9, lineHeight: 1.6,
              background: m.role === "user" ? "#0f2040" : "#06060f",
              border: `1px solid ${m.role === "user" ? "#00d4ff30" : "#1f2535"}`,
              color: m.role === "user" ? "#00d4ff" : "#e8f0f8",
            }}>{m.content}</div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", gap: 4, alignItems: "center", color: "#e8f0f8" }}>
            <div style={{ fontSize: 14, animation: "spin 1s linear infinite" }}>◈</div>
            <span style={{ fontSize: 9 }}>Thinking...</span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, padding: 8, borderTop: "1px solid #1f2535" }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder={groqKey ? "Ask about this chart..." : "Add Groq key in ⚙ Settings"}
          disabled={!groqKey || loading}
          style={{ flex: 1, background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 9 }} />
        <button onClick={send} disabled={!input.trim() || !groqKey || loading}
          style={{ background: "#00d4ff15", border: "1px solid #00d4ff40", color: "#00d4ff", padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>
          SEND
        </button>
      </div>
    </div>
  );
}

// ================================================================
// AI MEMORY ENGINE — Learns from journal trades
// ================================================================
// ================================================================
// AI INTELLIGENCE ENGINE v3 — QUANTUM CONFLUENCE LEARNING
// Tracks every signal dimension: candles, SMC, S/R, fib, divergence,
// volume, indicators, trend — builds a self-evolving strategy database
// ================================================================

const AI_MEMORY_KEY = "nx_ai_memory";
const AI_PROMPT_KEY = "nx_evolved_prompt";
const AI_CALIB_KEY  = "nx_calibration";
const AI_STRAT_KEY  = "nx_strategies";   // discovered winning strategy patterns

const loadAIMemory      = () => { try { return JSON.parse(localStorage.getItem(AI_MEMORY_KEY) || "{}"); } catch { return {}; } };
const saveAIMemory      = m  => { try { localStorage.setItem(AI_MEMORY_KEY, JSON.stringify(m)); } catch {} };
const loadEvolvedPrompt = (key) => { try { const k = key ? AI_PROMPT_KEY+"_"+key : AI_PROMPT_KEY; return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const saveEvolvedPrompt = (p, key) => { try { const k = key ? AI_PROMPT_KEY+"_"+key : AI_PROMPT_KEY; localStorage.setItem(k, JSON.stringify(p)); } catch {} };
const loadCalibration   = () => { try { return JSON.parse(localStorage.getItem(AI_CALIB_KEY) || "{}"); } catch { return {}; } };
const saveCalibration   = c  => { try { localStorage.setItem(AI_CALIB_KEY, JSON.stringify(c)); } catch {} };
const loadStrategies    = () => { try { return JSON.parse(localStorage.getItem(AI_STRAT_KEY) || "[]"); } catch { return []; } };
const saveStrategies    = s  => { try { localStorage.setItem(AI_STRAT_KEY, JSON.stringify(s)); } catch {} };

// ================================================================
// FEATURE EXTRACTION — converts raw market data into a rich
// multi-dimensional feature vector the AI can learn from
// ================================================================

// ── Discretizers ────────────────────────────────────────────────
const rsiState  = v  => v == null ? "?" : v < 30 ? "oversold" : v < 40 ? "weak" : v < 60 ? "neutral" : v < 70 ? "strong" : "overbought";
const macdState = h  => h == null ? "?" : h > 0 ? (h > 0 ? "bull" : "weakbull") : "bear";
const atrState  = (atr, price) => { if (!atr || !price) return "?"; const p = atr/price*100; return p < 0.6 ? "squeeze" : p < 1.5 ? "normal" : p < 3 ? "elevated" : "extreme"; };
const confBucket = c => c == null ? "?" : c < 50 ? "0-49" : c < 60 ? "50-59" : c < 70 ? "60-69" : c < 80 ? "70-79" : c < 90 ? "80-89" : "90-100";

const trendState = (sma20, sma50, sma200, price) => {
  if (!price) return "?";
  const above20 = sma20 && price > sma20;
  const above50 = sma50 && price > sma50;
  const above200 = sma200 && price > sma200;
  const cnt = [above20, above50, above200].filter(Boolean).length;
  if (cnt === 3) return "strong_up";
  if (cnt === 2) return "up";
  if (cnt === 1) return "weak_up";
  if (cnt === 0 && above200 === false && above50 === false && above20 === false) return "strong_down";
  if (cnt === 0) return "down";
  return "ranging";
};

const volumeState = (candles, idx) => {
  if (!candles || idx < 10) return "?";
  const curr = candles[idx]?.volume || 0;
  const avg20 = candles.slice(Math.max(0, idx-20), idx).reduce((a,c) => a + (c.volume||0), 0) / 20 || 1;
  return curr > avg20 * 1.8 ? "spike" : curr > avg20 * 1.2 ? "above" : curr < avg20 * 0.6 ? "dry" : "normal";
};

// ── Candle pattern classification ───────────────────────────────
const classifyPatterns = (patternStr) => {
  if (!patternStr) return { bullish: [], bearish: [], neutral: [], count: 0, strongBull: false, strongBear: false };
  const pats = patternStr.split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
  const bullKw  = ["bull","hammer","morning","soldier","engulf","harami","kicker","belt","dragonfly","inverted","piercing","bottom","tweezer bottom","matching low","3 inside up","3 outside up"];
  const bearKw  = ["bear","shooting","evening","crow","cloud","hanging","gravestone","tweezer top","matching high","3 inside down","3 outside down","upside gap","deliberation","advance block"];
  const strongB = ["bull engulfing","morning star","3 white","kicker","abandoned baby","3 outside up"];
  const strongBr= ["bear engulfing","evening star","3 black","kicker","abandoned baby bear","3 outside down"];
  const bullish = pats.filter(p => bullKw.some(k => p.includes(k)));
  const bearish = pats.filter(p => bearKw.some(k => p.includes(k)));
  const neutral = pats.filter(p => !bullKw.some(k => p.includes(k)) && !bearKw.some(k => p.includes(k)));
  return {
    bullish, bearish, neutral,
    count:      pats.length,
    strongBull: pats.some(p => strongB.some(k => p.includes(k))),
    strongBear: pats.some(p => strongBr.some(k => p.includes(k))),
  };
};

// ── SMC signal classification ───────────────────────────────────
const classifySMC = (smcStr) => {
  if (!smcStr) return { hasFVG: false, hasOB: false, hasBOS: false, hasLiq: false, bullSMC: 0, bearSMC: 0 };
  const s = smcStr.toLowerCase();
  return {
    hasFVG:  s.includes("fvg"),
    hasOB:   s.includes("order block"),
    hasBOS:  s.includes("bos"),
    hasLiq:  s.includes("trap") || s.includes("grab"),
    bullSMC: (s.match(/bull|bos bullish|liq_bull/g) || []).length,
    bearSMC: (s.match(/bear|bos bearish|liq_bear/g) || []).length,
  };
};

// ── Fib proximity state ──────────────────────────────────────────
const fibProximityState = (nearFib, fibLevel) => {
  if (!nearFib) return "none";
  if (!fibLevel) return "near";
  if (Math.abs(fibLevel - 0.618) < 0.01) return "golden";     // 61.8% — strongest
  if (Math.abs(fibLevel - 0.786) < 0.01) return "deep";       // 78.6%
  if (Math.abs(fibLevel - 0.382) < 0.01) return "half";       // 38.2%
  return "near";
};

// ── S/R quality state ────────────────────────────────────────────
const srQuality = (atSR, srStrength) => {
  if (!atSR) return "none";
  if (srStrength >= 4) return "major";
  if (srStrength >= 2) return "confirmed";
  return "weak";
};

// ── VPOC proximity ──────────────────────────────────────────────
const vpocState = (price, vp) => {
  if (!vp || !price) return "none";
  if (Math.abs(price - vp.vpoc.price) / price < 0.005) return "at_vpoc";
  if (Math.abs(price - vp.vah)        / price < 0.008) return "at_vah";
  if (Math.abs(price - vp.val)        / price < 0.008) return "at_val";
  if (Math.abs(price - vp.vpoc.price) / price < 0.015) return "near_vpoc";
  return "none";
};

// ── Confluence score: weighted sum of all confirmations ──────────
const calcConfluenceScore = (fv) => {
  let score = 0;
  // Candle patterns (max 25)
  if (fv.strongBullCandle || fv.strongBearCandle) score += 15;
  else if ((fv.bullCandleCount || 0) > 0 || (fv.bearCandleCount || 0) > 0) score += 8;
  if ((fv.candleCount || 0) >= 2) score += 10;
  // SMC signals (max 25)
  if (fv.hasOB)  score += 10;
  if (fv.hasFVG) score += 7;
  if (fv.hasBOS) score += 8;
  if (fv.hasLiq) score += 5;
  // Divergence (max 15)
  if (fv.hasDivergence) score += 15;
  // Fibonacci (max 15)
  if (fv.fibState === "golden") score += 15;
  else if (fv.fibState === "deep") score += 10;
  else if (fv.fibState === "half") score += 7;
  else if (fv.fibState === "near") score += 4;
  // S/R (max 10)
  if (fv.srState === "major") score += 10;
  else if (fv.srState === "confirmed") score += 5;
  // Volume (max 10)
  if (fv.volumeState === "spike") score += 10;
  else if (fv.volumeState === "above") score += 5;
  // Indicator alignment (max 15)
  const bullInd = [fv.rsiState === "oversold" || fv.rsiState === "weak", fv.macdState === "bull", fv.trend === "up" || fv.trend === "strong_up"].filter(Boolean).length;
  const bearInd = [fv.rsiState === "overbought" || fv.rsiState === "strong", fv.macdState === "bear", fv.trend === "down" || fv.trend === "strong_down"].filter(Boolean).length;
  const aligned = fv.bias === "BULLISH" ? bullInd : bearInd;
  score += aligned * 5;
  // VPOC proximity (max 12)
  if (fv.vpocState === "at_vpoc")   score += 12;
  else if (fv.vpocState === "near_vpoc") score += 6;
  else if (fv.vpocState === "at_vah" || fv.vpocState === "at_val") score += 8;
  // Regime alignment (bonus or penalty)
  if (fv.regime === "trending") {
    if ((fv.bias==="BULLISH"&&fv.regimeSub==="uptrend")||(fv.bias==="BEARISH"&&fv.regimeSub==="downtrend")) score += 10;
    else score -= 8;
  }
  if (fv.regime === "volatile")  score -= 12;
  if (fv.regime === "squeeze")   score -= 5;
  return Math.max(0, Math.min(100, score));
};

// ── Master feature extractor — builds the complete FV ────────────
const buildFeatureVector = (aiPrediction, trade) => {
  const pats  = classifyPatterns(aiPrediction.patterns || "");
  const smc   = classifySMC(aiPrediction.smcSignals || "");
  const fv = {
    // ── Identity
    date:        trade?.date || aiPrediction.date || new Date().toLocaleDateString(),
    bias:        aiPrediction.bias || "NEUTRAL",
    confidence:  aiPrediction.confidence || 50,
    direction:   trade?.dir || aiPrediction.direction || "WAIT",
    // ── Indicator states
    rsiState:    rsiState(aiPrediction.rsiAtSignal),
    rsi:         aiPrediction.rsiAtSignal,
    macdState:   aiPrediction.macdHistAtSignal > 0 ? "bull" : "bear",
    macdHist:    aiPrediction.macdHistAtSignal,
    trend:       aiPrediction.trendAtSignal || "?",
    atrState:    aiPrediction.atrStateAtSignal || "?",
    volumeState: aiPrediction.volumeStateAtSignal || "?",
    // ── Candle pattern features
    candleCount:     pats.count,
    bullCandleCount: pats.bullish.length,
    bearCandleCount: pats.bearish.length,
    strongBullCandle:pats.strongBull,
    strongBearCandle:pats.strongBear,
    topCandlePattern:pats.bullish[0] || pats.bearish[0] || "",
    // ── SMC features
    hasFVG:   smc.hasFVG,
    hasOB:    smc.hasOB,
    hasBOS:   smc.hasBOS,
    hasLiq:   smc.hasLiq,
    bullSMC:  smc.bullSMC,
    bearSMC:  smc.bearSMC,
    // ── Divergence
    hasDivergence:   aiPrediction.hasDivergence || false,
    divType:         aiPrediction.divType || "none",
    // ── Fibonacci
    nearFib:         aiPrediction.nearFib || false,
    fibState:        fibProximityState(aiPrediction.nearFib, aiPrediction.nearFibRatio),
    nearFibRatio:    aiPrediction.nearFibRatio || null,
    // ── S/R
    atSR:            aiPrediction.atSR || false,
    srState:         srQuality(aiPrediction.atSR, aiPrediction.srStrength),
    srStrength:      aiPrediction.srStrength || 0,
    // ── Derived
    confBucket:  confBucket(aiPrediction.confidence),
    // ── Outcome (filled at record time)
    pnl:     trade?.pnl || 0,
    pct:     trade?.pct || trade?.finalPct || 0,
    correct: false,
    // ── Raw strings for deep analysis
    patternsRaw: aiPrediction.patterns || "",
    smcRaw:      aiPrediction.smcSignals || "",
  };
  // VPOC state
  fv.vpocState   = vpocState(aiPrediction.price || 0, aiPrediction.volProfile || null);
  // Regime
  fv.regime      = aiPrediction.regime    || "unknown";
  fv.regimeSub   = aiPrediction.regimeSub || "";
  fv.regimeConf  = aiPrediction.regimeConf|| 0;
  // Derived confluence score
  fv.confluenceScore = calcConfluenceScore(fv);
  // Bucket key: 7-dimensional fingerprint
  fv.bucketKey = [
    fv.rsiState,
    fv.macdState,
    fv.trend,
    fv.candleCount > 0 ? (fv.strongBullCandle || fv.strongBearCandle ? "strong_pat" : "has_pat") : "no_pat",
    fv.hasDivergence ? "div" : "no_div",
    fv.fibState,
    fv.srState,
  ].join("|");
  return fv;
};

// ================================================================
// CONFLUENCE-AWARE SIMILARITY ENGINE
// Weights: confluence > patterns > SMC > divergence > fib > indicators
// ================================================================
const featureSimilarity = (a, b) => {
  let score = 0;

  // Confluence score proximity (highest weight)
  const csDiff = Math.abs((a.confluenceScore||0) - (b.confluenceScore||0));
  score += csDiff < 10 ? 30 : csDiff < 25 ? 18 : csDiff < 40 ? 8 : 0;

  // Candle pattern class match
  if (a.strongBullCandle !== undefined && a.strongBullCandle === b.strongBullCandle) score += 15;
  if (a.strongBearCandle !== undefined && a.strongBearCandle === b.strongBearCandle) score += 15;
  if ((a.bullCandleCount||0) > 0 && (b.bullCandleCount||0) > 0) score += 8;
  if ((a.bearCandleCount||0) > 0 && (b.bearCandleCount||0) > 0) score += 8;

  // SMC alignment
  if (a.hasFVG === b.hasFVG) score += 8;
  if (a.hasOB  === b.hasOB)  score += 10;
  if (a.hasBOS === b.hasBOS) score += 7;
  if (a.hasLiq === b.hasLiq) score += 5;

  // Divergence
  if (a.hasDivergence === b.hasDivergence) score += 10;

  // Fib state
  if (a.fibState && a.fibState === b.fibState) score += (a.fibState === "golden" ? 12 : 7);

  // S/R quality
  if (a.srState && a.srState === b.srState) score += 8;

  // Indicator states
  if (a.rsiState === b.rsiState) score += 8;
  if (a.macdState === b.macdState) score += 6;
  if (a.trend === b.trend) score += 6;
  if (a.volumeState === b.volumeState) score += 4;

  // RSI continuous proximity bonus
  if (a.rsi != null && b.rsi != null) {
    const d = Math.abs(a.rsi - b.rsi);
    score += d < 5 ? 6 : d < 12 ? 3 : 0;
  }

  // Same bias
  if (a.bias === b.bias) score += 5;

  return Math.min(1, score / 175);  // normalize to 0-1
};

const findSimilarSignals = (mem, sym, tf, currentFV, n = 6) => {
  const key   = `${sym}-${tf.split("|")[0]}`;
  const entry = mem[key];
  if (!entry?.signals?.length) return [];
  return [...entry.signals]
    .map(s => ({ ...s, sim: featureSimilarity(currentFV, s) }))
    .sort((a, b) => b.sim - a.sim)
    .filter(s => s.sim > 0.15)
    .slice(0, n);
};

// ================================================================
// OUTCOME RECORDER — stores full FV + updates all learning tables
// ================================================================
const recordAIOutcome = (trade, aiPrediction) => {
  if (!trade || !aiPrediction) return null;
  const mem   = loadAIMemory();
  const calib = loadCalibration();
  const tf    = aiPrediction.tf || trade.tf || "1d";
  const key   = `${trade.sym}-${tf.split("|")[0]}`;
  const entry = mem[key] || { sym: trade.sym, tf: tf.split("|")[0], signals: [], buckets: {}, confluenceBuckets: {} };

  const fv   = buildFeatureVector(aiPrediction, trade);
  const hit  = (fv.bias === "BULLISH" && trade.dir === "LONG"  && trade.pnl > 0) ||
               (fv.bias === "BEARISH" && trade.dir === "SHORT" && trade.pnl > 0);
  fv.correct = hit;
  fv.pnl     = trade.pnl;
  fv.pct     = trade.pct || trade.finalPct || 0;

  entry.signals = [fv, ...(entry.signals || [])].slice(0, 150);

  // Update 7-dim bucket
  const bk = fv.bucketKey;
  if (!entry.buckets[bk]) entry.buckets[bk] = { total: 0, wins: 0, pnlSum: 0, desc: bk };
  entry.buckets[bk].total++;
  if (hit) entry.buckets[bk].wins++;
  entry.buckets[bk].pnlSum = (entry.buckets[bk].pnlSum || 0) + fv.pct;

  // Update confluence-level buckets (0-24, 25-49, 50-74, 75-100)
  const cs  = fv.confluenceScore;
  const cbk = cs < 25 ? "low" : cs < 50 ? "medium" : cs < 75 ? "high" : "elite";
  if (!entry.confluenceBuckets[cbk]) entry.confluenceBuckets[cbk] = { total: 0, wins: 0, pnlSum: 0 };
  entry.confluenceBuckets[cbk].total++;
  if (hit) entry.confluenceBuckets[cbk].wins++;
  entry.confluenceBuckets[cbk].pnlSum = (entry.confluenceBuckets[cbk].pnlSum || 0) + fv.pct;

  // Recompute aggregate stats
  const sigs = entry.signals;
  const wins = sigs.filter(s => s.correct).length;
  const hiCS = sigs.filter(s => (s.confluenceScore || 0) >= 60);
  entry.stats = {
    total:       sigs.length,
    winRate:     sigs.length ? (wins / sigs.length * 100).toFixed(1) : "0",
    bullWinRate: (() => { const b = sigs.filter(s => s.bias === "BULLISH"); return b.length ? (b.filter(s => s.correct).length / b.length * 100).toFixed(1) : "N/A"; })(),
    bearWinRate: (() => { const b = sigs.filter(s => s.bias === "BEARISH"); return b.length ? (b.filter(s => s.correct).length / b.length * 100).toFixed(1) : "N/A"; })(),
    hiCSWinRate: hiCS.length ? (hiCS.filter(s => s.correct).length / hiCS.length * 100).toFixed(1) : "N/A",
    avgCS:       (sigs.reduce((a, s) => a + (s.confluenceScore || 0), 0) / (sigs.length || 1)).toFixed(1),
    avgWin:      (sigs.filter(s => s.pct > 0).reduce((a, s) => a + s.pct, 0) / (sigs.filter(s => s.pct > 0).length || 1)).toFixed(2),
    avgLoss:     (Math.abs(sigs.filter(s => s.pct <= 0).reduce((a, s) => a + s.pct, 0)) / (sigs.filter(s => s.pct <= 0).length || 1)).toFixed(2),
    lastUpdated: new Date().toLocaleDateString(),
  };

  mem[key] = entry;
  saveAIMemory(mem);

  // Global calibration (by confidence bucket)
  const cb = fv.confBucket;
  if (!calib[cb]) calib[cb] = { total: 0, wins: 0 };
  calib[cb].total++;
  if (hit) calib[cb].wins++;
  saveCalibration(calib);

  // Discover winning strategy patterns automatically
  discoverStrategies(entry.signals);

  return { entry, key };
};

// ================================================================
// STRATEGY DISCOVERY ENGINE
// Finds recurring confluence combinations that win consistently
// ================================================================
const discoverStrategies = (signals) => {
  if (signals.length < 8) return;

  const strategies = [];

  // Helper: test a filter function, require min 3 samples
  const testStrat = (label, filterFn, minN = 3) => {
    const matching = signals.filter(filterFn);
    if (matching.length < minN) return;
    const wins = matching.filter(s => s.correct).length;
    const wr   = wins / matching.length;
    const avgPnl = matching.reduce((a, s) => a + (s.pct || 0), 0) / matching.length;
    if (wr >= 0.55 || wr <= 0.35) {
      strategies.push({ label, wr: (wr * 100).toFixed(1), n: matching.length, avgPnl: avgPnl.toFixed(2), edge: wr >= 0.55 ? "WIN" : "LOSS" });
    }
  };

  // Candle + indicator combos
  testStrat("Strong candle + oversold RSI",     s => s.strongBullCandle && s.rsiState === "oversold");
  testStrat("Strong candle + neutral RSI",      s => s.strongBullCandle && s.rsiState === "neutral");
  testStrat("Strong bear candle + overbought",  s => s.strongBearCandle && s.rsiState === "overbought");
  testStrat("Bull MACD + bull candle",          s => s.macdState === "bull" && (s.bullCandleCount||0) > 0);
  testStrat("No candle pattern",                s => (s.candleCount||0) === 0);

  // SMC combos
  testStrat("Order Block present",              s => s.hasOB);
  testStrat("BOS + candle pattern",             s => s.hasBOS && (s.candleCount||0) > 0);
  testStrat("FVG + MACD bull",                  s => s.hasFVG && s.macdState === "bull");
  testStrat("Liquidity grab + reversal",        s => s.hasLiq);
  testStrat("Full SMC stack (OB+FVG+BOS)",      s => s.hasOB && s.hasFVG && s.hasBOS);

  // Divergence combos
  testStrat("Divergence present",               s => s.hasDivergence);
  testStrat("Divergence + Order Block",         s => s.hasDivergence && s.hasOB);
  testStrat("Divergence + Fib golden",          s => s.hasDivergence && s.fibState === "golden");
  testStrat("Divergence + oversold RSI",        s => s.hasDivergence && s.rsiState === "oversold");

  // Fibonacci combos
  testStrat("Near 61.8% fib",                   s => s.fibState === "golden");
  testStrat("Near 78.6% fib",                   s => s.fibState === "deep");
  testStrat("Fib + S/R confirmed",              s => s.nearFib && s.srState !== "none");
  testStrat("Fib 61.8 + candle pattern",        s => s.fibState === "golden" && (s.candleCount||0) > 0);

  // S/R combos
  testStrat("Major S/R level",                  s => s.srState === "major");
  testStrat("Confirmed S/R + candle",           s => s.srState === "confirmed" && (s.candleCount||0) > 0);
  testStrat("Major S/R + divergence",           s => s.srState === "major" && s.hasDivergence);

  // Volume combos
  testStrat("Volume spike on signal",           s => s.volumeState === "spike");
  testStrat("Volume spike + strong candle",     s => s.volumeState === "spike" && (s.strongBullCandle || s.strongBearCandle));
  testStrat("Dry volume (caution)",             s => s.volumeState === "dry");

  // Trend combos
  testStrat("Strong uptrend + any bull signal", s => s.trend === "strong_up" && s.bias === "BULLISH");
  testStrat("Downtrend + bull signal (fade)",   s => (s.trend === "down" || s.trend === "strong_down") && s.bias === "BULLISH");
  testStrat("Ranging market",                   s => s.trend === "ranging");

  // High confluence threshold
  testStrat("Elite confluence (≥75)",           s => (s.confluenceScore||0) >= 75);
  testStrat("High confluence (50-74)",          s => (s.confluenceScore||0) >= 50 && (s.confluenceScore||0) < 75);
  testStrat("Low confluence (<25)",             s => (s.confluenceScore||0) < 25);

  // The Holy Grail combo tests
  testStrat("Divergence + Fib + S/R",           s => s.hasDivergence && s.nearFib && s.srState !== "none", 2);
  testStrat("OB + Fib + candle",                s => s.hasOB && s.nearFib && (s.candleCount||0) > 0, 2);
  testStrat("Full confluence (div+OB+fib+pat)", s => s.hasDivergence && s.hasOB && s.nearFib && (s.candleCount||0) > 0, 2);

  // Sort: winning edges first (by WR), then losing traps (lowest WR)
  strategies.sort((a, b) => {
    if (a.edge === "WIN" && b.edge !== "WIN") return -1;
    if (a.edge !== "WIN" && b.edge === "WIN") return 1;
    if (a.edge === "WIN") return parseFloat(b.wr) - parseFloat(a.wr);
    return parseFloat(a.wr) - parseFloat(b.wr);
  });

  saveStrategies(strategies.slice(0, 40));
};

// ================================================================
// FAILURE MODE DETECTION — comprehensive
// ================================================================
const detectFailureModes = (signals) => {
  const modes = [];
  if (signals.length < 5) return modes;

  const test = (label, filter, threshold = 0.42, minN = 3, sev = "high") => {
    const g = signals.filter(filter);
    if (g.length < minN) return;
    const wr = g.filter(s => s.correct).length / g.length;
    if (wr <= threshold) modes.push({ mode: label, wr: (wr*100).toFixed(0), n: g.length, severity: sev });
  };

  // Classic traps
  test("Bullish signal in strong downtrend",  s => s.bias === "BULLISH" && (s.trend === "down" || s.trend === "strong_down"));
  test("Bearish signal in strong uptrend",    s => s.bias === "BEARISH" && (s.trend === "up"   || s.trend === "strong_up"));
  test("Overbought RSI + BULLISH",            s => s.rsiState === "overbought" && s.bias === "BULLISH");
  test("Oversold RSI + BEARISH",              s => s.rsiState === "oversold"   && s.bias === "BEARISH");
  // No confluence failures
  test("No candle pattern present",           s => (s.candleCount||0) === 0 && s.direction !== "WAIT", 0.48, 4, "medium");
  test("No SMC signal + no divergence",       s => !s.hasOB && !s.hasFVG && !s.hasBOS && !s.hasDivergence, 0.45, 4, "medium");
  test("Low confluence (<25)",                s => (s.confluenceScore||0) < 25 && s.direction !== "WAIT", 0.45, 4, "medium");
  // Volume failures
  test("Dry volume entry",                    s => s.volumeState === "dry", 0.45, 3, "medium");
  // Extreme ATR
  test("Extreme volatility trades",           s => s.atrState === "extreme", 0.45, 3, "medium");
  // Against major S/R
  test("Trading against major S/R",           s => s.srState === "major" && (
    (s.bias === "BULLISH" && s.srState === "major" && s.bearCandleCount > 0) ||
    (s.bias === "BEARISH" && s.srState === "major" && s.bullCandleCount > 0)), 0.4, 2, "high");

  return modes.slice(0, 8);
};

// ================================================================
// RICH MEMORY CONTEXT BUILDER
// Everything the AI should know before making the next call
// ================================================================
const buildMemoryContext = (sym, tf, currentFV) => {
  const mem     = loadAIMemory();
  const calib   = loadCalibration();
  const evolved = loadEvolvedPrompt();
  const strats  = loadStrategies();
  const key     = `${sym}-${tf?.split("|")[0] || "1d"}`;
  const entry   = mem[key];
  const lines   = [];

  // ── Evolved rules (highest priority) ──
  if (evolved?.rules) {
    lines.push(`SELF-EVOLVED RULES: ${evolved.rules}`);
  }

  // ── Discovered winning strategies ──
  const winStrats = strats.filter(s => s.edge === "WIN" && parseFloat(s.wr) >= 60).slice(0, 4);
  const lossTraps = strats.filter(s => s.edge === "LOSS" && parseFloat(s.wr) <= 38).slice(0, 3);
  if (winStrats.length) {
    lines.push(`DISCOVERED WINNING PATTERNS: ${winStrats.map(s => `"${s.label}" ${s.wr}% WR (${s.n} trades, avg +${s.avgPnl}%)`).join("; ")}`);
  }
  if (lossTraps.length) {
    lines.push(`DISCOVERED LOSING TRAPS: ${lossTraps.map(s => `"${s.label}" only ${s.wr}% WR — AVOID`).join("; ")}`);
  }

  if (!entry?.stats || entry.stats.total < 3) {
    return lines.length ? lines.join("\n") : "";
  }

  const s = entry.stats;

  // ── Calibration warning ──
  const totalCalib = Object.values(calib).reduce((a, b) => a + b.total, 0);
  if (totalCalib >= 8) {
    const warns = [];
    Object.entries(calib).forEach(([bucket, d]) => {
      if (d.total >= 3) {
        const actual = (d.wins / d.total * 100);
        const mid    = parseInt(bucket.split("-")[0]) + 5;
        if (mid - actual > 15) warns.push(`at ${bucket}% stated → only ${actual.toFixed(0)}% actual`);
      }
    });
    if (warns.length) lines.push(`CALIBRATION: You are overconfident (${warns.join("; ")}). Adjust confidence downward.`);
  }

  // ── Confluence bucket for current conditions ──
  if (currentFV) {
    const cs  = currentFV.confluenceScore || 0;
    const cbk = cs < 25 ? "low" : cs < 50 ? "medium" : cs < 75 ? "high" : "elite";
    const cbd = entry.confluenceBuckets?.[cbk];
    if (cbd && cbd.total >= 2) {
      const wr = (cbd.wins / cbd.total * 100).toFixed(0);
      lines.push(`CURRENT CONFLUENCE LEVEL: "${cbk}" (score ${cs}/100) → historical WR ${wr}% (${cbd.total} signals, avg ${(cbd.pnlSum/cbd.total).toFixed(2)}%)`);
    }
    // Exact 7-dim bucket match
    const bkMatch = entry.buckets?.[currentFV.bucketKey];
    if (bkMatch && bkMatch.total >= 2) {
      const bwr = (bkMatch.wins / bkMatch.total * 100).toFixed(0);
      lines.push(`EXACT CONDITION MATCH [${currentFV.bucketKey}]: ${bwr}% WR over ${bkMatch.total} identical setups`);
    }
  }

  // ── Failure modes ──
  const failures = detectFailureModes(entry.signals || []);
  if (failures.length) {
    lines.push(`FAILURE MODES TO AVOID: ${failures.map(f => `"${f.mode}" (${f.wr}% WR, ${f.n} samples)`).join("; ")}`);
  }

  // ── Aggregate track record ──
  lines.push(`TRACK RECORD (${sym} ${tf?.split("|")[0]}): ${s.total} signals, ${s.winRate}% WR. Bull: ${s.bullWinRate}%, Bear: ${s.bearWinRate}%, High-confluence: ${s.hiCSWinRate}%. Avg win: +${s.avgWin}%, avg loss: -${s.avgLoss}%. Avg confluence: ${s.avgCS}/100.`);

  // ── Similar past situations ──
  if (currentFV && entry.signals?.length >= 3) {
    const similar = findSimilarSignals(mem, sym, tf, currentFV, 5);
    if (similar.length) {
      const simStr = similar.map(s =>
        `[${s.date}] ${s.bias}(${s.confidence}%, CS:${s.confluenceScore}) ${s.patternsRaw ? s.patternsRaw.split(",")[0] : ""} → ${s.correct ? "WIN" : "LOSS"} ${s.pct >= 0 ? "+" : ""}${s.pct?.toFixed(2)}% (similarity ${(s.sim*100).toFixed(0)}%)`
      ).join("; ");
      lines.push(`MOST SIMILAR PAST SETUPS: ${simStr}`);
    }
  }

  return lines.join("\n");
};

// ================================================================
// PROMPT EVOLUTION ENGINE
// AI reads its own wins/losses with full context and writes new rules
// ================================================================
const evolvePrompt = async (key, entry, groqKey) => {
  if (!groqKey || !entry?.signals?.length) return null;
  const sigs     = entry.signals.slice(0, 60);
  const wins     = sigs.filter(s => s.correct);
  const losses   = sigs.filter(s => !s.correct);
  const failures = detectFailureModes(sigs);
  const strats   = loadStrategies();

  const fmtSig = s => [
    s.bias + "(" + s.confidence + "%)",
    "CS:" + (s.confluenceScore||"?"),
    s.rsiState, s.macdState, s.trend,
    s.strongBullCandle ? "StrongBullCandle" : s.strongBearCandle ? "StrongBearCandle" : (s.candleCount||0) + "pats",
    s.hasOB ? "OB" : "", s.hasFVG ? "FVG" : "", s.hasBOS ? "BOS" : "",
    s.hasDivergence ? "DIV" : "",
    s.fibState !== "none" ? "Fib" + s.fibState : "",
    s.srState !== "none" ? "SR" + s.srState : "",
    "vol:" + s.volumeState,
    "→", s.correct ? "WIN" : "LOSS", s.pct >= 0 ? "+" : "", s.pct?.toFixed(2) + "%",
  ].filter(Boolean).join(" ");

  const prompt = `You are a quantitative trading meta-analyst reviewing an AI trading system's complete performance history on ${key}.

WINNING SIGNALS (${wins.length}):
${wins.slice(0, 20).map(fmtSig).join("\n")}

LOSING SIGNALS (${losses.length}):
${losses.slice(0, 20).map(fmtSig).join("\n")}

Discovered patterns: ${strats.slice(0, 8).map(s => s.label + "=" + s.wr + "%WR").join(", ")}
Known failure modes: ${failures.map(f => f.mode + "=" + f.wr + "%WR").join(", ") || "none yet"}

Legend: CS=confluence score(0-100), OB=OrderBlock, FVG=FairValueGap, BOS=BreakOfStructure, DIV=Divergence, Fib=FibonacciLevel, SR=SupportResistance, vol=volume

Analyze WHICH SPECIFIC COMBINATIONS of candle patterns, SMC signals, divergence, fibonacci, support/resistance, and indicator states produce winning signals vs losing ones.

Write 4-6 EVOLVED RULES as specific IF-THEN statements this AI must follow.
Examples of good rules: "Rule: When confluence score ≥65 AND divergence present AND price at fib 61.8%, signal is high-conviction — raise confidence."
Be concrete. Reference specific combinations. Max 180 words. Plain text, no markdown.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.25, max_tokens: 280 })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const rules = data.choices?.[0]?.message?.content || "";
    saveEvolvedPrompt({ rules, key, evolvedAt: new Date().toLocaleDateString(), signalCount: sigs.length, version: (loadEvolvedPrompt(key)?.version || 0) + 1 }, key);
    return rules;
  } catch { return null; }
};

// ================================================================
// AI INTELLIGENCE PANEL — 7 tabs, full confluence analytics
// ================================================================
function AIMemoryPanel({ groqKey, currentTicker, currentTF, currentFV }) {
  const [mem,      setMem]      = useState(loadAIMemory);
  const [calib,    setCalib]    = useState(loadCalibration);
  const [evolved,  setEvolved]  = useState(loadEvolvedPrompt);
  const [strats,   setStrats]   = useState(loadStrategies);
  const [selected, setSelected] = useState("");
  const [tab,      setTab]      = useState("overview");
  const [evolving, setEvolving] = useState(false);
  const [analyzing,setAnalyzing]= useState(false);
  const [insight,  setInsight]  = useState("");

  const refresh = () => {
    setMem(loadAIMemory()); setCalib(loadCalibration());
    setEvolved(loadEvolvedPrompt()); setStrats(loadStrategies());
  };

  useEffect(() => { setEvolved(loadEvolvedPrompt(selected || undefined)); }, [selected]);
  const keys  = Object.keys(mem).sort();
  const entry = selected ? mem[selected] : null;
  const stats = entry?.stats;
  const sigs  = entry?.signals || [];
  const biasC = { BULLISH: "#00ff9d", BEARISH: "#ff3355", NEUTRAL: "#ffcc00" };

  // Auto-select current ticker
  const [autoSelected, setAutoSelected] = useState(false);
  useEffect(() => {
    if (!autoSelected && currentTicker && currentTF) {
      const k = `${currentTicker}-${currentTF.split("|")[0]}`;
      if (mem[k]) { setSelected(k); setAutoSelected(true); }
    }
  }, [currentTicker, currentTF, mem]);

  const doEvolve = async () => {
    if (!groqKey || !entry || sigs.length < 5) return;
    setEvolving(true);
    await evolvePrompt(selected, entry, groqKey);
    setEvolved(loadEvolvedPrompt());
    setEvolving(false);
  };

  const doDeepAnalysis = async () => {
    if (!groqKey || !entry) return;
    setAnalyzing(true); setInsight("");
    const failures = detectFailureModes(sigs);
    const strats   = loadStrategies();
    const prompt   = `In 5 sentences, analyze this trading AI's performance on ${selected}: Win rate ${stats?.winRate}%, ${stats?.total} signals. Avg confluence: ${stats?.avgCS}/100. High-confluence WR: ${stats?.hiCSWinRate}%. Top winning pattern: ${strats.filter(s => s.edge === "WIN")[0]?.label || "none yet"}. Main failure: ${failures[0]?.mode || "none detected"}. What single change would most improve performance?`;
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.4, max_tokens: 220 })
      });
      const data = await res.json();
      setInsight(data.choices?.[0]?.message?.content || "");
    } catch (e) { setInsight("Error: " + e.message); }
    finally { setAnalyzing(false); }
  };

  const clearMem = k => { const n = { ...mem }; delete n[k]; saveAIMemory(n); setMem(n); if (selected === k) setSelected(""); };

  const TABS = [
    { id: "overview",    label: "Signals" },
    { id: "confluence",  label: "Confluence" },
    { id: "strategies",  label: "Strategies" },
    { id: "failures",    label: "Failures" },
    { id: "similar",     label: "Similar" },
    { id: "calibration", label: "Calibration" },
    { id: "prompt",      label: "Evolved Rules" },
  ];

  const failures = detectFailureModes(sigs);
  const currentBucketKey = currentFV?.bucketKey;
  const currentBucketData = entry?.buckets?.[currentBucketKey];
  const currentCS = currentFV?.confluenceScore || 0;
  const currentCSBkt = currentCS < 25 ? "low" : currentCS < 50 ? "medium" : currentCS < 75 ? "high" : "elite";
  const currentCSData = entry?.confluenceBuckets?.[currentCSBkt];

  return (
    <div style={{ padding: 10, display: "grid", gridTemplateColumns: "190px 1fr", gap: 10, minHeight: 380 }}>
      {/* ── LEFT: asset list ── */}
      <div>
        <div style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 2, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
          <span>TRACKED ({keys.length})</span>
          <button onClick={refresh} style={{ background: "none", border: "none", color: "#e8f0f8", cursor: "pointer", fontSize: 11 }}>⟳</button>
        </div>
        {keys.length === 0 && <div style={{ color: "#6a7a9a", fontSize: 9, lineHeight: 1.9 }}>No memory yet.{"\n→ Run Backtest to generate signals\n→ Close trades in Portfolio\n→ Every signal builds the database"}</div>}
        {keys.map(k => {
          const e = mem[k]; const wr = parseFloat(e?.stats?.winRate || 0);
          const cs = parseFloat(e?.stats?.avgCS || 0);
          const col = wr >= 55 ? "#00ff9d" : wr >= 45 ? "#ffcc00" : "#ff3355";
          return (
            <div key={k} onClick={() => setSelected(k)}
              style={{ background: selected === k ? "#0f2040" : "#06060f", border: `1px solid ${selected === k ? "#00d4ff40" : "#1f2535"}`, borderRadius: 5, padding: "7px 10px", marginBottom: 4, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: "bold", color: "#e8f0f8", fontSize: 11 }}>{k}</span>
                <span style={{ color: col, fontSize: 11, fontWeight: "bold" }}>{wr.toFixed(0)}%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                <span style={{ fontSize: 8, color: "#e8f0f8" }}>{e?.stats?.total || 0} sigs · CS {cs.toFixed(0)}/100</span>
              </div>
              <div style={{ width: "100%", height: 3, background: "#1f2535", borderRadius: 2, marginTop: 3 }}>
                <div style={{ width: `${Math.min(100, wr)}%`, height: "100%", background: col, borderRadius: 2 }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── RIGHT ── */}
      {entry && stats ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Stat row */}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
            {[
              ["WIN RATE",  `${stats.winRate}%`,    parseFloat(stats.winRate) >= 50 ? "#00ff9d" : "#ff3355"],
              ["SIGNALS",   stats.total,            "#00d4ff"],
              ["HI-CS WR",  `${stats.hiCSWinRate}%`,"#a855f7"],
              ["AVG CS",    `${stats.avgCS}/100`,   parseFloat(stats.avgCS) >= 50 ? "#00ff9d" : "#ffcc00"],
              ["BULL WR",   `${stats.bullWinRate}%`,"#00ff9d"],
              ["BEAR WR",   `${stats.bearWinRate}%`,"#ff3355"],
              ["AVG WIN",   `+${stats.avgWin}%`,    "#00ff9d"],
              ["AVG LOSS",  `-${stats.avgLoss}%`,   "#ff3355"],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 4, padding: "4px 9px" }}>
                <div style={{ fontSize: 7, color: "#e8f0f8" }}>{l}</div>
                <div style={{ fontSize: 12, fontWeight: "bold", color: c }}>{v}</div>
              </div>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
              <button onClick={doDeepAnalysis} disabled={analyzing || !groqKey}
                style={{ background: "#a855f718", border: "1px solid #a855f740", color: "#a855f7", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 8 }}>
                {analyzing ? "⟳" : "🧠 ANALYZE"}
              </button>
              <button onClick={doEvolve} disabled={evolving || !groqKey || sigs.length < 5}
                style={{ background: "#00ff9d18", border: "1px solid #00ff9d40", color: "#00ff9d", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 8 }}>
                {evolving ? "⟳" : "⚡ EVOLVE"}
              </button>
              <button onClick={() => clearMem(selected)}
                style={{ background: "#ff335518", border: "1px solid #ff335530", color: "#ff335580", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 8 }}>🗑</button>
            </div>
          </div>

          {insight && <div style={{ background: "#0a0a18", border: "1px solid #a855f730", borderRadius: 5, padding: 8, fontSize: 9, color: "#b895f8", lineHeight: 1.6 }}>{insight}</div>}

          {/* Current conditions highlight */}
          {currentFV && (
            <div style={{ background: "#04081a", border: "1px solid #00d4ff20", borderRadius: 5, padding: "6px 10px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1 }}>NOW:</span>
              <span style={{ fontSize: 9, color: "#00d4ff" }}>CS {currentCS}/100 <span style={{ color: currentCS >= 60 ? "#00ff9d" : currentCS >= 35 ? "#ffcc00" : "#ff3355" }}>({currentCSBkt})</span></span>
              {currentCSData && currentCSData.total >= 2 && <span style={{ fontSize: 9, color: "#a855f7" }}>→ {(currentCSData.wins/currentCSData.total*100).toFixed(0)}% WR ({currentCSData.total} similar)</span>}
              {currentBucketData && currentBucketData.total >= 2 && <span style={{ fontSize: 9, color: "#ffcc00" }}>Exact match: {(currentBucketData.wins/currentBucketData.total*100).toFixed(0)}% WR</span>}
            </div>
          )}

          {/* Inner tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1f2535", flexWrap: "wrap" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ background: "transparent", border: "none", borderBottom: tab === t.id ? "2px solid #00d4ff" : "2px solid transparent", color: tab === t.id ? "#00d4ff" : "#e8f0f8", padding: "5px 9px", cursor: "pointer", fontFamily: "monospace", fontSize: 8, letterSpacing: 1 }}>
                {t.label}
                {t.id === "failures" && failures.length > 0 && <span style={{ color: "#ff3355", marginLeft: 2 }}>({failures.length})</span>}
                {t.id === "strategies" && strats.filter(s => s.edge === "WIN").length > 0 && <span style={{ color: "#00ff9d", marginLeft: 2 }}>({strats.filter(s => s.edge === "WIN").length}✓)</span>}
              </button>
            ))}
          </div>

          {/* ── SIGNALS OVERVIEW ── */}
          {tab === "overview" && (
            <div style={{ maxHeight: 250, overflowY: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "58px 70px 42px 50px 38px 38px 38px 38px 38px 38px 48px 1fr", padding: "3px 6px", borderBottom: "1px solid #1f2535", background: "#04040c", position: "sticky", top: 0 }}>
                {["DATE","BIAS","CONF","DIR","CS","RSI","MACD","PAT","SMC","DIV","P&L","RESULT"].map((h,i) => <div key={i} style={{ fontSize: 7, color: "#e8f0f8" }}>{h}</div>)}
              </div>
              {sigs.map((s, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "58px 70px 42px 50px 38px 38px 38px 38px 38px 38px 48px 1fr", padding: "4px 6px", borderBottom: "1px solid #08081a", background: s.correct ? "#001508" : i%2===0 ? "#06060f" : "#04040e", alignItems: "center" }}>
                  <span style={{ fontSize: 7, color: "#5a6a80" }}>{s.date}</span>
                  <span style={{ fontSize: 8, fontWeight: "bold", color: biasC[s.bias]||"#888" }}>{s.bias}</span>
                  <span style={{ fontSize: 8, color: (s.confidence||0)>=70?"#a855f7":"#e8f0f8" }}>{s.confidence}%</span>
                  <span style={{ fontSize: 8, color: s.direction==="LONG"?"#00ff9d":"#ff3355" }}>{s.direction}</span>
                  <span style={{ fontSize: 8, color: (s.confluenceScore||0)>=60?"#00ff9d":(s.confluenceScore||0)>=35?"#ffcc00":"#ff3355", fontWeight:"bold" }}>{s.confluenceScore||0}</span>
                  <span style={{ fontSize: 7, color: "#e8f0f8" }}>{s.rsiState?.slice(0,4)}</span>
                  <span style={{ fontSize: 7, color: s.macdState==="bull"?"#00ff9d":"#ff3355" }}>{s.macdState}</span>
                  <span style={{ fontSize: 8, color: s.strongBullCandle?"#00ff9d":s.strongBearCandle?"#ff3355":"#e8f0f8" }}>{s.strongBullCandle?"★":s.strongBearCandle?"★":(s.candleCount||0)>0?"✓":"—"}</span>
                  <span style={{ fontSize: 8, color: (s.bullSMC||0)+(s.bearSMC||0)>0?"#a855f7":"#e8f0f8" }}>{(s.bullSMC||0)+(s.bearSMC||0)>0?"✓":"—"}</span>
                  <span style={{ fontSize: 8, color: s.hasDivergence?"#ff8c00":"#e8f0f8" }}>{s.hasDivergence?"✓":"—"}</span>
                  <span style={{ fontSize: 8, color: s.pct>=0?"#00ff9d":"#ff3355" }}>{s.pct>=0?"+":""}{s.pct?.toFixed(1)}%</span>
                  <span style={{ fontSize: 10 }}>{s.direction==="WAIT"?"—":s.correct?"✓":"✗"}{s.backtest&&<span style={{fontSize:7,color:"#e8f0f8"}}> BT</span>}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── CONFLUENCE ANALYSIS ── */}
          {tab === "confluence" && (
            <div>
              <div style={{ fontSize: 9, color: "#e8f0f8", marginBottom: 8 }}>Win rate by confluence score level (0-100 based on all confirmations combined)</div>
              {["elite","high","medium","low"].map(lvl => {
                const d = entry.confluenceBuckets?.[lvl];
                if (!d || d.total < 1) return null;
                const wr = d.wins / d.total * 100;
                const avg = (d.pnlSum / d.total).toFixed(2);
                const col = wr >= 60 ? "#00ff9d" : wr >= 45 ? "#ffcc00" : "#ff3355";
                const range = { elite: "75-100", high: "50-74", medium: "25-49", low: "0-24" };
                const isCurrent = currentCSBkt === lvl;
                return (
                  <div key={lvl} style={{ background: isCurrent ? "#0a1a28" : "#06060f", border: `1px solid ${isCurrent ? "#00d4ff30" : "#1f2535"}`, borderRadius: 5, padding: "8px 12px", marginBottom: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 10, fontWeight: "bold", color: col }}>{lvl.toUpperCase()} CONFLUENCE (CS {range[lvl]}) {isCurrent && "← NOW"}</span>
                      <div style={{ display: "flex", gap: 12 }}>
                        <span style={{ fontSize: 10, fontWeight: "bold", color: col }}>{wr.toFixed(0)}% WR</span>
                        <span style={{ fontSize: 9, color: avg>=0?"#00ff9d":"#ff3355" }}>avg {avg>=0?"+":""}{avg}%</span>
                        <span style={{ fontSize: 9, color: "#e8f0f8" }}>{d.total} trades</span>
                      </div>
                    </div>
                    <div style={{ width: "100%", height: 8, background: "#1f2535", borderRadius: 4 }}>
                      <div style={{ width: `${Math.min(100, wr)}%`, height: "100%", background: col, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
              <div style={{ marginTop: 10, fontSize: 9, color: "#e8f0f8", lineHeight: 1.8 }}>
                Confluence score (0-100) rewards: strong candle patterns (+15), order blocks (+10), BOS (+8), divergence (+15), golden fib (+15), major S/R (+10), volume spike (+10), indicator alignment (+5 each).
              </div>
            </div>
          )}

          {/* ── DISCOVERED STRATEGIES ── */}
          {tab === "strategies" && (
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {strats.length === 0 ? (
                <div style={{ color: "#6a7a9a", fontSize: 9, lineHeight: 1.9 }}>No strategies discovered yet. Need ≥8 signals. The engine tests 35+ confluence combinations automatically.</div>
              ) : (
                <>
                  <div style={{ fontSize: 8, color: "#00ff9d80", letterSpacing: 2, marginBottom: 6 }}>▲ WINNING EDGES</div>
                  {strats.filter(s => s.edge === "WIN").map((s, i) => (
                    <div key={i} style={{ background: "#001508", border: "1px solid #00ff9d20", borderRadius: 4, padding: "7px 10px", marginBottom: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 9, color: "#8aba8a", fontWeight: "bold" }}>{s.label}</span>
                        <div style={{ display: "flex", gap: 10 }}>
                          <span style={{ fontSize: 10, color: "#00ff9d", fontWeight: "bold" }}>{s.wr}% WR</span>
                          <span style={{ fontSize: 9, color: "#00ff9d80" }}>+{s.avgPnl}% avg</span>
                          <span style={{ fontSize: 8, color: "#e8f0f8" }}>({s.n} trades)</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {strats.filter(s => s.edge === "LOSS").length > 0 && (
                    <>
                      <div style={{ fontSize: 8, color: "#ff335580", letterSpacing: 2, margin: "10px 0 6px" }}>▼ LOSING TRAPS — AVOID</div>
                      {strats.filter(s => s.edge === "LOSS").map((s, i) => (
                        <div key={i} style={{ background: "#150005", border: "1px solid #ff335520", borderRadius: 4, padding: "7px 10px", marginBottom: 4 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 9, color: "#ba5a65" }}>{s.label}</span>
                            <div style={{ display: "flex", gap: 10 }}>
                              <span style={{ fontSize: 10, color: "#ff3355", fontWeight: "bold" }}>{s.wr}% WR</span>
                              <span style={{ fontSize: 8, color: "#e8f0f8" }}>({s.n} trades)</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── FAILURES ── */}
          {tab === "failures" && (
            <div>
              {failures.length === 0
                ? <div style={{ color: "#6a7a9a", fontSize: 9, padding: 10, lineHeight: 1.8 }}>No failure modes detected yet. Need ≥3 signals in a losing pattern. Keep building the database.</div>
                : failures.map((f, i) => (
                  <div key={i} style={{ background: f.severity==="high"?"#1a040818":"#1a0a0415", border:`1px solid ${f.severity==="high"?"#ff335540":"#ff8c0030"}`, borderRadius: 5, padding: "9px 12px", marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontWeight: "bold", color: f.severity==="high"?"#ff3355":"#ff8c00", fontSize: 11 }}>⚠ {f.mode}</span>
                      <span style={{ fontSize: 10, color: "#ff3355", fontWeight: "bold" }}>{f.wr}% win rate ({f.n} trades)</span>
                    </div>
                    <div style={{ fontSize: 8, color: "#5a4a50" }}>{f.severity==="high"?"HIGH RISK — ":"CAUTION — "}The AI consistently fails in this condition. This warning is injected into every future analysis automatically.</div>
                  </div>
                ))
              }
            </div>
          )}

          {/* ── SIMILAR SIGNALS ── */}
          {tab === "similar" && (
            <div>
              {currentFV ? (
                <>
                  <div style={{ fontSize: 9, color: "#e8f0f8", marginBottom: 6 }}>Most similar past situations to current setup (weighted by confluence, patterns, SMC, divergence, fib, S/R):</div>
                  {findSimilarSignals(mem, selected.split("-")[0], selected.split("-").slice(1).join("-") || "1d", currentFV, 8).map((s, i) => (
                    <div key={i} style={{ background: s.correct?"#00150808":"#15000808", border:`1px solid ${s.correct?"#00ff9d20":"#ff335520"}`, borderRadius: 5, padding: "7px 10px", marginBottom: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 8, color: "#5a6a80" }}>{s.date}</span>
                          <span style={{ fontWeight: "bold", color: biasC[s.bias]||"#888", fontSize: 10 }}>{s.bias}({s.confidence}%)</span>
                          <span style={{ fontSize: 9, color:"#a855f7" }}>CS:{s.confluenceScore}</span>
                          <span style={{ color: s.direction==="LONG"?"#00ff9d":"#ff3355", fontSize: 9 }}>{s.direction}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <span style={{ fontWeight:"bold", color: s.correct?"#00ff9d":"#ff3355", fontSize:10 }}>{s.correct?"✓ WIN":"✗ LOSS"}</span>
                          <span style={{ color: s.pct>=0?"#00ff9d":"#ff3355", fontSize: 9 }}>{s.pct>=0?"+":""}{s.pct?.toFixed(2)}%</span>
                          <span style={{ fontSize: 8, color: s.sim>0.6?"#00d4ff":"#5a6a80" }}>sim:{(s.sim*100).toFixed(0)}%</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 8, color: "#5a6a8a" }}>
                        {[s.strongBullCandle?"StrongBull":s.strongBearCandle?"StrongBear":(s.candleCount||0)>0?s.candleCount+"pats":"nopat", s.hasDivergence?"DIV":"", s.hasOB?"OB":"", s.hasFVG?"FVG":"", s.hasBOS?"BOS":"", s.fibState!=="none"?"Fib:"+s.fibState:"", s.srState!=="none"?"SR:"+s.srState:"", "vol:"+s.volumeState].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  ))}
                  {findSimilarSignals(mem, selected.split("-")[0], selected.split("-").slice(1).join("-") || "1d", currentFV, 8).length === 0 && (
                    <div style={{ color: "#6a7a9a", fontSize: 9 }}>No similar situations found yet. Build the database with backtest or closed trades.</div>
                  )}
                </>
              ) : (
                <div style={{ color: "#6a7a9a", fontSize: 9, padding: 12 }}>Load and fetch a ticker to see similar past setups matched to current conditions.</div>
              )}
            </div>
          )}

          {/* ── CALIBRATION ── */}
          {tab === "calibration" && (
            <div>
              <div style={{ fontSize: 9, color: "#e8f0f8", marginBottom: 10 }}>Does stated confidence match actual win rate? (All assets, global)</div>
              {["0-49","50-59","60-69","70-79","80-89","90-100"].map(bkt => {
                const d = calib[bkt]; if (!d || d.total < 2) return null;
                const actual = d.wins / d.total * 100;
                const stated = parseInt(bkt.split("-")[0]) + 5;
                const diff = actual - stated;
                const col = Math.abs(diff) < 10 ? "#00ff9d" : diff < -15 ? "#ff3355" : "#ffcc00";
                return (
                  <div key={bkt} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 9, color: "#e8f0f8" }}>Stated: {bkt}%</span>
                      <span style={{ fontSize: 10, fontWeight: "bold", color: col }}>Actual: {actual.toFixed(0)}%</span>
                      <span style={{ fontSize: 8, color: diff>=0?"#00ff9d":"#ff3355" }}>{diff>=0?"+":""}{diff.toFixed(0)}pp</span>
                      <span style={{ fontSize: 8, color: "#e8f0f8" }}>{d.total} signals</span>
                    </div>
                    <div style={{ height: 8, background: "#1f2535", borderRadius: 3, position: "relative" }}>
                      <div style={{ position: "absolute", left: 0, top: 0, width: `${Math.min(100,actual)}%`, height: "100%", background: col, borderRadius: 3 }} />
                      <div style={{ position: "absolute", left: `${Math.min(100,stated)}%`, top: -2, width: 2, height: 12, background: "#ffffff60" }} />
                    </div>
                    <div style={{ fontSize: 7, color: "#e8f0f8", marginTop: 1 }}>▐ = stated target</div>
                  </div>
                );
              })}
              {Object.keys(calib).length === 0 && <div style={{ color: "#6a7a9a", fontSize: 9 }}>No calibration data yet. Close trades to build it.</div>}
            </div>
          )}

          {/* ── EVOLVED RULES ── */}
          {tab === "prompt" && (
            <div>
              {evolved ? (
                <div>
                  <div style={{ background: "#0a1a0a", border: "1px solid #00ff9d25", borderRadius: 6, padding: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 8, color: "#00ff9d70", letterSpacing: 2, marginBottom: 5 }}>
                      SELF-EVOLVED RULES v{evolved.version || 1} — auto-injected into every AI analysis
                    </div>
                    <div style={{ fontSize: 9, color: "#8aba8a", lineHeight: 1.7 }}>{evolved.rules}</div>
                    <div style={{ marginTop: 6, fontSize: 8, color: "#e8f0f8" }}>
                      Evolved on {evolved.evolvedAt} · {evolved.signalCount} signals · Asset: {evolved.key}
                    </div>
                  </div>
                  <button onClick={doEvolve} disabled={evolving || !groqKey || sigs.length < 5}
                    style={{ background: "#00ff9d18", border: "1px solid #00ff9d40", color: "#00ff9d", padding: "5px 14px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 9, marginRight: 8 }}>
                    {evolving ? "⟳ EVOLVING..." : "⚡ RE-EVOLVE FROM LATEST DATA"}
                  </button>
                </div>
              ) : (
                <div style={{ color: "#6a7a9a", fontSize: 9, lineHeight: 1.9 }}>
                  {["No evolved rules yet.",`Need ≥5 closed signals (have ${sigs.length}).`,"Click ⚡ EVOLVE above.","The AI analyzes ALL dimensions:","candles, SMC, fib, S/R, divergence,","volume, confluence score — then","writes specific IF-THEN rules","that improve future win rate.","Rules persist and auto-inject."].map(l=><div key={l}>{l}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: "#6a7a9a", fontSize: 9, fontFamily: "monospace", padding: "20px 0", lineHeight: 1.9 }}>
          {["Select an asset to view its","intelligence database:","","→ Full confluence scoring","→ 35+ strategy pattern tests","→ 7-dimensional condition buckets","→ Weighted similarity search","→ Self-evolved IF-THEN rules","→ Confidence calibration curve","","Run Backtest to populate quickly."].map(l=><div key={l}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

// ================================================================
// EXPANSION 1 — WATCHLIST with AI Quick Scan
// ================================================================
function WatchlistPanel({ onLoadTicker, groqKey, currentTicker }) {
  const DEFAULT = ["AAPL", "TSLA", "SPY", "BTC-USD", "EURUSD=X", "NVDA", "MSFT", "ETH-USD"];
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem("nx_wl") || "null") || DEFAULT.map(t => ({ sym: t, price: null, pct: null, loading: false, name: "" })); } catch { return DEFAULT.map(t => ({ sym: t, price: null, pct: null, loading: false, name: "" })); } };
  const [items, setItems] = useState(loadSaved);
  const [newTick, setNewTick] = useState("");
  const [scanResults, setScanResults] = useState({});
  const [scanning, setScanning] = useState(false);

  const persist = (arr) => { setItems(arr); try { localStorage.setItem("nx_wl", JSON.stringify(arr)); } catch {} };

  const refreshOne = useCallback(async (sym, idx) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, loading: true } : it));
    try {
      const q = await fetchQuickQuote(sym);
      setItems(prev => { const n = [...prev]; n[idx] = { ...n[idx], price: q.price, pct: q.pct, name: q.name, loading: false }; persist(n); return n; });
    } catch { setItems(prev => { const n = [...prev]; n[idx] = { ...n[idx], loading: false }; return n; }); }
  }, []);

  const refreshAll = useCallback(() => items.forEach((it, i) => refreshOne(it.sym, i)), [items, refreshOne]);
  useEffect(() => { refreshAll(); const id = setInterval(refreshAll, 30000); return () => clearInterval(id); }, []);

  const addTicker = () => {
    const s = newTick.trim().toUpperCase();
    if (!s || items.find(it => it.sym === s)) return;
    const next = [...items, { sym: s, price: null, pct: null, loading: true, name: "" }];
    persist(next); setNewTick("");
    setTimeout(() => refreshOne(s, next.length - 1), 100);
  };

  const aiScan = async () => {
    if (!groqKey) return;
    setScanning(true);
    const res = {};
    for (const it of items.slice(0, 8)) {
      try {
        const { candles } = await fetchYahoo(it.sym, "1d", "1mo");
        const cls = candles.map(c => c.close);
        const rsi = calcRSI(cls).filter(v => v !== null).slice(-1)[0];
        const mh = calcMACD(cls).hist.filter(v => v !== null).slice(-1)[0];
        const pats = detectCandlePatterns(candles).slice(-3).map(p => p.name).join(", ");
        const prompt = `${it.sym} — Price:${it.price?.toFixed(2)}, Change:${it.pct?.toFixed(2)}%, RSI:${rsi?.toFixed(1)}, MACD hist:${mh?.toFixed(4)}, Patterns:${pats || "none"}. Reply ONLY with JSON: {"signal":"BUY"|"SELL"|"HOLD","score":0-100,"reason":"one sentence"}`;
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: 120 }) });
        const d = await r.json();
        res[it.sym] = JSON.parse((d.choices?.[0]?.message?.content || "{}").replace(/```json|```/g, "").trim());
      } catch { res[it.sym] = { signal: "ERR", score: 0, reason: "Failed" }; }
    }
    setScanResults(res); setScanning(false);
  };

  const sigC = { BUY: "#00ff9d", SELL: "#ff3355", HOLD: "#ffcc00", ERR: "#5a6a8a" };
  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={newTick} onChange={e => setNewTick(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && addTicker()} placeholder="ADD TICKER" style={{ background: "#0a0a1a", border: "1px solid #6a7a9a", color: "#00ff9d", padding: "5px 10px", borderRadius: 4, fontFamily: "monospace", fontSize: 11, width: 120, letterSpacing: 2 }} />
        <button onClick={addTicker} style={{ background: "#00ff9d18", border: "1px solid #00ff9d40", color: "#00ff9d", padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 10 }}>+ ADD</button>
        <button onClick={refreshAll} style={{ background: "#00d4ff12", border: "1px solid #00d4ff30", color: "#00d4ff", padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 10 }}>⟳ REFRESH ALL</button>
        {groqKey && <button onClick={aiScan} disabled={scanning} style={{ background: "#a855f718", border: "1px solid #a855f740", color: "#a855f7", padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 10 }}>{scanning ? "⟳ SCANNING..." : "🔍 AI SCAN ALL"}</button>}
        <span style={{ fontSize: 8, color: "#6a7a9a", marginLeft: "auto" }}>CLICK CARD TO LOAD · AUTO-REFRESH 30s</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6 }}>
        {items.map((it, i) => {
          const sc = scanResults[it.sym], isActive = it.sym === currentTicker;
          return (
            <div key={it.sym} onClick={() => onLoadTicker(it.sym)}
              style={{ background: isActive ? "#0f2040" : "#06060f", border: `1px solid ${isActive ? "#00d4ff50" : "#1f2535"}`, borderRadius: 6, padding: "8px 10px", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: "bold", color: "#e8f0f8", fontSize: 12, letterSpacing: 1 }}>{it.sym}</div>
                  <div style={{ fontSize: 8, color: "#e8f0f8", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); persist(items.filter(x => x.sym !== it.sym)); }} style={{ background: "none", border: "none", color: "#6a7a9a", cursor: "pointer", fontSize: 11 }}>✕</button>
              </div>
              {it.loading ? <div style={{ fontSize: 10, color: "#e8f0f8", marginTop: 6 }}>⟳ loading...</div>
                : it.price ? <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: "bold", color: it.pct >= 0 ? "#00ff9d" : "#ff3355" }}>{it.price < 10 ? it.price.toFixed(4) : it.price.toFixed(2)}</span>
                  <span style={{ fontSize: 11, color: it.pct >= 0 ? "#00ff9d" : "#ff3355" }}>{it.pct >= 0 ? "▲" : "▼"} {Math.abs(it.pct).toFixed(2)}%</span>
                </div> : <div style={{ fontSize: 10, color: "#e8f0f8", marginTop: 6 }}>—</div>}
              {sc && <div style={{ marginTop: 6, display: "flex", gap: 6, borderTop: "1px solid #0a0a1a", paddingTop: 5 }}>
                <span style={{ fontSize: 9, fontWeight: "bold", color: sigC[sc.signal] || "#888", border: `1px solid ${sigC[sc.signal] || "#888"}40`, padding: "1px 6px", borderRadius: 3 }}>{sc.signal}</span>
                <span style={{ fontSize: 8, color: "#5a6a80", flex: 1, lineHeight: 1.3 }}>{sc.reason}</span>
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ================================================================
// EXPANSION 2 — PORTFOLIO TRACKER
// ================================================================
function PortfolioPanel({ currentTicker, currentPrice }) {
  const [positions, setPositions] = useState(() => { try { return JSON.parse(localStorage.getItem("nx_port") || "[]"); } catch { return []; } });
  const [form, setForm] = useState({ sym: "", dir: "LONG", qty: "", entry: "", note: "" });
  const [livePrices, setLivePrices] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(() => { try { return JSON.parse(localStorage.getItem("nx_hist") || "[]"); } catch { return []; } });

  const persist = (arr) => { setPositions(arr); try { localStorage.setItem("nx_port", JSON.stringify(arr)); } catch {} };
  const persistHist = (arr) => { setHistory(arr); try { localStorage.setItem("nx_hist", JSON.stringify(arr)); } catch {} };

  const refreshPrices = async () => {
    setRefreshing(true);
    const syms = [...new Set(positions.map(p => p.sym))];
    const res = {};
    for (const s of syms) { try { const q = await fetchQuickQuote(s); res[s] = q.price; } catch {} }
    if (currentTicker && currentPrice) res[currentTicker] = currentPrice;
    setLivePrices(res); setRefreshing(false);
  };

  useEffect(() => { if (positions.length) refreshPrices(); }, [positions.length]);
  useEffect(() => { if (currentTicker && currentPrice) setLivePrices(p => ({ ...p, [currentTicker]: currentPrice })); }, [currentTicker, currentPrice]);

  const getP = (pos) => {
    const lp = livePrices[pos.sym]; if (!lp) return null;
    const raw = pos.dir === "LONG" ? (lp - pos.entry) * pos.qty : (pos.entry - lp) * pos.qty;
    return { raw, pct: (raw / (pos.entry * pos.qty)) * 100, lp };
  };

  const addPos = () => {
    if (!form.sym || !form.qty || !form.entry) return;
    const pos = { id: Date.now(), sym: form.sym.toUpperCase(), dir: form.dir, qty: parseFloat(form.qty), entry: parseFloat(form.entry), note: form.note, openedAt: new Date().toLocaleDateString() };
    persist([...positions, pos]);
    setForm(f => ({ ...f, sym: "", qty: "", entry: "", note: "" }));
  };

  const closePos = (id) => {
    const pos = positions.find(p => p.id === id);
    if (pos) {
      const p = getP(pos);
      const closed = { ...pos, closedAt: new Date().toLocaleDateString(), finalPnl: p?.raw || 0, finalPct: p?.pct || 0, pnl: p?.raw || 0, pct: p?.pct || 0, date: pos.openedAt };
      persistHist([closed, ...history].slice(0, 50));
      // Feed into AI Memory if a prediction exists for this symbol
      try {
        const pred = JSON.parse(localStorage.getItem("nx_last_prediction_" + pos.sym) || "null");
        if (pred) recordAIOutcome(closed, pred);
      } catch {}
    }
    persist(positions.filter(p => p.id !== id));
  };

  const totalPnl = positions.reduce((a, pos) => a + (getP(pos)?.raw || 0), 0);
  const totalHistPnl = history.reduce((a, h) => a + (h.finalPnl || 0), 0);

  return (
    <div style={{ padding: 12 }}>
      {/* Form */}
      <div style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 6, padding: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: "#e8f0f8", letterSpacing: 2, marginBottom: 8 }}>OPEN POSITION</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
          {[["sym", "TICKER", 80, true], ["qty", "QTY", 70, false], ["entry", "ENTRY $", 100, false], ["note", "NOTE", 140, false]].map(([k, ph, w, up]) => (
            <input key={k} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: up ? e.target.value.toUpperCase() : e.target.value }))} placeholder={ph}
              style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10, width: w }} />
          ))}
          <select value={form.dir} onChange={e => setForm(f => ({ ...f, dir: e.target.value }))} style={{ background: "#04040c", border: "1px solid #6a7a9a", color: form.dir === "LONG" ? "#00ff9d" : "#ff3355", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }}>
            <option value="LONG">▲ LONG</option><option value="SHORT">▼ SHORT</option>
          </select>
          <button onClick={addPos} style={{ background: "#00ff9d18", border: "1px solid #00ff9d40", color: "#00ff9d", padding: "5px 14px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 10 }}>+ OPEN</button>
          <button onClick={refreshPrices} disabled={refreshing} style={{ background: "#00d4ff12", border: "1px solid #00d4ff30", color: "#00d4ff", padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 10, marginLeft: "auto" }}>{refreshing ? "⟳" : "⟳ REFRESH P&L"}</button>
        </div>
      </div>
      {/* Summary Row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
        {[["OPEN", positions.length, "#00d4ff"], ["OPEN P&L", `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`, totalPnl >= 0 ? "#00ff9d" : "#ff3355"], ["REALIZED", `${totalHistPnl >= 0 ? "+" : ""}$${totalHistPnl.toFixed(2)}`, totalHistPnl >= 0 ? "#00ff9d" : "#ff3355"]].map(([l, v, c]) => (
          <div key={l} style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 6, padding: "6px 14px" }}>
            <div style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1 }}>{l}</div>
            <div style={{ fontSize: 15, fontWeight: "bold", color: c }}>{v}</div>
          </div>
        ))}
        <button onClick={() => setShowHistory(h => !h)} style={{ background: "#ffcc0012", border: "1px solid #ffcc0030", color: "#ffcc00", padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 9, marginLeft: "auto" }}>
          {showHistory ? "SHOW OPEN" : `📜 HISTORY (${history.length})`}
        </button>
      </div>
      {/* Positions Table */}
      {!showHistory ? (
        positions.length === 0
          ? <div style={{ color: "#6a7a9a", fontFamily: "monospace", fontSize: 10, padding: "16px", textAlign: "center" }}>No open positions.</div>
          : <div style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "60px 55px 70px 80px 90px 80px 1fr 36px", padding: "5px 10px", borderBottom: "1px solid #1f2535" }}>
              {["SYM", "DIR", "QTY", "ENTRY", "LIVE", "P&L", "NOTE", ""].map((h, i) => <div key={i} style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1 }}>{h}</div>)}
            </div>
            {positions.map(pos => { const p = getP(pos); return (
              <div key={pos.id} style={{ display: "grid", gridTemplateColumns: "60px 55px 70px 80px 90px 80px 1fr 36px", padding: "7px 10px", borderBottom: "1px solid #08081a", alignItems: "center" }}>
                <div style={{ fontWeight: "bold", color: "#e8f0f8", fontSize: 11 }}>{pos.sym}</div>
                <div style={{ color: pos.dir === "LONG" ? "#00ff9d" : "#ff3355", fontSize: 10, fontWeight: "bold" }}>{pos.dir}</div>
                <div style={{ color: "#e8f0f8", fontSize: 10 }}>{pos.qty}</div>
                <div style={{ color: "#e8f0f8", fontSize: 10 }}>{pos.entry < 10 ? pos.entry.toFixed(4) : pos.entry.toFixed(2)}</div>
                <div style={{ color: "#e8f0f8", fontSize: 10 }}>{p?.lp ? (p.lp < 10 ? p.lp.toFixed(4) : p.lp.toFixed(2)) : "—"}</div>
                <div style={{ fontSize: 10 }}>{p ? <span style={{ color: p.raw >= 0 ? "#00ff9d" : "#ff3355", fontWeight: "bold" }}>{p.raw >= 0 ? "+" : ""}${p.raw.toFixed(2)}<br /><span style={{ fontSize: 8, fontWeight: "normal" }}>{p.pct >= 0 ? "+" : ""}{p.pct.toFixed(1)}%</span></span> : <span style={{ color: "#e8f0f8" }}>—</span>}</div>
                <div style={{ fontSize: 9, color: "#5a6a8a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pos.note || pos.openedAt}</div>
                <button onClick={() => closePos(pos.id)} style={{ background: "#ff335518", border: "1px solid #ff335530", color: "#ff3355", padding: "3px 6px", borderRadius: 3, cursor: "pointer", fontSize: 9 }}>✕</button>
              </div>
            ); })}
          </div>
      ) : (
        history.length === 0
          ? <div style={{ color: "#6a7a9a", fontFamily: "monospace", fontSize: 10, padding: "16px", textAlign: "center" }}>No closed trades yet.</div>
          : <div style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "60px 55px 80px 80px 80px 1fr", padding: "5px 10px", borderBottom: "1px solid #1f2535" }}>
              {["SYM", "DIR", "ENTRY", "P&L", "$P&L", "CLOSED"].map((h, i) => <div key={i} style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1 }}>{h}</div>)}
            </div>
            {history.map((h, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 55px 80px 80px 80px 1fr", padding: "7px 10px", borderBottom: "1px solid #08081a", alignItems: "center" }}>
                <div style={{ fontWeight: "bold", color: "#e8f0f8", fontSize: 11 }}>{h.sym}</div>
                <div style={{ color: h.dir === "LONG" ? "#00ff9d60" : "#ff335560", fontSize: 10 }}>{h.dir}</div>
                <div style={{ color: "#5a6a80", fontSize: 10 }}>{h.entry < 10 ? h.entry.toFixed(4) : h.entry.toFixed(2)}</div>
                <div style={{ color: h.finalPnl >= 0 ? "#00ff9d" : "#ff3355", fontSize: 10, fontWeight: "bold" }}>{h.finalPnl >= 0 ? "+" : ""}{h.finalPct?.toFixed(1)}%</div>
                <div style={{ color: h.finalPnl >= 0 ? "#00ff9d" : "#ff3355", fontSize: 10 }}>{h.finalPnl >= 0 ? "+" : ""}${h.finalPnl?.toFixed(2)}</div>
                <div style={{ color: "#e8f0f8", fontSize: 9 }}>{h.closedAt}</div>
              </div>
            ))}
          </div>
      )}
    </div>
  );
}

// ================================================================
// EXPANSION 3 — PRICE ALERTS
// ================================================================
function AlertsPanel({ currentTicker, currentPrice }) {
  const [alerts, setAlerts] = useState(() => { try { return JSON.parse(localStorage.getItem("nx_alr") || "[]"); } catch { return []; } });
  const [form, setForm] = useState({ sym: currentTicker || "", cond: "above", price: "", note: "" });
  const [triggered, setTriggered] = useState([]);
  const [notifAllowed, setNotifAllowed] = useState(false);

  useEffect(() => { setForm(f => ({ ...f, sym: currentTicker || f.sym })); }, [currentTicker]);
  useEffect(() => { setNotifAllowed("Notification" in window && Notification.permission === "granted"); }, []);

  useEffect(() => {
    if (!currentPrice || !alerts.length) return;
    const fired = [], kept = [];
    alerts.forEach(a => {
      if (a.sym !== currentTicker) { kept.push(a); return; }
      const hit = (a.cond === "above" && currentPrice >= a.price) || (a.cond === "below" && currentPrice <= a.price);
      if (hit) fired.push({ ...a, triggeredAt: new Date().toLocaleTimeString(), triggeredPrice: currentPrice });
      else kept.push(a);
    });
    if (fired.length) {
      setTriggered(prev => [...fired, ...prev].slice(0, 30));
      setAlerts(kept); try { localStorage.setItem("nx_alr", JSON.stringify(kept)); } catch {}
      if (notifAllowed) fired.forEach(a => new Notification(`🔔 NEXUS: ${a.sym} ${a.cond} ${a.price}`, { body: `Hit at ${currentPrice?.toFixed(4)}` }));
      playBeep();
    }
  }, [currentPrice, currentTicker]);

  const persist = (arr) => { setAlerts(arr); try { localStorage.setItem("nx_alr", JSON.stringify(arr)); } catch {} };

  const addAlert = () => {
    if (!form.sym || !form.price) return;
    persist([...alerts, { id: Date.now(), sym: form.sym.toUpperCase(), cond: form.cond, price: parseFloat(form.price), note: form.note, createdAt: new Date().toLocaleTimeString() }]);
    setForm(f => ({ ...f, price: "", note: "" }));
  };

  const requestNotif = async () => {
    if ("Notification" in window) { const r = await Notification.requestPermission(); setNotifAllowed(r === "granted"); }
  };

  return (
    <div style={{ padding: 12 }}>
      {/* Form */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={form.sym} onChange={e => setForm(f => ({ ...f, sym: e.target.value.toUpperCase() }))} placeholder="TICKER" style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10, width: 80 }} />
        <select value={form.cond} onChange={e => setForm(f => ({ ...f, cond: e.target.value }))} style={{ background: "#04040c", border: "1px solid #6a7a9a", color: form.cond === "above" ? "#00ff9d" : "#ff3355", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }}>
          <option value="above">↑ ABOVE</option><option value="below">↓ BELOW</option>
        </select>
        <input value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="PRICE" style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#ffcc00", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10, width: 100 }} />
        <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Note (optional)" style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10, width: 160 }} />
        <button onClick={addAlert} style={{ background: "#ffcc0018", border: "1px solid #ffcc0040", color: "#ffcc00", padding: "5px 14px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 10 }}>🔔 SET ALERT</button>
        <button onClick={requestNotif} style={{ background: notifAllowed ? "#00ff9d12" : "#3a3a2012", border: `1px solid ${notifAllowed ? "#00ff9d40" : "#3a3a2040"}`, color: notifAllowed ? "#00ff9d" : "#5a5a40", padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>
          {notifAllowed ? "✓ NOTIFICATIONS ON" : "🔔 ENABLE NOTIFICATIONS"}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Active */}
        <div>
          <div style={{ fontSize: 9, color: "#e8f0f8", letterSpacing: 2, marginBottom: 6 }}>ACTIVE ALERTS ({alerts.length})</div>
          {alerts.length === 0
            ? <div style={{ color: "#6a7a9a", fontSize: 10, fontFamily: "monospace" }}>No active alerts set.</div>
            : alerts.map(a => (
              <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", background: "#06060f", border: "1px solid #1f2535", borderRadius: 5, padding: "7px 10px", marginBottom: 5 }}>
                <span style={{ fontWeight: "bold", color: "#e8f0f8", fontSize: 11 }}>{a.sym}</span>
                <span style={{ color: a.cond === "above" ? "#00ff9d" : "#ff3355", fontSize: 10 }}>{a.cond === "above" ? "↑" : "↓"}</span>
                <span style={{ color: "#ffcc00", fontWeight: "bold", fontSize: 11 }}>{a.price < 10 ? a.price.toFixed(4) : a.price.toFixed(2)}</span>
                {a.note && <span style={{ color: "#5a6a8a", fontSize: 9, flex: 1 }}>{a.note}</span>}
                <span style={{ color: "#6a7a9a", fontSize: 8, marginLeft: "auto" }}>{a.createdAt}</span>
                <button onClick={() => persist(alerts.filter(x => x.id !== a.id))} style={{ background: "none", border: "none", color: "#e8f0f8", cursor: "pointer", fontSize: 11 }}>✕</button>
              </div>
            ))}
        </div>
        {/* Triggered */}
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 9, color: "#e8f0f8", letterSpacing: 2 }}>FIRED ({triggered.length})</span>
            {triggered.length > 0 && <button onClick={() => setTriggered([])} style={{ background: "none", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "1px 6px", borderRadius: 3, cursor: "pointer", fontSize: 8, fontFamily: "monospace" }}>CLEAR</button>}
          </div>
          {triggered.length === 0
            ? <div style={{ color: "#6a7a9a", fontSize: 10, fontFamily: "monospace" }}>No fired alerts yet.</div>
            : triggered.map((a, i) => (
              <div key={i} style={{ background: "#0a040418", border: "1px solid #ff335530", borderRadius: 5, padding: "7px 10px", marginBottom: 5, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 14 }}>🔔</span>
                <div>
                  <span style={{ fontWeight: "bold", color: "#ff9955", fontSize: 11 }}>{a.sym}</span>
                  <span style={{ color: "#8a7a55", fontSize: 10, marginLeft: 6 }}>{a.cond} {a.price < 10 ? a.price.toFixed(4) : a.price.toFixed(2)}</span>
                  <div style={{ fontSize: 8, color: "#5a4a30" }}>{a.triggeredAt} @ {a.triggeredPrice?.toFixed(4)}</div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ================================================================
// EXPANSION 4 — NEWS SENTIMENT
// ================================================================
function NewsSentimentPanel({ ticker, groqKey }) {
  const [news, setNews] = useState([]);
  const [sentiment, setSentiment] = useState(null);
  const [loadingNews, setLoadingNews] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [err, setErr] = useState("");
  const lastTicker = useRef("");

  const fetchNews = async () => {
    if (!ticker) return;
    setLoadingNews(true); setErr(""); setSentiment(null);
    try {
      const rss = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`;
      const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(rss)}`);
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, "text/xml");
      const items = [...doc.querySelectorAll("item")].slice(0, 15).map(el => ({
        title: el.querySelector("title")?.textContent || "",
        desc: el.querySelector("description")?.textContent?.replace(/<[^>]+>/g, "").slice(0, 130) || "",
        date: el.querySelector("pubDate")?.textContent || "",
      })).filter(n => n.title);
      setNews(items); lastTicker.current = ticker;
    } catch (e) { setErr("News fetch failed: " + e.message); }
    finally { setLoadingNews(false); }
  };

  useEffect(() => { if (ticker && ticker !== lastTicker.current) fetchNews(); }, [ticker]);

  const analyzeGroq = async () => {
    if (!groqKey) { setErr("Add Groq key in ⚙ Settings"); return; }
    if (!news.length) return;
    setLoadingAI(true);
    try {
      const headlines = news.map((n, i) => `${i + 1}. ${n.title}`).join("\n");
      const prompt = `Analyze these ${ticker} news headlines. Reply ONLY with raw JSON (no markdown):
{"overall":"BULLISH"|"BEARISH"|"NEUTRAL","score":0-100,"summary":"2 sentences","catalysts":["top 3 positive themes"],"risks":["top 3 risk themes"],"items":[{"title":"shortened title","sentiment":"bullish"|"bearish"|"neutral","impact":"high"|"medium"|"low"}]}

Headlines:
${headlines}`;
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: 1200 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setSentiment(JSON.parse((data.choices?.[0]?.message?.content || "{}").replace(/```json|```/g, "").trim()));
    } catch (e) { setErr("AI Error: " + e.message); }
    finally { setLoadingAI(false); }
  };

  const sc = { BULLISH: "#00ff9d", BEARISH: "#ff3355", NEUTRAL: "#ffcc00" };
  const si = { bullish: "▲", bearish: "▼", neutral: "◆" };

  return (
    <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 300px", gap: 12 }}>
      {/* Feed */}
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#e8f0f8", letterSpacing: 2 }}>NEWS — {ticker}</span>
          <button onClick={fetchNews} disabled={loadingNews} style={{ background: "#00d4ff12", border: "1px solid #00d4ff30", color: "#00d4ff", padding: "3px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>{loadingNews ? "⟳" : "⟳ REFRESH"}</button>
          {groqKey && <button onClick={analyzeGroq} disabled={loadingAI || !news.length} style={{ background: "#a855f718", border: "1px solid #a855f740", color: "#a855f7", padding: "3px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>{loadingAI ? "⟳ ANALYZING..." : "🧠 ANALYZE SENTIMENT"}</button>}
        </div>
        {err && <div style={{ color: "#ff3355", fontSize: 9, marginBottom: 6 }}>⚠ {err}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 310, overflowY: "auto" }}>
          {news.length === 0 && !loadingNews && <div style={{ color: "#6a7a9a", fontSize: 10, fontFamily: "monospace" }}>No news loaded.</div>}
          {news.map((n, i) => {
            const it = sentiment?.items?.[i];
            return (
              <div key={i} style={{ background: "#06060f", border: `1px solid ${it ? (it.sentiment === "bullish" ? "#00ff9d20" : it.sentiment === "bearish" ? "#ff335520" : "#1f2535") : "#1f2535"}`, borderRadius: 5, padding: "8px 10px" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                  {it && <span style={{ color: sc[it.sentiment?.toUpperCase()] || "#888", fontSize: 10, flexShrink: 0, marginTop: 1 }}>{si[it.sentiment] || "◆"}</span>}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: "#e8f0f8", lineHeight: 1.5, fontWeight: it?.impact === "high" ? "bold" : "normal" }}>{n.title}</div>
                    {n.desc && <div style={{ fontSize: 9, color: "#5a6a8a", marginTop: 2, lineHeight: 1.4 }}>{n.desc}</div>}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                      <span style={{ fontSize: 8, color: "#6a7a9a" }}>{n.date?.slice(0, 22)}</span>
                      {it && <span style={{ fontSize: 8, color: it.impact === "high" ? "#ffcc00" : "#e8f0f8", letterSpacing: 1 }}>{it.impact?.toUpperCase()}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Sentiment Card */}
      <div>
        <div style={{ fontSize: 9, color: "#e8f0f8", letterSpacing: 2, marginBottom: 8 }}>AI SENTIMENT</div>
        {!sentiment && !loadingAI && (
          <div style={{ color: "#6a7a9a", fontSize: 10, fontFamily: "monospace", lineHeight: 1.9 }}>
            {["→ Parses all headlines", "→ Rates each by impact", "→ Finds positive catalysts", "→ Flags risk themes", "→ Overall sentiment score"].map(l => <div key={l}>{l}</div>)}
          </div>
        )}
        {loadingAI && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 24, color: "#a855f7" }}><div style={{ fontSize: 22, animation: "spin 1s linear infinite" }}>◈</div><div style={{ fontSize: 9, letterSpacing: 2, color: "#e8f0f8" }}>READING THE NEWS...</div></div>}
        {sentiment && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ background: "#06060f", border: `1px solid ${sc[sentiment.overall] || "#888"}30`, borderRadius: 6, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 16, fontWeight: "bold", color: sc[sentiment.overall] || "#888", letterSpacing: 2 }}>{sentiment.overall}</span>
                <span style={{ fontSize: 15, fontWeight: "bold", color: sentiment.score > 60 ? "#00ff9d" : sentiment.score < 40 ? "#ff3355" : "#ffcc00" }}>{sentiment.score}/100</span>
              </div>
              <div style={{ width: "100%", height: 4, background: "#1f2535", borderRadius: 2, marginBottom: 8 }}>
                <div style={{ width: `${sentiment.score}%`, height: "100%", background: `linear-gradient(90deg,${sc[sentiment.overall]},${sc[sentiment.overall]}88)`, borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 9, color: "#e8f0f8", lineHeight: 1.6 }}>{sentiment.summary}</div>
            </div>
            {sentiment.catalysts?.length > 0 && (
              <div style={{ background: "#06060f", border: "1px solid #00ff9d18", borderRadius: 6, padding: 8 }}>
                <div style={{ fontSize: 8, color: "#00ff9d80", letterSpacing: 2, marginBottom: 4 }}>▲ CATALYSTS</div>
                {sentiment.catalysts.map((c, i) => <div key={i} style={{ fontSize: 9, color: "#4a6a55", lineHeight: 1.5 }}>+ {c}</div>)}
              </div>
            )}
            {sentiment.risks?.length > 0 && (
              <div style={{ background: "#06060f", border: "1px solid #ff335518", borderRadius: 6, padding: 8 }}>
                <div style={{ fontSize: 8, color: "#ff335580", letterSpacing: 2, marginBottom: 4 }}>▼ RISKS</div>
                {sentiment.risks.map((r, i) => <div key={i} style={{ fontSize: 9, color: "#6a3a45", lineHeight: 1.5 }}>- {r}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ================================================================
// EXPANSION 5 — MULTI-TIMEFRAME ANALYSIS
// ================================================================
const MTF_FRAMES = [
  { label: "15M", interval: "15m", range: "5d" },
  { label: "1H",  interval: "60m", range: "1mo" },
  { label: "4H",  interval: "90m", range: "2mo" },
  { label: "1D",  interval: "1d",  range: "3mo" },
  { label: "1W",  interval: "1wk", range: "2y" },
  { label: "1M",  interval: "1mo", range: "5y" },
];

function MultiTimeframePanel({ ticker }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastSym, setLastSym] = useState("");

  const analyze = async (sym) => {
    if (!sym) return;
    setLoading(true); setRows([]);
    const results = [];
    for (const tf of MTF_FRAMES) {
      try {
        const { candles } = await fetchYahoo(sym, tf.interval, tf.range);
        if (candles.length < 30) { results.push({ tf: tf.label, err: "Not enough data" }); continue; }
        const cls = candles.map(c => c.close);
        const n = cls.length;
        const rsiArr = calcRSI(cls), macdObj = calcMACD(cls);
        const s20 = sma(cls, 20), s50 = sma(cls, 50);
        const rsi = rsiArr.filter(v => v !== null).slice(-1)[0];
        const mHist = macdObj.hist.filter(v => v !== null);
        const mLast = mHist.slice(-1)[0], mPrev = mHist.slice(-2, -1)[0];
        const macdCross = mLast > 0 && mPrev <= 0 ? "BULL X" : mLast < 0 && mPrev >= 0 ? "BEAR X" : mLast > 0 ? "Bullish" : "Bearish";
        const price = cls[n - 1], sma20v = s20.filter(v => v).slice(-1)[0], sma50v = s50.filter(v => v).slice(-1)[0];
        const aboveSma20 = price > sma20v, aboveSma50 = price > sma50v;
        // Trend via last 10 closes slope
        const recent = cls.slice(-10);
        const slope = (recent[9] - recent[0]) / recent[0] * 100;
        const trend = slope > 1 ? "UPTREND" : slope < -1 ? "DOWNTREND" : "RANGING";
        // Bias score
        let score = 50;
        if (rsi > 50) score += 10; else score -= 10;
        if (mLast > 0) score += 10; else score -= 10;
        if (aboveSma20) score += 8; else score -= 8;
        if (aboveSma50) score += 8; else score -= 8;
        if (slope > 0) score += 7; else score -= 7;
        score = Math.max(0, Math.min(100, Math.round(score)));
        const bias = score >= 60 ? "BULL" : score <= 40 ? "BEAR" : "NEUT";
        const pats = detectCandlePatterns(candles).slice(-3).map(p => p.name).join(", ");
        results.push({ tf: tf.label, rsi, macdCross, trend, bias, score, aboveSma20, aboveSma50, price, pats: pats || "—" });
      } catch { results.push({ tf: tf.label, err: "Fetch failed" }); }
    }
    setRows(results); setLastSym(sym); setLoading(false);
  };

  useEffect(() => { if (ticker && ticker !== lastSym) analyze(ticker); }, [ticker]);

  const biasC = { BULL: "#00ff9d", BEAR: "#ff3355", NEUT: "#ffcc00" };
  const trendC = { UPTREND: "#00ff9d", DOWNTREND: "#ff3355", RANGING: "#ffcc00" };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 9, color: "#e8f0f8", letterSpacing: 2 }}>MTF CONFLUENCE — {ticker}</span>
        <button onClick={() => analyze(ticker)} disabled={loading} style={{ background: "#00d4ff12", border: "1px solid #00d4ff30", color: "#00d4ff", padding: "3px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>{loading ? "⟳ SCANNING..." : "⟳ REFRESH"}</button>
        {rows.length > 0 && (() => {
          const valid = rows.filter(r => !r.err);
          const bullCount = valid.filter(r => r.bias === "BULL").length;
          const bearCount = valid.filter(r => r.bias === "BEAR").length;
          const overall = bullCount >= 4 ? "STRONG BULL" : bullCount >= 3 ? "BULL LEAN" : bearCount >= 4 ? "STRONG BEAR" : bearCount >= 3 ? "BEAR LEAN" : "MIXED";
          const oc = bullCount >= 3 ? "#00ff9d" : bearCount >= 3 ? "#ff3355" : "#ffcc00";
          return <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: "bold", color: oc, border: `1px solid ${oc}40`, padding: "3px 14px", borderRadius: 4, letterSpacing: 2 }}>{overall}</span>;
        })()}
      </div>
      {loading && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 24, color: "#00d4ff" }}><div style={{ fontSize: 22, animation: "spin 1s linear infinite" }}>◈</div><div style={{ fontSize: 9, letterSpacing: 2, color: "#e8f0f8" }}>ANALYZING ALL TIMEFRAMES...</div></div>}
      {!loading && rows.length > 0 && (
        <>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "52px 60px 56px 60px 80px 80px 80px 1fr", padding: "5px 10px", borderBottom: "1px solid #1f2535", background: "#04040c", borderRadius: "4px 4px 0 0" }}>
            {["TF", "BIAS", "SCORE", "RSI", "MACD", "SMA20", "SMA50", "TREND / PATTERNS"].map((h, i) => <div key={i} style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1 }}>{h}</div>)}
          </div>
          {rows.map((r, i) => r.err ? (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "52px 60px 56px 60px 80px 80px 80px 1fr", padding: "9px 10px", borderBottom: "1px solid #08081a", background: "#06060f" }}>
              <span style={{ fontWeight: "bold", color: "#5a6a8a", fontSize: 11 }}>{r.tf}</span>
              <span style={{ color: "#e8f0f8", fontSize: 9, gridColumn: "2 / -1" }}>{r.err}</span>
            </div>
          ) : (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "52px 60px 56px 60px 80px 80px 80px 1fr", padding: "9px 10px", borderBottom: "1px solid #08081a", background: i % 2 === 0 ? "#06060f" : "#04040e", alignItems: "center" }}>
              <span style={{ fontWeight: "bold", color: "#e8f0f8", fontSize: 12 }}>{r.tf}</span>
              <span style={{ fontWeight: "bold", color: biasC[r.bias] || "#888", fontSize: 11, border: `1px solid ${biasC[r.bias] || "#888"}40`, padding: "2px 6px", borderRadius: 3, width: "fit-content" }}>{r.bias}</span>
              <span>
                <div style={{ width: 36, height: 4, background: "#1f2535", borderRadius: 2, marginBottom: 2 }}>
                  <div style={{ width: `${r.score}%`, height: "100%", background: biasC[r.bias] || "#888", borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 8, color: "#5a6a80" }}>{r.score}</span>
              </span>
              <span style={{ color: r.rsi > 70 ? "#ff3355" : r.rsi < 30 ? "#00ff9d" : "#e8f0f8", fontSize: 11, fontWeight: r.rsi > 70 || r.rsi < 30 ? "bold" : "normal" }}>{r.rsi?.toFixed(1)}</span>
              <span style={{ fontSize: 9, color: r.macdCross.includes("BULL") ? "#00ff9d" : r.macdCross.includes("BEAR") ? "#ff3355" : "#e8f0f8" }}>{r.macdCross}</span>
              <span style={{ fontSize: 9, color: r.aboveSma20 ? "#00ff9d" : "#ff3355" }}>{r.aboveSma20 ? "↑ Above" : "↓ Below"}</span>
              <span style={{ fontSize: 9, color: r.aboveSma50 ? "#00ff9d" : "#ff3355" }}>{r.aboveSma50 ? "↑ Above" : "↓ Below"}</span>
              <span style={{ fontSize: 9 }}>
                <span style={{ color: trendC[r.trend] || "#888", fontWeight: "bold", marginRight: 6 }}>{r.trend}</span>
                <span style={{ color: "#5a6a8a" }}>{r.pats}</span>
              </span>
            </div>
          ))}
          {/* Confluence bar */}
          {(() => {
            const valid = rows.filter(r => !r.err);
            const bullC = valid.filter(r => r.bias === "BULL").length;
            const bearC = valid.filter(r => r.bias === "BEAR").length;
            const neutC = valid.filter(r => r.bias === "NEUT").length;
            const total = valid.length || 1;
            return (
              <div style={{ padding: "10px", background: "#04040c", borderRadius: "0 0 4px 4px", display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1 }}>CONFLUENCE</span>
                <div style={{ flex: 1, height: 8, background: "#0a0a1a", borderRadius: 4, display: "flex", overflow: "hidden" }}>
                  <div style={{ width: `${bullC / total * 100}%`, background: "#00ff9d", transition: "width .5s" }} />
                  <div style={{ width: `${neutC / total * 100}%`, background: "#ffcc00", transition: "width .5s" }} />
                  <div style={{ width: `${bearC / total * 100}%`, background: "#ff3355", transition: "width .5s" }} />
                </div>
                <span style={{ fontSize: 9, color: "#00ff9d" }}>▲ {bullC}</span>
                <span style={{ fontSize: 9, color: "#ffcc00" }}>◆ {neutC}</span>
                <span style={{ fontSize: 9, color: "#ff3355" }}>▼ {bearC}</span>
              </div>
            );
          })()}
        </>
      )}
      {!loading && rows.length === 0 && <div style={{ color: "#6a7a9a", fontSize: 10, fontFamily: "monospace", padding: "16px 0" }}>Load a ticker and click Refresh to run multi-timeframe confluence analysis.</div>}
    </div>
  );
}

// ================================================================
// EXPANSION 6 — TRADE JOURNAL
// ================================================================
const TRADE_TAGS = ["Breakout", "Pullback", "SMC", "Reversal", "Scalp", "Swing", "News Play", "Earnings", "Trend Follow", "Range"];
const EMOJIS = ["😊", "😐", "😰", "🎯", "😤", "🧘", "🤑", "😅"];

function TradeJournalPanel() {
  const [entries, setEntries] = useState(() => { try { return JSON.parse(localStorage.getItem("nx_journal") || "[]"); } catch { return []; } });
  const [form, setForm] = useState({ sym: "", dir: "LONG", entry: "", exit: "", qty: "", tags: [], emotion: "😊", notes: "", date: new Date().toISOString().slice(0, 10) });
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("list"); // list | stats

  const persist = (arr) => { setEntries(arr); try { localStorage.setItem("nx_journal", JSON.stringify(arr)); } catch {} };

  const addEntry = () => {
    if (!form.sym || !form.entry || !form.exit || !form.qty) return;
    const entry = parseFloat(form.entry), exit = parseFloat(form.exit), qty = parseFloat(form.qty);
    const pnl = form.dir === "LONG" ? (exit - entry) * qty : (entry - exit) * qty;
    const pct = form.dir === "LONG" ? (exit - entry) / entry * 100 : (entry - exit) / entry * 100;
    persist([{ id: Date.now(), ...form, entry, exit, qty, pnl, pct, date: form.date || new Date().toISOString().slice(0, 10) }, ...entries]);
    setForm(f => ({ ...f, sym: "", entry: "", exit: "", qty: "", notes: "", tags: [] }));
  };

  const del = (id) => persist(entries.filter(e => e.id !== id));
  const toggleTag = (tag) => setForm(f => ({ ...f, tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag] }));

  const filtered = filter === "all" ? entries : filter === "win" ? entries.filter(e => e.pnl > 0) : entries.filter(e => e.pnl <= 0);

  // Stats
  const totalPnl = entries.reduce((a, e) => a + e.pnl, 0);
  const wins = entries.filter(e => e.pnl > 0).length;
  const losses = entries.filter(e => e.pnl <= 0).length;
  const winRate = entries.length ? (wins / entries.length * 100).toFixed(0) : 0;
  const avgWin = wins ? entries.filter(e => e.pnl > 0).reduce((a, e) => a + e.pnl, 0) / wins : 0;
  const avgLoss = losses ? Math.abs(entries.filter(e => e.pnl <= 0).reduce((a, e) => a + e.pnl, 0)) / losses : 0;
  const profitFactor = avgLoss ? (avgWin * wins / (avgLoss * losses)).toFixed(2) : "∞";
  const tagFreq = {};
  entries.forEach(e => (e.tags || []).forEach(t => { tagFreq[t] = (tagFreq[t] || 0) + 1; }));

  return (
    <div style={{ padding: 12 }}>
      {/* Form */}
      <div style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 6, padding: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: "#e8f0f8", letterSpacing: 2, marginBottom: 8 }}>LOG TRADE</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 8 }}>
          {[["sym", "TICKER", 70, true], ["entry", "ENTRY", 90, false], ["exit", "EXIT", 90, false], ["qty", "QTY", 70, false]].map(([k, ph, w, up]) => (
            <div key={k}>
              <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>{ph}</div>
              <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: up ? e.target.value.toUpperCase() : e.target.value }))} placeholder={ph}
                style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10, width: w }} />
            </div>
          ))}
          <div>
            <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>DATE</div>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }} />
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>DIR</div>
            <select value={form.dir} onChange={e => setForm(f => ({ ...f, dir: e.target.value }))} style={{ background: "#04040c", border: "1px solid #6a7a9a", color: form.dir === "LONG" ? "#00ff9d" : "#ff3355", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }}>
              <option value="LONG">▲ LONG</option><option value="SHORT">▼ SHORT</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>MOOD</div>
            <select value={form.emotion} onChange={e => setForm(f => ({ ...f, emotion: e.target.value }))} style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 13 }}>
              {EMOJIS.map(em => <option key={em} value={em}>{em}</option>)}
            </select>
          </div>
          <button onClick={addEntry} style={{ background: "#00ff9d18", border: "1px solid #00ff9d40", color: "#00ff9d", padding: "5px 14px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 10, alignSelf: "flex-end" }}>+ LOG</button>
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
          {TRADE_TAGS.map(tag => (
            <button key={tag} onClick={() => toggleTag(tag)} style={{ background: form.tags.includes(tag) ? "#00d4ff20" : "transparent", border: `1px solid ${form.tags.includes(tag) ? "#00d4ff60" : "#6a7a9a"}`, color: form.tags.includes(tag) ? "#00d4ff" : "#5a6a8a", padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>{tag}</button>
          ))}
        </div>
        <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes / rationale / lessons learned..."
          style={{ width: "100%", background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "6px 10px", borderRadius: 4, fontFamily: "monospace", fontSize: 9, resize: "vertical", minHeight: 44, boxSizing: "border-box" }} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {["all", "win", "loss"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? "#0f2040" : "transparent", border: `1px solid ${filter === f ? "#00d4ff" : "#6a7a9a"}`, color: filter === f ? "#00d4ff" : "#5a6a8a", padding: "3px 10px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>{f.toUpperCase()} ({f === "all" ? entries.length : f === "win" ? wins : losses})</button>
        ))}
        <button onClick={() => setView(v => v === "list" ? "stats" : "list")} style={{ background: "#a855f712", border: "1px solid #a855f730", color: "#a855f7", padding: "3px 12px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontSize: 9, marginLeft: "auto" }}>{view === "list" ? "📊 STATS" : "📋 LIST"}</button>
      </div>
      {view === "stats" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
          {[["TOTAL P&L", `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`, totalPnl >= 0 ? "#00ff9d" : "#ff3355"], ["WIN RATE", `${winRate}%`, parseFloat(winRate) >= 50 ? "#00ff9d" : "#ff3355"], ["PROFIT FACTOR", profitFactor, parseFloat(profitFactor) >= 1.5 ? "#00ff9d" : "#ff3355"], ["AVG WIN", `$${avgWin.toFixed(2)}`, "#00ff9d"], ["AVG LOSS", `-$${avgLoss.toFixed(2)}`, "#ff3355"], ["TRADES", entries.length, "#00d4ff"]].map(([l, v, c]) => (
            <div key={l} style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 6, padding: "10px 14px" }}>
              <div style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1, marginBottom: 4 }}>{l}</div>
              <div style={{ fontSize: 18, fontWeight: "bold", color: c }}>{v}</div>
            </div>
          ))}
          {Object.keys(tagFreq).length > 0 && (
            <div style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 6, padding: "10px 14px", gridColumn: "span 2" }}>
              <div style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1, marginBottom: 6 }}>TOP SETUPS</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, c]) => <span key={t} style={{ fontSize: 9, color: "#00d4ff", background: "#00d4ff12", border: "1px solid #00d4ff30", padding: "2px 8px", borderRadius: 3 }}>{t} ×{c}</span>)}</div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 300, overflowY: "auto" }}>
          {filtered.length === 0 && <div style={{ color: "#6a7a9a", fontSize: 10, fontFamily: "monospace" }}>No journal entries yet.</div>}
          {filtered.map(e => (
            <div key={e.id} style={{ background: "#06060f", border: `1px solid ${e.pnl >= 0 ? "#00ff9d18" : "#ff335518"}`, borderRadius: 5, padding: "8px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 14 }}>{e.emotion}</span>
                  <span style={{ fontWeight: "bold", color: "#e8f0f8", fontSize: 12 }}>{e.sym}</span>
                  <span style={{ color: e.dir === "LONG" ? "#00ff9d" : "#ff3355", fontSize: 10 }}>{e.dir}</span>
                  <span style={{ color: "#5a6a80", fontSize: 9 }}>{e.date}</span>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontWeight: "bold", color: e.pnl >= 0 ? "#00ff9d" : "#ff3355", fontSize: 13 }}>{e.pnl >= 0 ? "+" : ""}${e.pnl.toFixed(2)}</span>
                  <span style={{ color: e.pct >= 0 ? "#00ff9d" : "#ff3355", fontSize: 10 }}>{e.pct >= 0 ? "+" : ""}{e.pct.toFixed(2)}%</span>
                  <button onClick={() => del(e.id)} style={{ background: "none", border: "none", color: "#e8f0f8", cursor: "pointer", fontSize: 11 }}>✕</button>
                </div>
              </div>
              <div style={{ fontSize: 9, color: "#5a6a8a" }}>Entry: {e.entry} → Exit: {e.exit} · Qty: {e.qty}</div>
              {e.tags?.length > 0 && <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>{e.tags.map(t => <span key={t} style={{ fontSize: 8, color: "#00d4ff80", background: "#00d4ff0a", border: "1px solid #00d4ff20", padding: "1px 5px", borderRadius: 2 }}>{t}</span>)}</div>}
              {e.notes && <div style={{ marginTop: 5, fontSize: 9, color: "#5a6a80", lineHeight: 1.5, borderTop: "1px solid #0a0a1a", paddingTop: 4 }}>{e.notes}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ================================================================
// EXPANSION 7 — SCREENER
// ================================================================
const SCREENER_PRESETS = {
  "S&P Leaders": ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","JPM","BRK-B"],
  "Crypto": ["BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD","DOGE-USD","LINK-USD"],
  "Forex": ["EURUSD=X","GBPUSD=X","USDJPY=X","AUDUSD=X","USDCAD=X","USDCHF=X"],
  "ETFs": ["SPY","QQQ","IWM","GLD","TLT","VXX","ARKK","XLF"],
};

function ScreenerPanel({ onLoadTicker }) {
  const [tickers, setTickers] = useState("AAPL,MSFT,NVDA,TSLA,AMZN");
  const [results, setResults] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [sortBy, setSortBy] = useState("score");
  const [filterBias, setFilterBias] = useState("all");
  const [preset, setPreset] = useState("");

  const runScan = async () => {
    const syms = tickers.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 20);
    if (!syms.length) return;
    setScanning(true); setResults([]);
    const out = [];
    for (const sym of syms) {
      try {
        const { candles } = await fetchYahoo(sym, "1d", "3mo");
        if (candles.length < 30) { out.push({ sym, err: "Insufficient data" }); continue; }
        const cls = candles.map(c => c.close);
        const n = cls.length, price = cls[n - 1], prev = cls[n - 2];
        const pct = (price - prev) / prev * 100;
        const rsiArr = calcRSI(cls), macdObj = calcMACD(cls), bbArr = calcBB(cls), atrArr = calcATR(candles);
        const s20 = sma(cls, 20), s50 = sma(cls, 50), s200 = sma(cls, 200);
        const rsi = rsiArr.filter(v => v !== null).slice(-1)[0];
        const mHist = macdObj.hist.filter(v => v !== null);
        const mLast = mHist.slice(-1)[0], mPrev = mHist.slice(-2,-1)[0];
        const bb = bbArr.filter(v => v.u).slice(-1)[0];
        const atr = atrArr.filter(v => v).slice(-1)[0];
        const sma20v = s20.filter(v => v).slice(-1)[0], sma50v = s50.filter(v => v).slice(-1)[0], sma200v = s200.filter(v => v).slice(-1)[0];
        const patterns = detectCandlePatterns(candles).slice(-3).map(p => p.name);
        const smcSigs = detectSMC(candles).slice(-3).map(s => s.label);
        let score = 50;
        if (rsi > 50 && rsi < 70) score += 12; else if (rsi < 30) score += 8; else if (rsi > 70) score -= 8;
        if (mLast > 0) { score += 10; if (mPrev <= 0) score += 5; } else { score -= 10; if (mPrev >= 0) score -= 5; }
        if (price > sma20v) score += 8; else score -= 8;
        if (price > sma50v) score += 6; else score -= 6;
        if (price > sma200v) score += 4; else score -= 4;
        if (pct > 0) score += 4; else score -= 4;
        const vol5 = candles.slice(-5).reduce((a, c) => a + c.volume, 0) / 5;
        const vol20 = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
        if (vol5 > vol20 * 1.3) score += 6;
        score = Math.max(0, Math.min(100, Math.round(score)));
        const bias = score >= 62 ? "BULL" : score <= 38 ? "BEAR" : "NEUT";
        const atrPct = atr ? (atr / price * 100).toFixed(2) : "—";
        out.push({ sym, price, pct, rsi, mLast, bias, score, sma20v, sma50v, sma200v, atrPct, patterns, smcSigs, err: null });
        // Record screener signal to AI memory
        try {
          const sDir = bias==="BULL"?"LONG":bias==="BEAR"?"SHORT":"WAIT";
          if (sDir !== "WAIT") {
            const srL2=detectSR(candles).slice(0,4), divs2=detectDivergence(candles,rsiArr,macdObj.hist), fib2=calcFib(candles);
            const nearFL=fib2?.levels.find(l=>Math.abs(price-l.price)/price<0.015);
            const atSR2=srL2.some(l=>Math.abs(price-l.p)/price<0.01);
            const srSt2=Math.max(0,...srL2.filter(l=>Math.abs(price-l.p)/price<0.01).map(l=>l.s||0));
            const vSt2=vol5>vol20*1.3?"spike":vol5>vol20*1.1?"above":"normal";
            const fp={ bias:bias==="BULL"?"BULLISH":"BEARISH", confidence:score, direction:sDir, rsiAtSignal:rsi, macdHistAtSignal:mLast, trendAtSignal:trendState(sma20v,sma50v,sma200v,price), atrStateAtSignal:atrState(atr,price), volumeStateAtSignal:vSt2, patterns:patterns.join(","), smcSignals:smcSigs.join(","), hasDivergence:divs2.length>0, divType:divs2[0]?.type||"none", nearFib:!!nearFL, nearFibRatio:nearFL?.ratio??null, atSR:atSR2, srStrength:srSt2, setup:{direction:sDir}, ticker:sym, tf:"1d", price };
            recordAIOutcome({sym,tf:"1d",dir:sDir,pnl:pct,pct,date:new Date().toLocaleDateString()},fp);
          }
        } catch {}
      } catch { out.push({ sym, err: "Fetch failed" }); }
      setResults([...out]);
    }
    setScanning(false);
  };

  const loadPreset = (name) => { setPreset(name); if (SCREENER_PRESETS[name]) setTickers(SCREENER_PRESETS[name].join(", ")); };
  const biasC = { BULL: "#00ff9d", BEAR: "#ff3355", NEUT: "#ffcc00" };
  const filtered = results.filter(r => !r.err && (filterBias === "all" || r.bias === filterBias)).sort((a, b) => sortBy === "score" ? b.score - a.score : sortBy === "pct" ? b.pct - a.pct : sortBy === "rsi" ? b.rsi - a.rsi : 0);
  const errors = results.filter(r => r.err);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <div style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1, marginBottom: 4 }}>TICKERS (comma-separated, max 20)</div>
          <input value={tickers} onChange={e => setTickers(e.target.value.toUpperCase())} placeholder="AAPL, MSFT, TSLA..."
            style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "6px 10px", borderRadius: 4, fontFamily: "monospace", fontSize: 10, width: "100%" }} />
        </div>
        <div>
          <div style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1, marginBottom: 4 }}>PRESET</div>
          <select value={preset} onChange={e => loadPreset(e.target.value)} style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "6px 10px", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }}>
            <option value="">Custom</option>
            {Object.keys(SCREENER_PRESETS).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button onClick={runScan} disabled={scanning} style={{ background: "#00ff9d18", border: "1px solid #00ff9d40", color: "#00ff9d", padding: "6px 18px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 10, fontWeight: "bold", alignSelf: "flex-end" }}>{scanning ? `⟳ SCANNING (${results.length})...` : "▶ RUN SCAN"}</button>
      </div>
      {results.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <span style={{ fontSize: 8, color: "#e8f0f8" }}>FILTER</span>
          {["all", "BULL", "NEUT", "BEAR"].map(f => <button key={f} onClick={() => setFilterBias(f)} style={{ background: filterBias === f ? "#0f2040" : "transparent", border: `1px solid ${filterBias === f ? "#00d4ff" : "#6a7a9a"}`, color: filterBias === f ? "#00d4ff" : "#5a6a8a", padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontSize: 8 }}>{f}</button>)}
          <span style={{ fontSize: 8, color: "#e8f0f8", marginLeft: 10 }}>SORT</span>
          {[["score","SCORE"],["pct","CHANGE%"],["rsi","RSI"]].map(([k,l]) => <button key={k} onClick={() => setSortBy(k)} style={{ background: sortBy === k ? "#0f2040" : "transparent", border: `1px solid ${sortBy === k ? "#00d4ff" : "#6a7a9a"}`, color: sortBy === k ? "#00d4ff" : "#5a6a8a", padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontSize: 8 }}>{l}</button>)}
          <span style={{ fontSize: 8, color: "#e8f0f8", marginLeft: "auto" }}>{filtered.length} results</span>
        </div>
      )}
      {filtered.length > 0 && (
        <div style={{ background: "#04040c", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "70px 80px 70px 56px 70px 70px 70px 70px 1fr", padding: "5px 10px", borderBottom: "1px solid #1f2535" }}>
            {["SYM","PRICE","CHG%","RSI","SMA20","SMA50","ATR%","SCORE","SIGNALS"].map((h,i) => <div key={i} style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1 }}>{h}</div>)}
          </div>
          {filtered.map((r, i) => (
            <div key={r.sym} onClick={() => onLoadTicker(r.sym)}
              style={{ display: "grid", gridTemplateColumns: "70px 80px 70px 56px 70px 70px 70px 70px 1fr", padding: "8px 10px", borderBottom: "1px solid #08081a", background: i % 2 === 0 ? "#06060f" : "#04040e", cursor: "pointer", alignItems: "center" }}>
              <span style={{ fontWeight: "bold", color: "#e8f0f8", fontSize: 12 }}>{r.sym}</span>
              <span style={{ color: "#e8f0f8", fontSize: 11, fontWeight: "bold" }}>{r.price < 10 ? r.price.toFixed(4) : r.price.toFixed(2)}</span>
              <span style={{ color: r.pct >= 0 ? "#00ff9d" : "#ff3355", fontSize: 11, fontWeight: "bold" }}>{r.pct >= 0 ? "+" : ""}{r.pct.toFixed(2)}%</span>
              <span style={{ color: r.rsi > 70 ? "#ff3355" : r.rsi < 30 ? "#00ff9d" : "#e8f0f8", fontSize: 11 }}>{r.rsi?.toFixed(1)}</span>
              <span style={{ fontSize: 9, color: r.price > r.sma20v ? "#00ff9d" : "#ff3355" }}>{r.price > r.sma20v ? "↑" : "↓"} {r.sma20v?.toFixed(2)}</span>
              <span style={{ fontSize: 9, color: r.price > r.sma50v ? "#00ff9d" : "#ff3355" }}>{r.price > r.sma50v ? "↑" : "↓"} {r.sma50v?.toFixed(2)}</span>
              <span style={{ fontSize: 9, color: "#e8f0f8" }}>{r.atrPct}%</span>
              <span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 26, height: 4, background: "#1f2535", borderRadius: 2 }}><div style={{ width: `${r.score}%`, height: "100%", background: biasC[r.bias] || "#888", borderRadius: 2 }} /></div>
                  <span style={{ fontWeight: "bold", color: biasC[r.bias] || "#888", fontSize: 10 }}>{r.bias}</span>
                </div>
                <span style={{ fontSize: 8, color: "#5a6a8a" }}>{r.score}/100</span>
              </span>
              <span style={{ fontSize: 8, color: "#5a6a8a" }}>{[...r.patterns, ...r.smcSigs].slice(0, 3).join(" · ")}</span>
            </div>
          ))}
        </div>
      )}
      {errors.length > 0 && <div style={{ marginTop: 6, fontSize: 9, color: "#e8f0f8" }}>Failed: {errors.map(e => e.sym).join(", ")}</div>}
      {!scanning && results.length === 0 && <div style={{ color: "#6a7a9a", fontSize: 10, fontFamily: "monospace", padding: "16px 0" }}>Enter tickers or pick a preset, then click Run Scan. Results update live as each ticker loads.</div>}
    </div>
  );
}

// ================================================================
// BACKTEST + PAPER TRADING ENGINE
// Full-context bar replay with realistic SL/TP simulation,
// memory-aware prompts, and complete feature-vector recording
// ================================================================

// ── Rich bar context: computes ALL dimensions the intelligence engine needs ──
const buildBarContext = (candles, idx) => {
  const slice = candles.slice(0, idx + 1);
  if (slice.length < 30) return null;
  const cls  = slice.map(c => c.close);
  const s20  = sma(cls, 20), s50 = sma(cls, 50), s200 = sma(cls, 200);
  const rsiArr = calcRSI(cls), macdObj = calcMACD(cls), bbArr = calcBB(cls), atrArr = calcATR(slice);
  const rsi    = rsiArr.filter(v => v !== null).slice(-1)[0];
  const mHist  = macdObj.hist.filter(v => v !== null).slice(-1)[0];
  const mLine  = macdObj.ml.filter(v => v !== null).slice(-1)[0];
  const mSig   = macdObj.sig.filter(v => v !== null).slice(-1)[0];
  const sma20v = s20.filter(v => v).slice(-1)[0];
  const sma50v = s50.filter(v => v).slice(-1)[0];
  const sma200v= s200.filter(v => v).slice(-1)[0];
  const atr    = atrArr.filter(v => v).slice(-1)[0];
  const bb     = bbArr.filter(v => v.u).slice(-1)[0];
  const c      = slice[slice.length - 1];
  // Detect patterns using last 30 bars
  const patsArr= detectCandlePatterns(slice).slice(-5);
  const smcArr = detectSMC(slice).slice(-5);
  const srLvls = detectSR(slice).slice(0, 6);
  const divs   = detectDivergence(slice, rsiArr, macdObj.hist).slice(-3);
  const fib    = calcFib(slice, Math.min(60, slice.length));
  // S/R proximity
  const atSR   = srLvls.some(l => Math.abs(c.close - l.p) / c.close < 0.01);
  const srStr  = Math.max(0, ...srLvls.filter(l => Math.abs(c.close - l.p) / c.close < 0.01).map(l => l.s || 0));
  // Fib proximity
  const nearFibLvl = fib?.levels.find(l => Math.abs(c.close - l.price) / c.close < 0.015);
  // Volume
  const volState = volumeState(slice, slice.length - 1);
  // Build trend
  const trend = trendState(sma20v, sma50v, sma200v, c.close);
  const atrSt = atrState(atr, c.close);
  const bbPos = bb ? (c.close > bb.u ? "above_upper" : c.close < bb.l ? "below_lower" : c.close > bb.m ? "upper_half" : "lower_half") : "?";
  const patsStr = patsArr.map(p => p.name).join(", ");
  const smcStr  = smcArr.map(s => s.label).join(", ");
  const srStr2  = srLvls.map(l => `${l.t}@${l.p < 10 ? l.p.toFixed(4) : l.p.toFixed(2)}(${l.s})`).join(", ");
  return {
    c, rsi, mHist, mLine, mSig, sma20v, sma50v, sma200v, atr, bb, bbPos,
    patsStr, smcStr, srStr: srStr2, divs,
    atSR, srStrength: srStr, nearFibLvl,
    nearFib: !!nearFibLvl, nearFibRatio: nearFibLvl?.ratio ?? null,
    trend, atrState: atrSt, volumeState: volState,
    hasDivergence: divs.length > 0,
    divType: divs[0]?.type || "none",
  };
};

// ── Realistic trade simulation with SL and TP ────────────────────
const simulateTrade = (candles, entryIdx, direction, atr, confidence) => {
  const entry    = candles[entryIdx].close;
  const atrMult  = confidence >= 75 ? 1.5 : confidence >= 60 ? 2.0 : 2.5;
  const slDist   = (atr || entry * 0.01) * atrMult;
  const rrRatio  = confidence >= 75 ? 2.5 : confidence >= 60 ? 2.0 : 1.5;
  const tpDist   = slDist * rrRatio;
  const sl       = direction === "LONG" ? entry - slDist : entry + slDist;
  const tp       = direction === "LONG" ? entry + tpDist : entry - tpDist;
  const maxBars  = 20;
  let exitPrice  = entry, exitBar = entryIdx, exitReason = "timeout", hit = false;

  for (let i = entryIdx + 1; i < Math.min(candles.length, entryIdx + maxBars + 1); i++) {
    const bar = candles[i];
    if (direction === "LONG") {
      if (bar.low  <= sl) { exitPrice = sl; exitBar = i; exitReason = "SL"; hit = false; break; }
      if (bar.high >= tp) { exitPrice = tp; exitBar = i; exitReason = "TP"; hit = true;  break; }
    } else {
      if (bar.high >= sl) { exitPrice = sl; exitBar = i; exitReason = "SL"; hit = false; break; }
      if (bar.low  <= tp) { exitPrice = tp; exitBar = i; exitReason = "TP"; hit = true;  break; }
    }
    exitPrice = bar.close; exitBar = i;
  }
  // Timeout — was price in profit?
  if (exitReason === "timeout") {
    hit = direction === "LONG" ? exitPrice > entry : exitPrice < entry;
  }
  const pnlPct = direction === "LONG"
    ? (exitPrice - entry) / entry * 100
    : (entry - exitPrice) / entry * 100;
  return { entry, exit: exitPrice, sl, tp, exitBar, exitReason, hit, pnlPct, barsHeld: exitBar - entryIdx };
};

// ── Equity curve calculation ─────────────────────────────────────
const buildEquityCurve = (results, startCapital = 1000) => {
  let equity = startCapital;
  return results
    .filter(r => r.direction !== "WAIT")
    .map(r => { equity *= (1 + r.pnlPct / 100); return { date: r.date, equity: Math.round(equity * 100) / 100 }; });
};

// ================================================================
// BACKTEST PANEL — full intelligence-connected replay
// ================================================================
function BacktestPanel({ candles, ticker, tf, groqKey, groqModel }) {
  const [running,   setRunning]   = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [results,   setResults]   = useState([]);
  const [summary,   setSummary]   = useState(null);
  const [stepSize,  setStepSize]  = useState(5);
  const [minConf,   setMinConf]   = useState(0);    // filter: only signals above this confidence
  const [useMemory, setUseMemory] = useState(true); // inject memory context into backtest prompts
  const [autoEvolve,setAutoEvolve]= useState(true); // auto-evolve rules when done
  const [evolving,  setEvolving]  = useState(false);
  const [tab,       setTab]       = useState("results");
  const [saved,     setSaved]     = useState(() => { try { return JSON.parse(localStorage.getItem("nx_backtest") || "{}"); } catch { return {}; } });
  const btKey = `${ticker}-${tf}`;

  const run = async () => {
    if (!groqKey || candles.length < 50) return;
    setRunning(true); setResults([]); setSummary(null); setProgress(0); setTab("results");

    const startIdx = 40;
    const endIdx   = candles.length - 22;
    const indices  = [];
    for (let i = startIdx; i <= endIdx; i += stepSize) indices.push(i);

    const out = [];
    for (let k = 0; k < indices.length; k++) {
      const idx = indices[k];
      setProgress(Math.round((k / indices.length) * 100));

      const ctx = buildBarContext(candles, idx);
      if (!ctx) continue;
      const { c, rsi, mHist, mLine, mSig, sma20v, sma50v, sma200v, atr, bbPos,
              patsStr, smcStr, srStr, trend, atrState: atrSt, volumeState: volSt,
              hasDivergence, nearFib, nearFibRatio, atSR, srStrength } = ctx;
      const prev  = candles[idx - 1];
      const pct   = prev ? ((c.close - prev.close) / prev.close * 100).toFixed(2) : "0";

      // Inject memory context so the AI uses what it already learned
      let memCtx = "";
      if (useMemory) {
        const tempFV = {
          bias: "NEUTRAL", confidence: 50,
          rsiAtSignal: rsi, macdHistAtSignal: mHist,
          trendAtSignal: trend, atrStateAtSignal: atrSt,
          volumeStateAtSignal: volSt, patterns: patsStr, smcSignals: smcStr,
          hasDivergence, divType: ctx.divType || "none",
          nearFib, nearFibRatio, atSR, srStrength, setup: {},
        };
        const fv = buildFeatureVector(tempFV, null);
        memCtx = buildMemoryContext(ticker, tf, fv);
      }

      const bbStr = c.close && ctx.bb ? `BB: ${bbPos} (U:${ctx.bb?.u?.toFixed(2)} M:${ctx.bb?.m?.toFixed(2)} L:${ctx.bb?.l?.toFixed(2)})` : "BB: N/A";
      const prompt = `You are NEXUS testing signals on historical ${ticker} data. Bar ${idx}/${candles.length} | Date: ${c.date}
Price: ${c.close?.toFixed(4)} (${pct}%) | OHLCV: O:${c.open?.toFixed(4)} H:${c.high?.toFixed(4)} L:${c.low?.toFixed(4)} V:${c.volume > 1e6 ? (c.volume/1e6).toFixed(1)+"M" : c.volume}
RSI: ${rsi?.toFixed(1)} | MACD: ${mLine?.toFixed(5)} hist:${mHist?.toFixed(5)} sig:${mSig?.toFixed(5)}
SMA20: ${sma20v?.toFixed(4)} SMA50: ${sma50v?.toFixed(4)} SMA200: ${sma200v?.toFixed(4)} ATR: ${atr?.toFixed(4)}
${bbStr} | Trend: ${trend} | Volatility: ${atrSt} | Volume: ${volSt}
Candle patterns: ${patsStr || "none"} | SMC: ${smcStr || "none"}
S/R levels: ${srStr || "none"} | Near fib: ${nearFib ? (nearFibRatio ? (nearFibRatio*100).toFixed(1)+"%" : "yes") : "no"}
Divergence: ${hasDivergence ? "YES" : "none"}
${memCtx ? `\nLEARNED CONTEXT:\n${memCtx}` : ""}

Based on ALL above signals, reply ONLY with JSON:
{"bias":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"direction":"LONG"|"SHORT"|"WAIT","reason":"max 12 words","confluenceFactors":["list","each","confirming","signal"]}`;

      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
          body: JSON.stringify({
            model: groqModel || "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: "You are NEXUS, a quantitative trading AI. Reply ONLY raw JSON, no markdown." },
              { role: "user",   content: prompt }
            ],
            temperature: 0.15, max_tokens: 150
          })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        const sig = JSON.parse((data.choices?.[0]?.message?.content || "{}").replace(/```json|```/g, "").trim());

        if (sig.direction === "WAIT" || (sig.confidence || 0) < minConf) {
          out.push({ idx, date: c.date, bias: sig.bias, confidence: sig.confidence, direction: "WAIT", pnlPct: 0, hit: false, reason: sig.reason, exitReason: "skipped", confluenceScore: 0 });
          setResults([...out]);
          await new Promise(r => setTimeout(r, 200));
          continue;
        }

        // Simulate realistic trade with SL/TP
        const trade = simulateTrade(candles, idx, sig.direction, atr, sig.confidence);

        // Build full feature vector for AI memory
        const fakePred = {
          bias: sig.bias, confidence: sig.confidence,
          rsiAtSignal: rsi, macdHistAtSignal: mHist,
          trendAtSignal: trend, atrStateAtSignal: atrSt,
          volumeStateAtSignal: volSt,
          patterns: patsStr, smcSignals: smcStr,
          hasDivergence, divType: ctx.divType || "none",
          nearFib, nearFibRatio, atSR, srStrength, setup: { direction: sig.direction },
        };
        const fv = buildFeatureVector(fakePred, null);

        const record = {
          idx, date: c.date,
          bias: sig.bias, confidence: sig.confidence,
          direction: sig.direction,
          entry:  trade.entry, exit: trade.exit,
          sl: trade.sl, tp: trade.tp,
          pnlPct: trade.pnlPct, hit: trade.hit,
          exitReason: trade.exitReason, barsHeld: trade.barsHeld,
          reason: sig.reason,
          confluenceScore: fv.confluenceScore,
          rsiState: fv.rsiState, trend: fv.trend,
          hasOB: fv.hasOB, hasFVG: fv.hasFVG, hasDivergence: fv.hasDivergence,
          fibState: fv.fibState, srState: fv.srState,
          strongBullCandle: fv.strongBullCandle, strongBearCandle: fv.strongBearCandle,
          candleCount: fv.candleCount,
          fv,  // store full FV for memory recording
        };
        out.push(record);
        setResults([...out]);

        // Immediately record to AI memory (real-time learning)
        const fakeTrade = { sym: ticker, tf: tf.split("|")[0], dir: sig.direction, pnl: trade.pnlPct, pct: trade.pnlPct, date: c.date };
        recordAIOutcome(fakeTrade, { ...fakePred, tf });

      } catch (e) { console.warn("Backtest bar error:", e); }

      await new Promise(r => setTimeout(r, 300));
    }

    // Compute final summary
    const active    = out.filter(r => r.direction !== "WAIT");
    const wins      = active.filter(r => r.hit);
    const losses    = active.filter(r => !r.hit);
    const tpHits    = active.filter(r => r.exitReason === "TP");
    const slHits    = active.filter(r => r.exitReason === "SL");
    const totalPnl  = active.reduce((a, r) => a + r.pnlPct, 0);
    const hiCS      = active.filter(r => (r.confluenceScore || 0) >= 60);
    const loCS      = active.filter(r => (r.confluenceScore || 0) < 35);
    const maxDD     = (() => {
      let peak = 0, dd = 0, cap = 100;
      active.forEach(r => { cap *= (1 + r.pnlPct/100); if (cap > peak) peak = cap; dd = Math.max(dd, (peak - cap) / peak * 100); });
      return dd.toFixed(1);
    })();
    const sharpe = (() => {
      if (active.length < 3) return "N/A";
      const avg = totalPnl / active.length;
      const std = Math.sqrt(active.reduce((a, r) => a + Math.pow(r.pnlPct - avg, 2), 0) / active.length);
      return std > 0 ? (avg / std * Math.sqrt(active.length)).toFixed(2) : "N/A";
    })();

    const sumObj = {
      total: out.length, active: active.length,
      winRate:    active.length ? (wins.length / active.length * 100).toFixed(1) : "0",
      totalPnl:   totalPnl.toFixed(2),
      tpRate:     active.length ? (tpHits.length / active.length * 100).toFixed(0) : "0",
      slRate:     active.length ? (slHits.length / active.length * 100).toFixed(0) : "0",
      avgPnlWin:  wins.length   ? (wins.reduce((a, r) => a + r.pnlPct, 0) / wins.length).toFixed(2) : "0",
      avgPnlLoss: losses.length ? (Math.abs(losses.reduce((a, r) => a + r.pnlPct, 0)) / losses.length).toFixed(2) : "0",
      maxDD, sharpe,
      hiCSWR:  hiCS.length ? (hiCS.filter(r => r.hit).length / hiCS.length * 100).toFixed(0) : "N/A",
      loCSWR:  loCS.length ? (loCS.filter(r => r.hit).length / loCS.length * 100).toFixed(0) : "N/A",
      longWR:  active.filter(r=>r.direction==="LONG").length  ? (active.filter(r=>r.direction==="LONG"&&r.hit).length/active.filter(r=>r.direction==="LONG").length*100).toFixed(0) : "N/A",
      shortWR: active.filter(r=>r.direction==="SHORT").length ? (active.filter(r=>r.direction==="SHORT"&&r.hit).length/active.filter(r=>r.direction==="SHORT").length*100).toFixed(0) : "N/A",
      date: new Date().toLocaleDateString(),
    };
    setSummary(sumObj);

    const stored = { ...saved, [btKey]: { summary: sumObj, results: out } };
    setSaved(stored);
    try { localStorage.setItem("nx_backtest", JSON.stringify(stored)); } catch {}

    // Auto-evolve prompt if enabled
    if (autoEvolve && active.length >= 5) {
      setEvolving(true);
      const mem    = loadAIMemory();
      const memKey = `${ticker}-${tf.split("|")[0]}`;
      const entry  = mem[memKey];
      if (entry && groqKey) await evolvePrompt(memKey, entry, groqKey);
      setEvolving(false);
    }

    setRunning(false); setProgress(100);
  };

  const loadSaved = () => { const e = saved[btKey]; if (e) { setResults(e.results || []); setSummary(e.summary || null); } };

  const active   = results.filter(r => r.direction !== "WAIT");
  const equity   = buildEquityCurve(results);
  const biasC    = { BULLISH: "#00ff9d", BEARISH: "#ff3355", NEUTRAL: "#ffcc00" };
  const exitC    = { TP: "#00ff9d", SL: "#ff3355", timeout: "#ffcc00", skipped: "#e8f0f8" };
  const TABS     = [{ id:"results",label:"Results"},{id:"equity",label:"Equity Curve"},{id:"confluence",label:"By Confluence"},{id:"info",label:"How It Works"}];

  return (
    <div style={{ padding: 12 }}>
      {/* ── Controls ── */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>STEP (every N bars)</div>
          <select value={stepSize} onChange={e => setStepSize(+e.target.value)}
            style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }}>
            {[3,5,8,10,15,20].map(v => <option key={v} value={v}>Every {v} bars (~{Math.floor((candles.length-62)/v)} signals)</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>MIN CONFIDENCE</div>
          <select value={minConf} onChange={e => setMinConf(+e.target.value)}
            style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }}>
            {[0,50,60,65,70,75,80].map(v => <option key={v} value={v}>{v === 0 ? "All signals" : `≥${v}% confidence`}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer", fontSize: 9, color: "#e8f0f8" }}>
            <input type="checkbox" checked={useMemory} onChange={e => setUseMemory(e.target.checked)} />
            Inject AI memory into prompts
          </label>
          <label style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer", fontSize: 9, color: "#e8f0f8" }}>
            <input type="checkbox" checked={autoEvolve} onChange={e => setAutoEvolve(e.target.checked)} />
            Auto-evolve rules when done
          </label>
        </div>
        <button onClick={run} disabled={running || !groqKey || candles.length < 50}
          style={{ background: "#00ff9d18", border: "1px solid #00ff9d40", color: "#00ff9d", padding: "6px 18px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 10, fontWeight: "bold" }}>
          {running ? `⟳ RUNNING ${progress}%` : "▶ RUN BACKTEST"}
        </button>
        {saved[btKey] && !running && (
          <button onClick={loadSaved}
            style={{ background: "#00d4ff12", border: "1px solid #00d4ff30", color: "#00d4ff", padding: "6px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>
            ↩ LAST ({saved[btKey]?.summary?.date})
          </button>
        )}
        {evolving && <span style={{ fontSize: 9, color: "#00ff9d80", animation: "pulse 1.5s infinite" }}>⚡ Evolving rules...</span>}
        {!groqKey && <span style={{ fontSize: 9, color: "#ffcc0080" }}>⚠ Set Groq key in ⚙</span>}
        {candles.length < 50 && <span style={{ fontSize: 9, color: "#ff335580" }}>⚠ Fetch more data</span>}
      </div>

      {/* ── Progress ── */}
      {running && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ width: "100%", height: 5, background: "#1f2535", borderRadius: 3 }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg,#00ff9d,#00d4ff)", borderRadius: 3, transition: "width .4s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
            <span style={{ fontSize: 8, color: "#e8f0f8" }}>{results.filter(r=>r.direction!=="WAIT").length} signals tested · {progress}% complete</span>
            {useMemory && <span style={{ fontSize: 8, color: "#a855f7" }}>🧠 Memory-aware · learning live</span>}
          </div>
        </div>
      )}

      {/* ── Summary cards ── */}
      {summary && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {[
              ["WIN RATE",    `${summary.winRate}%`,    parseFloat(summary.winRate) >= 50 ? "#00ff9d" : "#ff3355"],
              ["TOTAL P&L",  `${parseFloat(summary.totalPnl)>=0?"+":""}${summary.totalPnl}%`, parseFloat(summary.totalPnl)>=0?"#00ff9d":"#ff3355"],
              ["SIGNALS",    summary.active,            "#00d4ff"],
              ["TP RATE",    `${summary.tpRate}%`,      "#00ff9d"],
              ["SL RATE",    `${summary.slRate}%`,      "#ff3355"],
              ["AVG WIN",    `+${summary.avgPnlWin}%`,  "#00ff9d"],
              ["AVG LOSS",   `-${summary.avgPnlLoss}%`, "#ff3355"],
              ["MAX DD",     `-${summary.maxDD}%`,      "#ff8c00"],
              ["SHARPE",     summary.sharpe,            parseFloat(summary.sharpe)>1?"#00ff9d":parseFloat(summary.sharpe)>0?"#ffcc00":"#ff3355"],
              ["HI-CS WR",  `${summary.hiCSWR}%`,      "#a855f7"],
              ["LO-CS WR",  `${summary.loCSWR}%`,      "#ff335580"],
              ["LONG WR",   `${summary.longWR}%`,       "#00ff9d"],
              ["SHORT WR",  `${summary.shortWR}%`,      "#ff3355"],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 4, padding: "4px 9px" }}>
                <div style={{ fontSize: 7, color: "#e8f0f8" }}>{l}</div>
                <div style={{ fontSize: 12, fontWeight: "bold", color: c }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "#0a0a18", border: "1px solid #a855f730", borderRadius: 5, padding: "7px 12px", fontSize: 9, color: "#b895f8" }}>
            ✓ All {active.length} signals recorded to AI Memory with full confluence vectors. {autoEvolve ? "Rules auto-evolved." : ""} Future live analyses on {ticker} will reference these results.
          </div>
        </div>
      )}

      {/* ── Inner tabs ── */}
      {results.length > 0 && (
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1f2535", marginBottom: 8 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background: "transparent", border: "none", borderBottom: tab===t.id?"2px solid #00d4ff":"2px solid transparent", color: tab===t.id?"#00d4ff":"#e8f0f8", padding: "5px 12px", cursor: "pointer", fontFamily: "monospace", fontSize: 8 }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Results table ── */}
      {tab === "results" && results.length > 0 && (
        <div style={{ background: "#04040c", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "54px 70px 55px 40px 42px 70px 70px 60px 55px 50px 1fr", padding: "4px 8px", borderBottom: "1px solid #1f2535", position: "sticky", top: 0, background: "#04040c" }}>
            {["DATE","BIAS","DIR","CONF","CS","ENTRY","EXIT","P&L","EXIT WHY","BARS","SIGNALS"].map((h,i)=><div key={i} style={{fontSize:7,color:"#e8f0f8"}}>{h}</div>)}
          </div>
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {results.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "54px 70px 55px 40px 42px 70px 70px 60px 55px 50px 1fr", padding: "5px 8px", borderBottom: "1px solid #08081a", background: r.hit ? "#001508" : r.direction==="WAIT" ? "#06060f" : "#15000808", alignItems: "center" }}>
                <span style={{ fontSize: 7, color: "#5a6a80" }}>{r.date}</span>
                <span style={{ fontSize: 8, fontWeight: "bold", color: biasC[r.bias]||"#888" }}>{r.bias}</span>
                <span style={{ fontSize: 8, color: r.direction==="LONG"?"#00ff9d":r.direction==="SHORT"?"#ff3355":"#ffcc00" }}>{r.direction}</span>
                <span style={{ fontSize: 8, color: (r.confidence||0)>=70?"#a855f7":"#e8f0f8" }}>{r.confidence}%</span>
                <span style={{ fontSize: 8, color: (r.confluenceScore||0)>=60?"#00ff9d":(r.confluenceScore||0)>=35?"#ffcc00":"#ff3355" }}>{r.confluenceScore||0}</span>
                <span style={{ fontSize: 8, color: "#e8f0f8" }}>{r.entry<10?r.entry?.toFixed(4):r.entry?.toFixed(2)}</span>
                <span style={{ fontSize: 8, color: "#e8f0f8" }}>{r.exit<10?r.exit?.toFixed(4):r.exit?.toFixed(2)}</span>
                <span style={{ fontSize: 9, fontWeight: "bold", color: r.pnlPct>=0?"#00ff9d":"#ff3355" }}>{r.pnlPct>=0?"+":""}{r.pnlPct?.toFixed(2)}%</span>
                <span style={{ fontSize: 8, color: exitC[r.exitReason]||"#888" }}>{r.exitReason}</span>
                <span style={{ fontSize: 8, color: "#5a6a8a" }}>{r.barsHeld}</span>
                <span style={{ fontSize: 7, color: "#5a6a8a" }}>{[r.strongBullCandle?"★Bull":r.strongBearCandle?"★Bear":(r.candleCount||0)>0?"pat":"", r.hasDivergence?"DIV":"", r.hasOB?"OB":"", r.fibState&&r.fibState!=="none"?"Fib":"", r.srState&&r.srState!=="none"?"SR":""].filter(Boolean).join(" ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Equity curve ── */}
      {tab === "equity" && equity.length > 0 && (
        <div style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 5, padding: 10 }}>
          <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 6 }}>Equity curve (starting $1000, compounded)</div>
          <svg width="100%" height={140} style={{ overflow: "visible" }}>
            {(() => {
              const vals  = equity.map(e => e.equity);
              const minV  = Math.min(...vals), maxV = Math.max(...vals);
              const range = maxV - minV || 1;
              const W = 800, H = 120;
              const xOf = i  => (i / (equity.length - 1)) * W;
              const yOf = v  => H - ((v - minV) / range) * H;
              const path = equity.map((e, i) => `${i===0?"M":"L"}${xOf(i)},${yOf(e.equity)}`).join(" ");
              const final = vals[vals.length - 1];
              const col = final >= 1000 ? "#00ff9d" : "#ff3355";
              return (<>
                <defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity={0.25}/><stop offset="100%" stopColor={col} stopOpacity={0}/></linearGradient></defs>
                <path d={`${path} L${xOf(equity.length-1)},${H} L0,${H} Z`} fill="url(#eqGrad)" />
                <path d={path} fill="none" stroke={col} strokeWidth={2} />
                <line x1={0} y1={yOf(1000)} x2={W} y2={yOf(1000)} stroke="#e8f0f8" strokeWidth={1} strokeDasharray="4,3" />
                {equity.filter((_,i)=>i%Math.ceil(equity.length/6)===0).map((e,i)=>(
                  <text key={i} x={xOf(equity.indexOf(e))} y={H+16} fontSize={8} fill="#e8f0f8" textAnchor="middle" fontFamily="monospace">{e.date}</text>
                ))}
                <text x={W} y={yOf(final)-4} fontSize={9} fill={col} textAnchor="end" fontFamily="monospace" fontWeight="bold">${final.toFixed(0)}</text>
              </>);
            })()}
          </svg>
        </div>
      )}

      {/* ── By confluence ── */}
      {tab === "confluence" && (
        <div>
          <div style={{ fontSize: 9, color: "#e8f0f8", marginBottom: 8 }}>Win rate by confluence score bucket (0-100)</div>
          {["elite","high","medium","low"].map(lvl => {
            const range = { elite:[75,100], high:[50,74], medium:[25,49], low:[0,24] }[lvl];
            const bucket = active.filter(r => (r.confluenceScore||0) >= range[0] && (r.confluenceScore||0) <= range[1]);
            if (!bucket.length) return null;
            const wr = bucket.filter(r => r.hit).length / bucket.length * 100;
            const avgP = bucket.reduce((a,r)=>a+r.pnlPct,0)/bucket.length;
            const col = wr >= 55 ? "#00ff9d" : wr >= 40 ? "#ffcc00" : "#ff3355";
            return (
              <div key={lvl} style={{ background: "#06060f", border: `1px solid ${col}20`, borderRadius: 5, padding: "8px 12px", marginBottom: 5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontWeight: "bold", color: col, fontSize: 11 }}>{lvl.toUpperCase()} (CS {range[0]}-{range[1]})</span>
                  <div style={{ display: "flex", gap: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: "bold", color: col }}>{wr.toFixed(0)}% WR</span>
                    <span style={{ fontSize: 9, color: avgP>=0?"#00ff9d":"#ff3355" }}>avg {avgP>=0?"+":""}{avgP.toFixed(2)}%</span>
                    <span style={{ fontSize: 8, color: "#e8f0f8" }}>{bucket.length} trades</span>
                  </div>
                </div>
                <div style={{ width: "100%", height: 7, background: "#1f2535", borderRadius: 3 }}>
                  <div style={{ width: `${Math.min(100,wr)}%`, height: "100%", background: col, borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Info tab ── */}
      {tab === "info" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            ["What the backtest does", ["Replays every Nth bar of your loaded chart.", "At each bar, the AI sees ONLY what was visible at that moment (no future data).", "Generates a real LONG/SHORT/WAIT signal using all indicators + patterns + SMC + fib + S/R.", "Simulates the trade with realistic stop-loss and take-profit (ATR-based).", "Records the full feature vector to AI Memory immediately."]],
            ["What makes it intelligent", ["Injects the AI's learned rules and past signals into each backtest prompt.", "The AI reads its own track record before each bar — improving as it goes.", "Confluence score (0-100) grades each signal quality based on all confirmations.", "Results are sorted into confluence buckets so you see if quality correlates with outcome.", "Auto-evolves prompt rules from the completed session."]],
            ["Realistic trade simulation", ["Stop-loss: ATR × multiplier (tighter for high-confidence signals).", "Take-profit: SL × R:R ratio (2.5:1 for high-conf, 1.5:1 for low-conf).", "Exit reasons: TP hit, SL hit, or timeout (max 20 bars).", "Equity curve compounds each trade result.", "Sharpe ratio and max drawdown are computed for full performance view."]],
            ["Min confidence filter", ["Setting Min Confidence to 70% tests what happens if you only take signals the AI believes in strongly.", "Compare to all-signal WR to see if filtering improves results.", "Usually high-confluence + high-confidence = best combination.", "Low-confidence signals with high confluence score are also worth studying."]],
          ].map(([title, points]) => (
            <div key={title} style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 5, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, color: "#00d4ff", fontWeight: "bold", marginBottom: 6 }}>{title}</div>
              {points.map((p,i) => <div key={i} style={{ fontSize: 8, color: "#5a6a80", marginBottom: 4, lineHeight: 1.5 }}>→ {p}</div>)}
            </div>
          ))}
        </div>
      )}

      {!running && results.length === 0 && !saved[btKey] && (
        <div style={{ color: "#6a7a9a", fontSize: 9, fontFamily: "monospace", lineHeight: 1.9 }}>
          {["NEXUS BACKTEST ENGINE — fully connected to AI Intelligence.", "","→ Bar-by-bar replay with real Groq API calls", "→ All 20+ feature dimensions extracted per bar", "→ ATR-based SL/TP simulation (not just lookahead)", "→ Memory context injected into each prompt", "→ Confluence scoring per signal", "→ Real-time recording to AI Memory", "→ Auto-evolve rules on completion", "→ Equity curve + Sharpe ratio", "","Load a ticker then Run Backtest.","⚠ Uses 1 Groq API call per step."].map(l=><div key={l}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

// ================================================================
// PAPER TRADING ENGINE — forward-test without real money
// Live price polling, AI signal generation, virtual position management
// ================================================================
const PAPER_KEY = "nx_paper";
const loadPaper = () => { try { return JSON.parse(localStorage.getItem(PAPER_KEY) || '{"positions":[],"history":[],"capital":10000,"startCapital":10000}'); } catch { return { positions: [], history: [], capital: 10000, startCapital: 10000 }; } };
const savePaper = p => { try { localStorage.setItem(PAPER_KEY, JSON.stringify(p)); } catch {} };

function PaperTradingPanel({ candles, ticker, tf, groqKey, groqModel, analysis, lastPrice }) {
  const [paper,    setPaper]    = useState(loadPaper);
  const [scanning, setScanning] = useState(false);
  const [log,      setLog]      = useState([]);
  const [minCSPaper, setMinCSPaper] = useState(50);
  const [minConfPaper, setMinConfPaper] = useState(65);
  const [riskPct,  setRiskPct]  = useState(1);
  const [autoScan, setAutoScan] = useState(false);
  const autoRef = useRef(null);

  const persist = (p) => { setPaper(p); savePaper(p); };

  // Auto SL/TP checker — fires whenever lastPrice changes
  useEffect(() => {
    if (!lastPrice || !paper.positions.length) return;
    const closed = [];
    const open = paper.positions.filter(pos => {
      if (pos.sym !== ticker) return true;
      const hitSL = pos.dir==="LONG" ? lastPrice<=pos.sl : lastPrice>=pos.sl;
      const hitTP = pos.dir==="LONG" ? lastPrice>=pos.tp : lastPrice<=pos.tp;
      if (!hitSL && !hitTP) return true;
      closed.push({ ...pos, exitPrice:lastPrice, reason: hitTP?"TP":"SL" });
      return false;
    });
    if (!closed.length) return;
    let cap = paper.capital;
    const hist = [...paper.history];
    closed.forEach(pos => {
      const pnlPct    = pos.dir==="LONG" ? (pos.exitPrice-pos.entry)/pos.entry*100 : (pos.entry-pos.exitPrice)/pos.entry*100;
      const pnlDollar = pos.size*pos.entry*pnlPct/100;
      cap += pos.size*pos.entry + pnlDollar;
      hist.unshift({ ...pos, pnlPct, pnlDollar, closedBy:pos.reason, exitDate:new Date().toLocaleDateString() });
      addLog(`AUTO ${pos.reason}: ${pos.dir} ${pos.sym} @ ${pos.exitPrice.toFixed(4)} | ${pnlPct>=0?"+":""}${pnlPct.toFixed(2)}% ($${pnlDollar>=0?"+":""}${pnlDollar.toFixed(2)})`, pos.reason==="TP"?"#00ff9d":"#ff3355");
      try { const pred=JSON.parse(localStorage.getItem("nx_last_prediction_"+pos.sym)||"null"); if(pred) recordAIOutcome({sym:pos.sym,tf:tf.split("|")[0],dir:pos.dir,pnl:pnlDollar,pct:pnlPct,date:new Date().toLocaleDateString()},pred); } catch {}
      playBeep(pos.reason==="TP"?1046:523);
    });
    persist({ ...paper, positions:open, history:hist.slice(0,100), capital:cap });
  }, [lastPrice]);

  const addLog = (msg, col = "#e8f0f8") => setLog(prev => [{ msg, col, ts: new Date().toLocaleTimeString() }, ...prev].slice(0, 50));

  // Scan current ticker and potentially open/close paper positions
  const scanNow = async () => {
    if (!groqKey || !candles.length || !analysis) return;
    setScanning(true);
    const last  = candles[candles.length - 1];
    const price = lastPrice || last?.close;
    if (!price) { setScanning(false); return; }

    try {
      // ── Full intelligence extraction (same as live analysis) ──────
      const rsi      = analysis.rsiarr.filter(v=>v).slice(-1)[0];
      const mHist    = analysis.macdarr.hist.filter(v=>v).slice(-1)[0];
      const mLine    = analysis.macdarr.ml.filter(v=>v).slice(-1)[0];
      const mSig     = analysis.macdarr.sig.filter(v=>v).slice(-1)[0];
      const sma20v   = analysis.s20.filter(v=>v).slice(-1)[0];
      const sma50v   = analysis.s50.filter(v=>v).slice(-1)[0];
      const sma200v  = analysis.s200.filter(v=>v).slice(-1)[0];
      const atr      = analysis.atrarr.filter(v=>v).slice(-1)[0];
      const bb       = analysis.bbarr.filter(v=>v.u).slice(-1)[0];
      const vwapV    = analysis.vwap?.[analysis.vwap.length - 1];
      const regime   = analysis.regime;
      const volProf  = analysis.volProfile;

      // Candle patterns — ALL recent, classified
      const pats     = [...new Set(analysis.patterns.slice(-8).map(p=>`${p.name}(${p.sig})`))].join(", ");

      // SMC — full detail with type context
      const smcAll   = analysis.smcSigs.slice(-8);
      const smcStr   = smcAll.map(s => {
        const type = s.type || "";
        const ctx  = type.includes("FVG_BULL") ? "Bullish Fair Value Gap — unfilled imbalance, acts as magnet/support" :
                     type.includes("FVG_BEAR") ? "Bearish Fair Value Gap — unfilled imbalance, acts as resistance" :
                     type.includes("OB_BULL")  ? "Bullish Order Block — institutional buying zone, strong support" :
                     type.includes("OB_BEAR")  ? "Bearish Order Block — institutional selling zone, strong resistance" :
                     type.includes("BOS_BULL") ? "Break of Structure BULLISH — market shifted to higher highs, trend change" :
                     type.includes("BOS_BEAR") ? "Break of Structure BEARISH — market shifted to lower lows, trend change" :
                     type.includes("LIQ_BULL") ? "Liquidity Grab BULLISH — stop hunt below lows, smart money entering long" :
                     type.includes("LIQ_BEAR") ? "Liquidity Grab BEARISH — stop hunt above highs, smart money entering short" :
                     s.label;
        const priceRef = s.price ? ` @ ${s.price < 10 ? s.price.toFixed(5) : s.price.toFixed(2)}` :
                         s.lo    ? ` zone ${s.lo < 10 ? s.lo.toFixed(5) : s.lo.toFixed(2)}–${s.hi < 10 ? s.hi.toFixed(5) : s.hi.toFixed(2)}` : "";
        return `• ${ctx}${priceRef}`;
      }).join("\n");

      // Divergences with full meaning
      const divStr   = analysis.divergences.length
        ? analysis.divergences.map(d => {
            const meaning = d.type === "bull_reg" ? "Regular Bullish — price made lower low but RSI did not → downtrend exhaustion, reversal likely" :
                            d.type === "bull_hid" ? "Hidden Bullish — price made higher low, RSI did not → uptrend continuation signal" :
                            d.type === "bear_reg" ? "Regular Bearish — price made higher high but RSI did not → uptrend exhaustion, reversal likely" :
                            d.type === "bear_hid" ? "Hidden Bearish — price made lower high, RSI did not → downtrend continuation signal" : d.label;
            return `• ${meaning} [${d.idx2 - d.idx1} bars ago]`;
          }).join("\n")
        : "none";

      // Fibonacci levels with context
      const fibStr   = analysis.fib
        ? `${analysis.fib.uptrend ? "Uptrend" : "Downtrend"} retracement:
` +
          analysis.fib.levels.filter(l => !l.ext).map(l => {
            const dist = Math.abs(price - l.price) / price * 100;
            const near = dist < 1.5;
            return `  ${l.label} = ${l.price < 10 ? l.price.toFixed(5) : l.price.toFixed(2)}${near ? " ← PRICE HERE" : ""}`;
          }).join("\n")
        : "N/A";

      // S/R with strength
      const srStr    = analysis.srLvls.slice(0,6).map(l =>
        `${l.t === "R" ? "Resistance" : "Support"} @ ${l.p < 10 ? l.p.toFixed(5) : l.p.toFixed(2)} (strength: ${"★".repeat(Math.min(l.s,4))} ${l.s} touches)`
      ).join(", ");

      // Volume profile
      const vpocStr  = volProf ? `VPOC @ ${volProf.vpoc.price < 10 ? volProf.vpoc.price.toFixed(5) : volProf.vpoc.price.toFixed(2)} | VAH ${volProf.vah < 10 ? volProf.vah.toFixed(5) : volProf.vah.toFixed(2)} | VAL ${volProf.val < 10 ? volProf.val.toFixed(5) : volProf.val.toFixed(2)}` : "N/A";

      // BB position
      const bbPos    = bb ? (price > bb.u ? "ABOVE UPPER BAND — overbought extension" : price < bb.l ? "BELOW LOWER BAND — oversold extension" : price > bb.m ? "Upper half — bullish bias" : "Lower half — bearish bias") : "N/A";

      // ATR-based SL/TP
      const atrMult  = 1.8;
      const slDist   = (atr || price * 0.012) * atrMult;
      const tpDist   = slDist * 2.2;
      const slLong   = (price - slDist).toFixed(4);
      const tpLong   = (price + tpDist).toFixed(4);
      const slShort  = (price + slDist).toFixed(4);
      const tpShort  = (price - tpDist).toFixed(4);

      // Volume state
      const volSt    = volumeState(candles, candles.length - 1);
      const atrSt    = atrState(atr, price);
      const trend    = trendState(sma20v, sma50v, sma200v, price);

      // Build FV for confluence score + memory
      const atSR     = analysis.srLvls.some(l => Math.abs(price - l.p) / price < 0.01);
      const srStN    = Math.max(0, ...analysis.srLvls.filter(l => Math.abs(price - l.p) / price < 0.01).map(l => l.s||0));
      const nearFibLvl = analysis.fib?.levels.find(l => Math.abs(price - l.price) / price < 0.015);

      const tempPred = {
        bias:"NEUTRAL", confidence:50,
        rsiAtSignal:rsi, macdHistAtSignal:mHist,
        trendAtSignal:trend, atrStateAtSignal:atrSt, volumeStateAtSignal:volSt,
        patterns:pats, smcSignals:smcAll.map(s=>s.label).join(", "),
        hasDivergence:analysis.divergences.length>0, divType:analysis.divergences[0]?.type||"none",
        nearFib:!!nearFibLvl, nearFibRatio:nearFibLvl?.ratio??null,
        atSR, srStrength:srStN,
        regime: regime?.regime||"unknown", regimeSub:regime?.sub||"",
        volProfile:volProf, price,
        setup:{},
      };
      const fv      = buildFeatureVector(tempPred, null);
      const memCtx  = buildMemoryContext(ticker, tf, fv);

      // Last 5 candles for context
      const last5   = candles.slice(-5).map(c =>
        `[${c.date}] O:${c.open?.toFixed(4)} H:${c.high?.toFixed(4)} L:${c.low?.toFixed(4)} C:${c.close?.toFixed(4)} V:${c.volume>1e6?(c.volume/1e6).toFixed(1)+"M":c.volume}`
      ).join("\n");

      const prompt = `You are NEXUS — elite quantitative trader specializing in Smart Money Concepts.
PAPER TRADING SCAN: ${ticker} | ${tf} | ${new Date().toLocaleTimeString()}

═══ PRICE ACTION ═══
Current Price: ${price.toFixed(4)} | ATR: ${atr?.toFixed(4)} | Volatility: ${atrSt} | Volume: ${volSt}
Last 5 candles:
${last5}

═══ INDICATORS ═══
RSI(14): ${rsi?.toFixed(2)} (${rsiState(rsi)})
MACD: line ${mLine?.toFixed(5)} | signal ${mSig?.toFixed(5)} | hist ${mHist?.toFixed(5)} (${mHist>0?"BULLISH":"BEARISH"})
Bollinger Bands: ${bbPos}
SMA20: ${sma20v?.toFixed(4)} | SMA50: ${sma50v?.toFixed(4)} | SMA200: ${sma200v?.toFixed(4)}
VWAP: ${vwapV ? vwapV.toFixed(4) : "N/A"} | Price vs VWAP: ${vwapV ? (price > vwapV ? "ABOVE (institutional bullish)" : "BELOW (institutional bearish)") : "N/A"}
Trend: ${trend}

═══ CANDLESTICK PATTERNS ═══
${pats || "No patterns detected"}

═══ SMART MONEY CONCEPTS ═══
${smcStr || "No SMC signals detected"}

═══ DIVERGENCES ═══
${divStr}

═══ FIBONACCI LEVELS ═══
${fibStr}

═══ SUPPORT & RESISTANCE ═══
${srStr || "No significant levels"}

═══ VOLUME PROFILE ═══
${vpocStr}

═══ MARKET REGIME ═══
${regime ? `${regime.regime.toUpperCase()} (${regime.sub}) — ${regime.detail}` : "Unknown"}

═══ CONFLUENCE SCORE: ${fv.confluenceScore}/100 ═══
${memCtx ? `
═══ SELF-LEARNED MEMORY ═══
${memCtx}` : ""}

Analyze ALL signals above. Weight Smart Money signals heavily — Order Blocks and Liquidity Grabs indicate where institutions entered. A Bullish OB + price returning to that zone = high-probability long. A Liquidity Grab below recent lows + bullish candle = smart money trapped shorts.

Determine: Is there a high-probability setup here? Consider confluence of all signals.

Reply ONLY with raw JSON:
{"bias":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"direction":"LONG"|"SHORT"|"WAIT","sl_long":"${slLong}","sl_short":"${slShort}","tp_long":"${tpLong}","tp_short":"${tpShort}","summary":"2-3 sentences explaining the setup","keySignals":["top 3-4 confirming signals"],"risks":"main risk to this trade","regime_note":"how regime affects this"}`;

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: groqModel || "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: "You are NEXUS, an elite SMC-focused quantitative trading AI. Analyze ALL provided signals holistically. Reply ONLY raw JSON, no markdown." },
            { role: "user", content: prompt }
          ],
          temperature: 0.2, max_tokens: 600
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const sig = JSON.parse((data.choices?.[0]?.message?.content || "{}").replace(/```json|```/g, "").trim());

      // Rich log output
      const dirCol = sig.direction==="LONG"?"#00ff9d":sig.direction==="SHORT"?"#ff3355":"#ffcc00";
      addLog(`━━━ SCAN: ${sig.bias}(${sig.confidence}%) CS:${fv.confluenceScore}/100 → ${sig.direction} ━━━`, dirCol);
      if (sig.summary) addLog(`📊 ${sig.summary}`, "#e8f0f8");
      if (sig.keySignals?.length) sig.keySignals.forEach(s => addLog(`  ✓ ${s}`, "#00d4ff80"));
      if (sig.risks) addLog(`  ⚠ Risk: ${sig.risks}`, "#ff8c0080");
      if (sig.regime_note) addLog(`  📐 Regime: ${sig.regime_note}`, "#a855f780");
      if (sig.direction !== "WAIT") {
        const sl = sig.direction==="LONG" ? sig.sl_long : sig.sl_short;
        const tp = sig.direction==="LONG" ? sig.tp_long  : sig.tp_short;
        addLog(`  SL: ${sl} | TP: ${tp} | R:R ~2.2:1`, dirCol+"80");
      }

      // Use correct SL/TP based on direction
      sig.sl = sig.direction==="LONG" ? parseFloat(sig.sl_long||slLong) : parseFloat(sig.sl_short||slShort);
      sig.tp = sig.direction==="LONG" ? parseFloat(sig.tp_long||tpLong) : parseFloat(sig.tp_short||tpShort);

      // Check existing positions for this ticker and close if signal reverses
      const state = { ...paper };
      const existing = state.positions.filter(p => p.sym === ticker);
      for (const pos of existing) {
        if ((pos.dir === "LONG" && sig.direction === "SHORT") || (pos.dir === "SHORT" && sig.direction === "LONG") || sig.direction === "WAIT") {
          const pnlPct = pos.dir === "LONG" ? (price - pos.entry) / pos.entry * 100 : (pos.entry - price) / pos.entry * 100;
          const pnlDollar = pos.size * pos.entry * pnlPct / 100;
          state.capital += pos.size * pos.entry + pnlDollar;
          state.history = [{ ...pos, exitPrice: price, exitDate: new Date().toLocaleDateString(), pnlPct, pnlDollar, closedBy: sig.direction === "WAIT" ? "signal" : "reversal" }, ...state.history].slice(0, 100);
          state.positions = state.positions.filter(p => p.id !== pos.id);
          addLog(`CLOSED ${pos.dir} ${ticker} @ ${price.toFixed(4)} | P&L: ${pnlPct>=0?"+":""}${pnlPct.toFixed(2)}% ($${pnlDollar>=0?"+":""}${pnlDollar.toFixed(2)})`, pnlPct>=0?"#00ff9d":"#ff3355");
          // Record to AI memory
          const tradeFake = { sym: ticker, tf: tf.split("|")[0], dir: pos.dir, pnl: pnlDollar, pct: pnlPct, date: new Date().toLocaleDateString() };
          recordAIOutcome(tradeFake, { ...tempPred, bias: pos.dir==="LONG"?"BULLISH":"BEARISH", tf });
        }
      }

      // Open new position if signal meets thresholds and no conflicting position
      const hasPos = state.positions.some(p => p.sym === ticker);
      if (!hasPos && sig.direction !== "WAIT" && (sig.confidence||0) >= minConfPaper && fv.confluenceScore >= minCSPaper) {
        const riskDollar = state.capital * riskPct / 100;
        const slDist = Math.abs(price - parseFloat(sig.sl || price * 0.985));
        const size   = slDist > 0 ? riskDollar / slDist : 0;
        if (size > 0 && size * price <= state.capital * 0.5) {
          const pos = { id: Date.now(), sym: ticker, dir: sig.direction, entry: price, sl: parseFloat(sig.sl), tp: parseFloat(sig.tp), size, openDate: new Date().toLocaleDateString(), openTime: new Date().toLocaleTimeString(), reason: sig.reason, confluenceScore: fv.confluenceScore, confidence: sig.confidence };
          state.capital -= size * price;
          state.positions = [...state.positions, pos];
          addLog(`OPENED ${sig.direction} ${ticker} @ ${price.toFixed(4)} | SL:${sig.sl} TP:${sig.tp} | Size:${size.toFixed(3)} | CS:${fv.confluenceScore}`, sig.direction==="LONG"?"#00ff9d80":"#ff335580");
        } else {
          addLog(`Signal meets threshold but insufficient capital or size too large`, "#ffcc0080");
        }
      } else if (sig.direction !== "WAIT" && ((sig.confidence||0) < minConfPaper || fv.confluenceScore < minCSPaper)) {
        addLog(`Signal skipped: conf ${sig.confidence}%<${minConfPaper}% or CS ${fv.confluenceScore}<${minCSPaper}`, "#e8f0f8");
      }

      persist(state);
    } catch (e) { addLog(`Error: ${e.message}`, "#ff335580"); }
    finally { setScanning(false); }
  };

  // Auto-scan timer
  useEffect(() => {
    if (autoScan) { autoRef.current = setInterval(scanNow, 60000); addLog("Auto-scan enabled (every 60s)", "#00d4ff80"); }
    else { clearInterval(autoRef.current); if (autoScan === false) addLog("Auto-scan disabled", "#e8f0f8"); }
    return () => clearInterval(autoRef.current);
  }, [autoScan]);

  const totalValue = paper.positions.reduce((a, p) => a + p.size * (lastPrice || p.entry), 0);
  const totalPnl   = paper.positions.reduce((a, p) => {
    const price = lastPrice || p.entry;
    return a + (p.dir === "LONG" ? (price - p.entry) * p.size : (p.entry - price) * p.size);
  }, 0);
  const histPnl = paper.history.reduce((a, h) => a + (h.pnlDollar || 0), 0);
  const histWR  = paper.history.length ? (paper.history.filter(h => (h.pnlDollar||0) > 0).length / paper.history.length * 100).toFixed(0) : 0;

  const reset = () => {
    if (!window.confirm("Reset paper trading account? This clears all positions and history.")) return;
    const fresh = { positions: [], history: [], capital: 10000, startCapital: 10000 };
    persist(fresh);
    setLog([]);
    addLog("Account reset to $10,000", "#ffcc00");
  };

  return (
    <div style={{ padding: 12 }}>
      {/* Header stats */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        {[
          ["CAPITAL",     `$${paper.capital.toFixed(0)}`,  paper.capital >= paper.startCapital ? "#00ff9d" : "#ff3355"],
          ["INVESTED",    `$${totalValue.toFixed(0)}`,     "#00d4ff"],
          ["OPEN P&L",    `${totalPnl>=0?"+":""}$${totalPnl.toFixed(2)}`, totalPnl>=0?"#00ff9d":"#ff3355"],
          ["REALIZED",    `${histPnl>=0?"+":""}$${histPnl.toFixed(2)}`,   histPnl>=0?"#00ff9d":"#ff3355"],
          ["TOTAL",       `$${(paper.capital+totalValue).toFixed(0)}`,     paper.capital+totalValue >= paper.startCapital?"#00ff9d":"#ff3355"],
          ["LIVE WR",     `${histWR}%`,                    parseFloat(histWR)>=50?"#00ff9d":"#ff3355"],
          ["TRADES",      paper.history.length,            "#a855f7"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "#06060f", border: "1px solid #1f2535", borderRadius: 4, padding: "4px 10px" }}>
            <div style={{ fontSize: 7, color: "#e8f0f8" }}>{l}</div>
            <div style={{ fontSize: 13, fontWeight: "bold", color: c }}>{v}</div>
          </div>
        ))}
        <button onClick={reset} style={{ marginLeft: "auto", background: "#ff335510", border: "1px solid #ff335530", color: "#ff335570", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 8 }}>🗑 RESET</button>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10, background: "#06060f", border: "1px solid #1f2535", borderRadius: 5, padding: 10 }}>
        <div>
          <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>MIN CONFLUENCE</div>
          <select value={minCSPaper} onChange={e => setMinCSPaper(+e.target.value)} style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "4px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 9 }}>
            {[0,25,35,50,60,70].map(v=><option key={v} value={v}>CS ≥ {v}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>MIN CONFIDENCE</div>
          <select value={minConfPaper} onChange={e => setMinConfPaper(+e.target.value)} style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "4px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 9 }}>
            {[0,50,60,65,70,75,80].map(v=><option key={v} value={v}>Conf ≥ {v}%</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 8, color: "#e8f0f8", marginBottom: 3 }}>RISK PER TRADE</div>
          <select value={riskPct} onChange={e => setRiskPct(+e.target.value)} style={{ background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "4px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 9 }}>
            {[0.5,1,1.5,2,3].map(v=><option key={v} value={v}>{v}% of capital</option>)}
          </select>
        </div>
        <button onClick={scanNow} disabled={scanning || !groqKey || !candles.length}
          style={{ background: "#00ff9d18", border: "1px solid #00ff9d40", color: "#00ff9d", padding: "5px 14px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 9, fontWeight: "bold" }}>
          {scanning ? "⟳ SCANNING..." : "🔍 SCAN NOW"}
        </button>
        <label style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer", fontSize: 9, color: autoScan?"#00ff9d":"#e8f0f8", border: `1px solid ${autoScan?"#00ff9d30":"#6a7a9a"}`, padding: "4px 10px", borderRadius: 4 }}>
          <input type="checkbox" checked={autoScan} onChange={e => setAutoScan(e.target.checked)} />
          AUTO-SCAN (60s)
        </label>
        {!groqKey && <span style={{ fontSize: 8, color: "#ffcc0080" }}>⚠ Set Groq key</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {/* Open positions */}
        <div>
          <div style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 2, marginBottom: 6 }}>OPEN POSITIONS ({paper.positions.length})</div>
          {paper.positions.length === 0 ? <div style={{ color: "#6a7a9a", fontSize: 9 }}>No open positions. Click Scan Now to analyze current chart.</div> :
            paper.positions.map(p => {
              const price   = p.sym === ticker ? (lastPrice || p.entry) : p.entry;
              const pnlPct  = p.dir === "LONG" ? (price - p.entry) / p.entry * 100 : (p.entry - price) / p.entry * 100;
              const pnlDollar = p.size * p.entry * pnlPct / 100;
              return (
                <div key={p.id} style={{ background: "#06060f", border: `1px solid ${pnlPct>=0?"#00ff9d20":"#ff335520"}`, borderRadius: 5, padding: "8px 10px", marginBottom: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div><span style={{ fontWeight: "bold", color: "#e8f0f8" }}>{p.sym}</span> <span style={{ color: p.dir==="LONG"?"#00ff9d":"#ff3355", fontSize: 9 }}>{p.dir}</span> <span style={{ fontSize: 8, color: "#a855f7" }}>CS:{p.confluenceScore}</span></div>
                    <div style={{ fontWeight: "bold", color: pnlPct>=0?"#00ff9d":"#ff3355" }}>{pnlPct>=0?"+":""}${pnlDollar.toFixed(2)} ({pnlPct>=0?"+":""}{ pnlPct.toFixed(2)}%)</div>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 8, color: "#5a6a80" }}>
                    <span>Entry: {p.entry.toFixed(4)}</span><span>Live: {price.toFixed(4)}</span>
                    <span style={{ color: "#ff335580" }}>SL: {p.sl?.toFixed(4)}</span>
                    <span style={{ color: "#00ff9d80" }}>TP: {p.tp?.toFixed(4)}</span>
                  </div>
                  <div style={{ fontSize: 8, color: "#5a6a8a", marginTop: 2 }}>{p.reason} · {p.openTime}</div>
                </div>
              );
            })}
        </div>

        {/* Activity log */}
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:8, color:"#e8f0f8", letterSpacing:2 }}>SCAN INTELLIGENCE LOG</span>
            {log.length > 0 && <button onClick={()=>setLog([])} style={{ background:"none", border:"none", color:"#e8f0f8", cursor:"pointer", fontSize:8 }}>CLEAR</button>}
          </div>
          <div style={{ background:"#04040c", borderRadius:4, padding:6, maxHeight:340, overflowY:"auto" }}>
            {log.length === 0 && (
              <div style={{ color:"#6a7a9a", fontSize:8, lineHeight:1.9 }}>
                {["Scan intelligence log will appear here.","","Each scan sends the AI:","→ All SMC signals with context","→ Candle patterns classified","→ Divergences with meaning","→ Fibonacci levels","→ Volume profile (VPOC)","→ Market regime","→ Learned memory from past trades"].map(l=><div key={l}>{l}</div>)}
              </div>
            )}
            {log.map((l, i) => {
              const isHeader = l.msg.startsWith("━━━");
              const isDetail = l.msg.startsWith("  ");
              return (
                <div key={i} style={{ fontSize:isHeader?9:8, fontWeight:isHeader?"bold":"normal", color:l.col, lineHeight:1.7, borderBottom:isHeader?"1px solid #6a7a9a":"1px solid #06060f", padding:isHeader?"5px 0":"1px 0", marginTop:isHeader?8:0, paddingLeft:isDetail?10:0 }}>
                  {isHeader ? l.msg : <><span style={{ color:"#6a7a9a", marginRight:5, fontSize:7 }}>{l.ts}</span>{l.msg}</>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Trade history */}
      {paper.history.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 2, marginBottom: 6 }}>CLOSED TRADES ({paper.history.length})</div>
          <div style={{ background: "#04040c", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "60px 55px 70px 70px 70px 70px 1fr", padding: "4px 8px", borderBottom: "1px solid #1f2535" }}>
              {["DATE","DIR","ENTRY","EXIT","P&L%","P&L$","CLOSED BY"].map((h,i)=><div key={i} style={{fontSize:7,color:"#e8f0f8"}}>{h}</div>)}
            </div>
            <div style={{ maxHeight: 180, overflowY: "auto" }}>
              {paper.history.map((h, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 55px 70px 70px 70px 70px 1fr", padding: "5px 8px", borderBottom: "1px solid #08081a", background: (h.pnlDollar||0)>=0?"#001508":"#06060f", alignItems: "center" }}>
                  <span style={{ fontSize: 8, color: "#5a6a80" }}>{h.exitDate}</span>
                  <span style={{ fontSize: 8, color: h.dir==="LONG"?"#00ff9d":"#ff3355" }}>{h.dir}</span>
                  <span style={{ fontSize: 8, color: "#e8f0f8" }}>{h.entry?.toFixed(4)}</span>
                  <span style={{ fontSize: 8, color: "#e8f0f8" }}>{h.exitPrice?.toFixed(4)}</span>
                  <span style={{ fontSize: 9, fontWeight:"bold", color: h.pnlPct>=0?"#00ff9d":"#ff3355" }}>{h.pnlPct>=0?"+":""}{h.pnlPct?.toFixed(2)}%</span>
                  <span style={{ fontSize: 9, color: h.pnlDollar>=0?"#00ff9d":"#ff3355" }}>{h.pnlDollar>=0?"+":""}${h.pnlDollar?.toFixed(2)}</span>
                  <span style={{ fontSize: 8, color: "#5a6a8a" }}>{h.closedBy} · {h.reason}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ================================================================
// CONSTANTS
// ================================================================
const TIMEFRAMES = [
  { label: "15M", val: "15m|5d" }, { label: "1H", val: "60m|1mo" },
  { label: "4H", val: "90m|2mo" }, { label: "1D", val: "1d|3mo" },
  { label: "1W", val: "1wk|2y" }, { label: "1M", val: "1mo|5y" },
];
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama3-70b-8192", "llama3-8b-8192", "mixtral-8x7b-32768", "gemma2-9b-it"];
const sigCol = { bullish: "#00ff9d", bearish: "#ff3355", neutral: "#ffcc00" };
const typeIcon = { FVG_BULL: "📊", FVG_BEAR: "📊", OB_BULL: "🟩", OB_BEAR: "🟥", LIQ_BEAR: "🪤", LIQ_BULL: "🪤", BOS_BULL: "📈", BOS_BEAR: "📉" };
const BOTTOM_TABS = [
  { id: "watchlist", label: "👁 WATCHLIST" },
  { id: "portfolio", label: "💼 PORTFOLIO" },
  { id: "alerts", label: "🔔 ALERTS" },
  { id: "news", label: "📰 NEWS" },
  { id: "mtf", label: "📐 MTF" },
  { id: "journal", label: "📓 JOURNAL" },
  { id: "screener", label: "🔎 SCREENER" },
  { id: "memory", label: "🧠 AI MEMORY" },
  { id: "backtest", label: "⏪ BACKTEST" },
  { id: "paper", label: "📄 PAPER TRADE" },
];

// ================================================================
// MAIN APP
// ================================================================
export default function NexusTrader() {
  const [ticker, setTicker] = useState("AAPL");
  const [tf, setTf] = useState("1d|3mo");
  const [groqKey, setGroqKey] = useState("");
  const [groqModel, setGroqModel] = useState("llama-3.3-70b-versatile");
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [indicators, setIndicators] = useState({ sma20: true, sma50: false, sma200: false, bb: false, fib: true, div: true, sr: true, vol: true, vwap: false, pivots: false, vp: false });
  const [subChart, setSubChart] = useState("rsi");
  const [bottomTab, setBottomTab] = useState("watchlist");
  const [bottomOpen, setBottomOpen] = useState(true);
  const [drawTool, setDrawTool] = useState("none"); // none | hline | tline | ray
  const [drawings, setDrawings] = useState(() => { try { return JSON.parse(localStorage.getItem("nx_drawings") || "{}"); } catch { return {}; } });
  const [chatOpen, setChatOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const drawKey = `${ticker}-${tf}`;
  const activeDrawings = drawings[drawKey] || [];
  const saveDrawings = (key, arr) => { const next = { ...drawings, [key]: arr }; setDrawings(next); try { localStorage.setItem("nx_drawings", JSON.stringify(next)); } catch {} };
  const addDrawing = (d) => saveDrawings(drawKey, [...activeDrawings, d]);
  const deleteDrawing = (id) => saveDrawings(drawKey, activeDrawings.filter(d => d.id !== id));
  const clearDrawings = () => saveDrawings(drawKey, []);

  const analysis = useMemo(() => {
    if (!candles.length) return null;
    const cls = candles.map(c => c.close);
    const s20 = sma(cls, 20), s50 = sma(cls, 50), s200 = sma(cls, 200);
    const rsiarr = calcRSI(cls), macdarr = calcMACD(cls), bbarr = calcBB(cls), atrarr = calcATR(candles);
    const patterns = detectCandlePatterns(candles), smcSigs = detectSMC(candles), srLvls = detectSR(candles), chartPatterns = detectChartPatterns(candles);
    const chartData = candles.map((c, i) => ({ ...c, sma20: s20[i], sma50: s50[i], rsi: rsiarr[i], macd: macdarr.ml[i], macdSig: macdarr.sig[i], macdHist: macdarr.hist[i] }));
    const fib = calcFib(candles);
    const divergences = detectDivergence(candles, rsiarr, macdarr.hist);
    const vwap = calcVWAP(candles);
    const pivots = calcPivots(candles);
    const volProfile = calcVolumeProfile(candles);
    const regime     = detectRegime(candles, rsiarr, atrarr);
    return { s20, s50, s200, rsiarr, macdarr, bbarr, atrarr, patterns, smcSigs, srLvls, chartPatterns, chartData, fib, divergences, vwap, pivots, volProfile, regime };
  }, [candles]);

  const checkPendingOutcomes = useCallback((newCandles, sym, timeframe) => {
    try {
      const pending = JSON.parse(localStorage.getItem("nx_pending") || "[]");
      if (!pending.length) return;
      const key = `${sym.toUpperCase()}-${timeframe.split("|")[0]}`;
      const toGrade = pending.filter(p => p.key === key);
      if (!toGrade.length) return;
      const keep = pending.filter(p => p.key !== key);
      toGrade.forEach(p => {
        const ei = newCandles.findIndex(c => c.ts >= p.ts);
        if (ei < 0) { keep.push(p); return; }
        const evalI = ei + p.evalBars;
        if (evalI >= newCandles.length) { keep.push(p); return; }
        const entryPrice = newCandles[ei].close, evalPrice = newCandles[evalI].close;
        const pnlPct = p.direction === "LONG" ? (evalPrice-entryPrice)/entryPrice*100 : p.direction === "SHORT" ? (entryPrice-evalPrice)/entryPrice*100 : 0;
        if (p.direction !== "WAIT") recordAIOutcome({ sym: sym.toUpperCase(), tf: timeframe.split("|")[0], dir: p.direction, pnl: pnlPct, pct: pnlPct, date: newCandles[ei].date }, p.prediction);
      });
      localStorage.setItem("nx_pending", JSON.stringify(keep.slice(0, 50)));
    } catch {}
  }, []);

  const scheduleOutcomeCheck = useCallback((prediction, sym, timeframe) => {
    try {
      const pending = JSON.parse(localStorage.getItem("nx_pending") || "[]");
      pending.unshift({ key:`${sym.toUpperCase()}-${timeframe.split("|")[0]}`, ts: Date.now(), direction: prediction.setup?.direction||"WAIT", evalBars:10, prediction });
      localStorage.setItem("nx_pending", JSON.stringify(pending.slice(0, 50)));
    } catch {}
  }, []);

  const fetchData = async (sym = ticker) => {
    if (!sym.trim()) return;
    setLoading(true); setError(""); setAiResult(null);
    try {
      const [interval, range] = tf.split("|");
      const { candles: raw } = await fetchYahoo(sym, interval, range);
      setCandles(raw);
      checkPendingOutcomes(raw, sym, tf);
    } catch (e) { setError(e.message || "Fetch failed"); }
    finally { setLoading(false); }
  };

  const loadFromWatchlist = (sym) => { setTicker(sym); setTimeout(() => fetchData(sym), 50); };

  // Search debounce effect
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        try {
          const results = await searchStocks(searchQuery);
          setSearchResults(results);
          setShowSearch(true);
        } catch {}
      } else {
        setSearchResults([]);
        setShowSearch(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Keyboard shortcuts
  useEffect(() => {
    const TOOLS = { h: "hline", t: "tline", r: "ray" };
    const TFS   = { "1": "15m|5d", "2": "60m|1mo", "3": "90m|2mo", "4": "1d|3mo", "5": "1wk|2y", "6": "1mo|5y" };
    const handler = (e) => {
      if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
      const k = e.key;
      if (k === "f" || k === "F") { fetchData(); return; }
      if (k === "a" || k === "A") { analyzeWithGroq(); return; }
      if (k === "Escape") { setDrawTool("none"); setShowSearch(false); return; }
      if (k === "x" || k === "X") { clearDrawings(); return; }
      if (k === "c" || k === "C") { setChatOpen(o => !o); return; }
      if (TOOLS[k]) { setDrawTool(t => t === TOOLS[k] ? "none" : TOOLS[k]); return; }
      if (TFS[k])   { setTf(TFS[k]); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [candles, analysis, groqKey]);

  const analyzeWithGroq = async () => {
    if (!groqKey.trim()) { setError("Enter your Groq API key in ⚙ Settings"); return; }
    if (!candles.length || !analysis) { setError("Fetch data first"); return; }
    setAiLoading(true); setAiResult(null); setError("");
    try {
      const n = candles.length, last = candles[n - 1], prev = candles[n - 2];
      const pct = ((last.close - prev.close) / prev.close * 100).toFixed(2);
      const lastRSI = analysis.rsiarr.filter(v => v !== null).slice(-1)[0];
      const lastMACD = analysis.macdarr.ml.filter(v => v !== null).slice(-1)[0];
      const lastSig = analysis.macdarr.sig.filter(v => v !== null).slice(-1)[0];
      const lastBB = analysis.bbarr.filter(v => v.u).slice(-1)[0];
      const lastSMA20 = analysis.s20.filter(v => v).slice(-1)[0], lastSMA50 = analysis.s50.filter(v => v).slice(-1)[0], lastSMA200 = analysis.s200.filter(v => v).slice(-1)[0], lastATR = analysis.atrarr.filter(v => v).slice(-1)[0];
      const recentPats = [...new Set(analysis.patterns.slice(-10).map(p => `${p.name}(${p.sig})`))].join(", ");
      const chartPats = analysis.chartPatterns.slice(-4).map(p => `${p.name}(${p.sig})`).join(", ");
      const smcStr = [...new Set(analysis.smcSigs.slice(-8).map(s => s.label))].join(", ");
      const srStr = analysis.srLvls.map(l => `${l.t}@${l.p < 10 ? l.p.toFixed(5) : l.p.toFixed(2)}`).join(", ");
      const fibStr = analysis.fib ? `Fib (${analysis.fib.uptrend ? "uptrend" : "downtrend"} swing): ${analysis.fib.levels.filter(l => !l.ext).map(l => `${l.label}=${l.price < 10 ? l.price.toFixed(5) : l.price.toFixed(2)}`).join(", ")}` : "N/A";
      const divStr = analysis.divergences.length ? analysis.divergences.map(d => `${d.label} [${d.idx2 - d.idx1}bars ago]`).join(", ") : "none";
      // Regime, VPOC, MTF
      const _regime = analysis.regime || {};
      const regimeStr = _regime.regime ? `${_regime.regime.toUpperCase()}(${_regime.sub||""}) conf:${_regime.confidence}% — ${_regime.detail}` : "unknown";
      const _vp = analysis.volProfile;
      const vpocStr2 = _vp ? `VPOC:${_vp.vpoc.price<10?_vp.vpoc.price.toFixed(5):_vp.vpoc.price.toFixed(2)} VAH:${_vp.vah<10?_vp.vah.toFixed(5):_vp.vah.toFixed(2)} VAL:${_vp.val<10?_vp.val.toFixed(5):_vp.val.toFixed(2)} AT:${vpocState(last.close,_vp)}` : "N/A";
      const mtfQuick = (() => { const _c=candles.map(c=>c.close); const _r=calcRSI(_c).filter(v=>v).slice(-1)[0]; const _mh=calcMACD(_c).hist.filter(v=>v).slice(-1)[0]; const _s20=sma(_c,20).filter(v=>v).slice(-1)[0]; const _s50=sma(_c,50).filter(v=>v).slice(-1)[0]; const _s200=sma(_c,200).filter(v=>v).slice(-1)[0]; return `RSI:${_r?.toFixed(0)} MACD:${_mh>0?"BULL":"BEAR"} Trend:${trendState(_s20,_s50,_s200,last.close)} SMA20:${last.close>_s20?"↑":"↓"} SMA50:${last.close>_s50?"↑":"↓"} SMA200:${last.close>_s200?"↑":"↓"}`; })();
      const last10 = candles.slice(-10).map(c => `[${c.date}] O:${c.open?.toFixed(4)} H:${c.high?.toFixed(4)} L:${c.low?.toFixed(4)} C:${c.close?.toFixed(4)} V:${c.volume > 1e6 ? (c.volume / 1e6).toFixed(1) + "M" : c.volume}`).join("\n");
      const bbPos = lastBB ? (last.close > lastBB.u ? "ABOVE UPPER" : last.close < lastBB.l ? "BELOW LOWER" : last.close > lastBB.m ? "UPPER HALF" : "LOWER HALF") : "N/A";
      const currentFV = buildFeatureVector({
        bias: aiResult?.bias || "NEUTRAL",
        confidence: aiResult?.confidence || 50,
        rsiAtSignal: lastRSI,
        macdHistAtSignal: lastMACDHist,
        trendAtSignal: trendState(lastSMA20, lastSMA50, analysis.s200.filter(v=>v).slice(-1)[0], last.close),
        atrStateAtSignal: atrState(lastATR, last.close),
        volumeStateAtSignal: volumeState(candles, candles.length - 1),
        patterns: recentPats,
        smcSignals: smcStr,
        hasDivergence: analysis.divergences.length > 0,
        divType: analysis.divergences[0]?.type || "none",
        nearFib: analysis.fib ? analysis.fib.levels.some(l => Math.abs(last.close - l.price) / last.close < 0.015) : false,
        nearFibRatio: analysis.fib ? analysis.fib.levels.find(l => Math.abs(last.close - l.price) / last.close < 0.015)?.ratio ?? null : null,
        atSR: analysis.srLvls.some(l => Math.abs(last.close - l.p) / last.close < 0.01),
        srStrength: Math.max(0, ...analysis.srLvls.filter(l => Math.abs(last.close - l.p) / last.close < 0.01).map(l => l.s || 0)),
        setup: aiResult?.setup || {},
        regime: _regime?.regime || "unknown",
        regimeSub: _regime?.sub || "",
        regimeConf: _regime?.confidence || 0,
        volProfile: analysis.volProfile,
        price: last.close,
      }, null);
      const memoryCtx = buildMemoryContext(ticker, tf, currentFV);
      const prompt = `You are NEXUS — elite quantitative trader, Smart Money expert.
ASSET: ${ticker.toUpperCase()} | TF: ${tf.replace("|", " ")} | PRICE: ${last.close?.toFixed(4)} | CHANGE: ${pct}%
OHLCV:\n${last10}
RSI: ${lastRSI?.toFixed(2)} | MACD: ${lastMACD?.toFixed(5)} vs ${lastSig?.toFixed(5)} | BB: ${bbPos}
SMA20: ${lastSMA20?.toFixed(4)} | SMA50: ${lastSMA50?.toFixed(4)} | SMA200: ${lastSMA200?.toFixed(4)} | ATR: ${lastATR?.toFixed(4)}
Candle: ${recentPats || "none"} | Chart: ${chartPats || "none"} | SMC: ${smcStr || "none"} | S/R: ${srStr}
Fib: ${fibStr} | Divergences: ${divStr}
REGIME: ${regimeStr}
VPOC: ${vpocStr2}
MTF: ${mtfQuick}
${memoryCtx ? memoryCtx + "\n" : ""}Reply ONLY raw JSON: {"bias":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"summary":"...","trend":{"short":"...","medium":"...","long":"..."},"setup":{"direction":"LONG"|"SHORT"|"WAIT","entry":"...","stopLoss":"...","tp1":"...","tp2":"...","rr":"1:X","rationale":"..."},"keyLevels":["...","...","..."],"smartMoney":"...","indicators":{"rsi":"...","macd":"...","bollinger":"...","volume":"..."},"risks":"...","watch":"..."}`;
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
        body: JSON.stringify({ model: groqModel, messages: [{ role: "system", content: "You are NEXUS. Reply ONLY raw JSON." }, { role: "user", content: prompt }], temperature: 0.3, max_tokens: 2000 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      try {
          const parsed = JSON.parse((data.choices?.[0]?.message?.content || "{}").replace(/```json|```/g, "").trim());
          // Tag with RSI at time of signal for memory
          parsed.rsiAtSignal        = lastRSI;
          parsed.macdHistAtSignal   = lastMACDHist;
          parsed.trendAtSignal      = trendState(lastSMA20, lastSMA50, analysis.s200.filter(v=>v).slice(-1)[0], last.close);
          parsed.atrStateAtSignal   = atrState(lastATR, last.close);
          parsed.volumeStateAtSignal= volumeState(candles, candles.length - 1);
          parsed.hasDivergence      = analysis.divergences.length > 0;
          parsed.divType            = analysis.divergences[0]?.type || "none";
          parsed.nearFib            = analysis.fib ? analysis.fib.levels.some(l => Math.abs(last.close - l.price)/last.close < 0.015) : false;
          parsed.nearFibRatio       = analysis.fib ? (analysis.fib.levels.find(l => Math.abs(last.close - l.price)/last.close < 0.015)?.ratio ?? null) : null;
          parsed.atSR               = analysis.srLvls.some(l => Math.abs(last.close - l.p)/last.close < 0.01);
          parsed.srStrength         = Math.max(0, ...analysis.srLvls.filter(l => Math.abs(last.close - l.p)/last.close < 0.01).map(l => l.s||0));
          parsed.smcSignals         = smcStr;
          parsed.patterns           = recentPats;
          parsed.ticker             = ticker;
          parsed.tf                 = tf;
          // Build full feature vector immediately so memory stores rich data
          const predFV = buildFeatureVector(parsed, null);
          parsed.bucketAtSignal     = predFV.bucketKey;
          parsed.confluenceScore    = predFV.confluenceScore;
          parsed.regime             = _regime?.regime || "unknown";
          parsed.regimeSub          = _regime?.sub || "";
          parsed.regimeConf         = _regime?.confidence || 0;
          parsed.volProfile         = analysis.volProfile;
          parsed.price              = last.close;
          setAiResult(parsed);
          // Store last prediction for journal-memory linkage
          try { localStorage.setItem("nx_last_prediction_" + ticker, JSON.stringify({ ...parsed, ticker, tf, date: new Date().toLocaleDateString() })); } catch {}
          scheduleOutcomeCheck(parsed, ticker, tf);
        }
      catch { setAiResult({ bias: "NEUTRAL", confidence: 0, summary: data.choices?.[0]?.message?.content, setup: { direction: "WAIT" } }); }
    } catch (e) { setError("Groq: " + (e.message || "Unknown")); }
    finally { setAiLoading(false); }
  };

  const last = candles.length ? candles[candles.length - 1] : null;
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;
  const pctChange = last && prev ? ((last.close - prev.close) / prev.close * 100) : 0;
  const lastRSI = analysis?.rsiarr.filter(v => v !== null).slice(-1)[0];
  const lastMACDHist = analysis?.macdarr.hist.filter(v => v !== null).slice(-1)[0];
  const biasColor = aiResult?.bias === "BULLISH" ? "#00ff9d" : aiResult?.bias === "BEARISH" ? "#ff3355" : "#ffcc00";

  const S = {
    wrap: { background: "linear-gradient(135deg,#04040c 0%,#060611 100%)", minHeight: "100vh", width: "100%", maxWidth: "100vw", overflowX: "hidden", color: "#e8f0f8", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, boxSizing: "border-box" },
    header: { background: "#06060f", borderBottom: "1px solid #1f2535", padding: "6px 10px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%", boxSizing: "border-box" },
    logoText: { fontSize: 15, fontWeight: "bold", letterSpacing: 3, background: "linear-gradient(90deg,#00ff9d,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
    tickerInput: { background: "#0a0a1a", border: "1px solid #6a7a9a", color: "#00ff9d", padding: "5px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 13, fontWeight: "bold", width: 85, textTransform: "uppercase", letterSpacing: 2 },
    tfBtn: (a) => ({ background: a ? "#0f2040" : "transparent", border: `1px solid ${a ? "#00d4ff" : "#6a7a9a"}`, color: a ? "#00d4ff" : "#5a6a8a", padding: "3px 6px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "monospace" }),
    btn: (col = "#00d4ff") => ({ background: `${col}15`, border: `1px solid ${col}55`, color: col, padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 11, fontWeight: "bold", letterSpacing: 1 }),
    panel: { background: "#06060f", border: "1px solid #1f2535", borderRadius: 6 },
    panelHead: { padding: "6px 10px", borderBottom: "1px solid #1f2535", fontSize: 10, color: "#e8f0f8", letterSpacing: 2 },
    badge: (sig) => ({ display: "inline-block", background: `${sigCol[sig] || "#888"}18`, border: `1px solid ${sigCol[sig] || "#888"}40`, color: sigCol[sig] || "#888", padding: "2px 6px", borderRadius: 3, fontSize: 10, margin: "2px" }),
    stat: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 10px", borderBottom: "1px solid #0a0a1a" },
    inp: { background: "#04040c", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "6px 10px", borderRadius: 4, fontFamily: "monospace", fontSize: 12, width: "100%", boxSizing: "border-box" },
  };

  return (
    <div style={S.wrap}>
      {/* HEADER */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 6 }}>
          <div style={{ width: 28, height: 28, background: "linear-gradient(135deg,#00ff9d,#00d4ff)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🔮</div>
          <span style={S.logoText}>NEXUS</span>
          <span style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1 }}>AI TRADER v2</span>
        </div>
        <div style={{ position: "relative" }}>
          <input 
            value={ticker} 
            onChange={(e) => { setTicker(e.target.value.toUpperCase()); setSearchQuery(e.target.value); }} 
            onKeyDown={e => e.key === "Enter" && fetchData()} 
            onFocus={() => searchQuery.length >= 2 && setShowSearch(true)}
            style={S.tickerInput} 
            placeholder="AAPL or search..." 
          />
          {showSearch && searchResults.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 1000, background: "#0a0a1a", border: "1px solid #6a7a9a", borderRadius: 4, minWidth: 200, maxWidth: 300, maxHeight: 300, overflowY: "auto" }}>
              {searchResults.map((r, i) => (
                <div 
                  key={i} 
                  onClick={() => { setTicker(r.symbol); setSearchQuery(""); setShowSearch(false); setTimeout(() => fetchData(r.symbol), 50); }}
                  style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #1f2535", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onMouseOver={(e) => e.currentTarget.style.background = "#0f2040"}
                  onMouseOut={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ color: "#00ff9d", fontWeight: "bold", fontSize: 12 }}>{r.symbol}</span>
                  <span style={{ color: "#e8f0f8", fontSize: 10 }}>{r.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>{TIMEFRAMES.map(t => <button key={t.val} style={S.tfBtn(tf === t.val)} onClick={() => setTf(t.val)}>{t.label}</button>)}</div>
        <button style={S.btn("#00d4ff")} onClick={() => fetchData()} disabled={loading}>{loading ? "⟳ LOADING..." : "⬇ FETCH"}</button>
        {candles.length > 0 && <button style={S.btn(aiLoading ? "#ffcc00" : "#00ff9d")} onClick={analyzeWithGroq} disabled={aiLoading}>{aiLoading ? "⟳ ANALYZING..." : "🧠 AI ANALYZE"}</button>}
        <button style={{ ...S.btn("#5a6a8a"), marginLeft: "auto" }} onClick={() => setShowSettings(true)}>⚙ API KEYS</button>
        <div style={{ fontSize: 7, color: "#6a7a9a", lineHeight: 1.6, display: "none" }} className="kbd-hints">F=Fetch A=AI 1-6=TF H/T/R=Draw C=Chat X=Clear ESC=Cancel</div>
        {last && <div style={{ textAlign: "right", lineHeight: 1.4 }}>
          <div style={{ fontSize: 16, fontWeight: "bold", color: pctChange >= 0 ? "#00ff9d" : "#ff3355" }}>{last.close?.toFixed(4)}</div>
          <div style={{ fontSize: 10, color: pctChange >= 0 ? "#00ff9d" : "#ff3355" }}>{pctChange >= 0 ? "▲" : "▼"} {Math.abs(pctChange).toFixed(2)}%</div>
        </div>}
      </div>

      {error && <div style={{ background: "#ff335518", border: "1px solid #ff335540", color: "#ff3355", padding: "8px 16px", fontSize: 11 }}>⚠ {error} <button onClick={() => setError("")} style={{ background: "none", border: "none", color: "#ff3355", cursor: "pointer", float: "right" }}>✕</button></div>}

      {/* MAIN 3-COL GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 260px", gap: 6, padding: 4, width: "100%", boxSizing: "border-box" }}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {last && analysis && (
            <div style={S.panel}>
              <div style={S.panelHead}>LIVE DATA</div>
              {[["PRICE", last.close?.toFixed(4), pctChange >= 0 ? "#00ff9d" : "#ff3355"], ["OPEN", last.open?.toFixed(4), "#e8f0f8"], ["HIGH", last.high?.toFixed(4), "#00ff9d"], ["LOW", last.low?.toFixed(4), "#ff3355"], ["VOLUME", last.volume > 1e6 ? (last.volume / 1e6).toFixed(1) + "M" : last.volume?.toLocaleString(), "#00d4ff"], ["RSI(14)", lastRSI?.toFixed(1), lastRSI > 70 ? "#ff3355" : lastRSI < 30 ? "#00ff9d" : "#ffcc00"], ["MACD", lastMACDHist > 0 ? "▲ BULL" : "▼ BEAR", lastMACDHist > 0 ? "#00ff9d" : "#ff3355"]].map(([k, v, col]) => (
                <div key={k} style={S.stat}><span style={{ color: "#e8f0f8", fontSize: 9, letterSpacing: 1 }}>{k}</span><span style={{ color: col, fontWeight: "bold", fontSize: 11 }}>{v}</span></div>
              ))}
              {[["SMA20", analysis.s20], ["SMA50", analysis.s50]].map(([label, arr]) => {
                const val = arr.filter(v => v).slice(-1)[0] || 0;
                return <div key={label} style={S.stat}><span style={{ color: "#e8f0f8", fontSize: 9, letterSpacing: 1 }}>{label}</span><span style={{ color: last.close > val ? "#00ff9d" : "#ff3355", fontSize: 10 }}>{last.close > val ? "↑ ABOVE" : "↓ BELOW"}</span></div>;
              })}
            </div>
          )}
          <div style={S.panel}>
            <div style={S.panelHead}>CANDLE PATTERNS</div>
            <div style={{ padding: 8, maxHeight: 160, overflowY: "auto" }}>
              {!analysis?.patterns.length ? <div style={{ color: "#e8f0f8", fontSize: 10 }}>No patterns yet</div>
                : analysis.patterns.slice(-6).reverse().map((p, i) => <div key={i} style={{ marginBottom: 3 }}><span style={S.badge(p.sig)}>{p.sig === "bullish" ? "▲" : p.sig === "bearish" ? "▼" : "◆"} {p.name}</span></div>)}
            </div>
          </div>
          {analysis?.chartPatterns.length > 0 && (
            <div style={S.panel}><div style={S.panelHead}>CHART PATTERNS</div><div style={{ padding: 8 }}>{analysis.chartPatterns.slice(-4).map((p, i) => <div key={i} style={{ marginBottom: 3 }}><span style={S.badge(p.sig)}>{p.sig === "bullish" ? "▲" : "▼"} {p.name}</span></div>)}</div></div>
          )}
          {/* REGIME BADGE */}
          {analysis?.regime && analysis.regime.regime !== "unknown" && (
            <div style={{ background:"#06060f", border:`1px solid ${analysis.regime.regime==="trending"?"#00ff9d30":analysis.regime.regime==="volatile"?"#ff335530":analysis.regime.regime==="squeeze"?"#ffcc0030":"#1f2535"}`, borderRadius:6 }}>
              <div style={{ padding:"7px 12px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                  <span style={{ fontSize:8, color:"#e8f0f8", letterSpacing:2 }}>REGIME</span>
                  <span style={{ fontSize:10, fontWeight:"bold", color:analysis.regime.regime==="trending"?"#00ff9d":analysis.regime.regime==="volatile"?"#ff3355":analysis.regime.regime==="squeeze"?"#ffcc00":"#e8f0f8" }}>
                    {analysis.regime.regime.toUpperCase()}{analysis.regime.sub?` · ${analysis.regime.sub}`:""}
                  </span>
                  <span style={{ fontSize:8, color:"#e8f0f8" }}>{analysis.regime.confidence}%</span>
                </div>
                <div style={{ fontSize:8, color:"#5a6a60", lineHeight:1.5 }}>{analysis.regime.detail}</div>
                <div style={{ display:"flex", gap:8, marginTop:4, fontSize:8, color:"#e8f0f8" }}>
                  <span>ATR {analysis.regime.atrPct}%</span>
                  <span>Dir {(parseFloat(analysis.regime.dirRatio||0)*100).toFixed(0)}%</span>
                  {analysis.regime.squeeze && <span style={{ color:"#ffcc00" }}>⚡SQUEEZE</span>}
                </div>
              </div>
            </div>
          )}

          {/* DIVERGENCES */}
          {analysis?.divergences?.length > 0 && (
            <div style={S.panel}>
              <div style={S.panelHead}>⚡ DIVERGENCES</div>
              <div style={{ padding: 8 }}>
                {analysis.divergences.map((d, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 4px", borderBottom: "1px solid #08081a", alignItems: "center" }}>
                    <span style={{ color: d.color, fontSize: 10, fontWeight: "bold" }}>{d.label}</span>
                    <span style={{ color: "#e8f0f8", fontSize: 8 }}>{d.idx2 - d.idx1}b ago</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FIB LEVELS */}
          {analysis?.fib && indicators.fib && (
            <div style={S.panel}>
              <div style={S.panelHead}>📐 FIB LEVELS {analysis.fib.uptrend ? "↑" : "↓"}</div>
              <div style={{ padding: 8 }}>
                {analysis.fib.levels.filter(l => !l.ext).map((lv, i) => {
                  const price = last?.close ?? null;
                  const isCurrent = price && Math.abs(price - lv.price) / lv.price < 0.015;
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 4px", borderBottom: "1px solid #08081a", background: isCurrent ? "#ffffff08" : "transparent" }}>
                      <span style={{ color: lv.color, fontSize: 9 }}>{lv.label}</span>
                      <span style={{ color: isCurrent ? "#ffffff" : "#e8f0f8", fontSize: 10, fontWeight: isCurrent ? "bold" : "normal" }}>{lv.price < 10 ? lv.price.toFixed(5) : lv.price.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={S.panel}>
            <div style={S.panelHead}>SMART MONEY</div>
            <div style={{ padding: 8, maxHeight: 180, overflowY: "auto" }}>
              {!analysis?.smcSigs.length ? <div style={{ color: "#e8f0f8", fontSize: 10 }}>No SMC signals</div>
                : analysis.smcSigs.slice(-6).reverse().map((s, i) => {
                  const isBull = s.type?.includes("BULL") || s.type?.includes("LIQ_BULL");
                  return <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid #0a0a1a" }}>
                    <span style={{ fontSize: 9, color: "#e8f0f8" }}>{typeIcon[s.type] || "◆"} </span>
                    <span style={{ color: isBull ? "#00ff9d" : "#ff3355", fontSize: 10 }}>{s.label}</span>
                    {s.price && <div style={{ color: "#e8f0f8", fontSize: 9 }}>@ {s.price?.toFixed(4)}</div>}
                    {s.lo && <div style={{ color: "#e8f0f8", fontSize: 9 }}>{s.lo?.toFixed(4)} – {s.hi?.toFixed(4)}</div>}
                  </div>;
                })}
            </div>
          </div>
          <div style={S.panel}>
            <div style={S.panelHead}>SUPPORT / RESISTANCE</div>
            <div style={{ padding: 8 }}>
              {!analysis?.srLvls.length ? <div style={{ color: "#e8f0f8", fontSize: 10 }}>Calculating...</div>
                : analysis.srLvls.map((l, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #08081a" }}>
                    <span style={{ color: l.t === "R" ? "#ff3355" : "#00ff9d", fontWeight: "bold", fontSize: 10 }}>{l.t}</span>
                    <span style={{ color: "#e8f0f8", fontSize: 10 }}>{l.p < 10 ? l.p.toFixed(5) : l.p.toFixed(2)}</span>
                    <span style={{ color: "#e8f0f8", fontSize: 9 }}>{"★".repeat(Math.min(l.s, 4))}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* CENTER */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={S.panel}>
            <div style={{ borderBottom: "1px solid #1f2535" }}>
              {/* ── Row 1: MA / Bands ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderBottom: "1px solid #08081a", flexWrap: "wrap" }}>
                <span style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1, width: 38, flexShrink: 0 }}>MA/BB</span>
                {[
                  { key: "sma20",  label: "SMA 20",  col: "#00d4ff" },
                  { key: "sma50",  label: "SMA 50",  col: "#ff8c00" },
                  { key: "sma200", label: "SMA 200", col: "#ff3355" },
                  { key: "bb",     label: "Bol. Bands", col: "#ffcc00" },
                ].map(ind => (
                  <button key={ind.key}
                    onClick={() => setIndicators(p => ({ ...p, [ind.key]: !p[ind.key] }))}
                    style={{ background: indicators[ind.key] ? `${ind.col}22` : "transparent", border: `1px solid ${indicators[ind.key] ? ind.col : "#6a7a9a"}`, color: indicators[ind.key] ? ind.col : "#5a6a8a", padding: "2px 9px", borderRadius: 3, cursor: "pointer", fontSize: 9, fontFamily: "monospace", transition: "all .15s" }}>
                    {ind.label}
                  </button>
                ))}
              </div>
              {/* ── Row 2: Studies ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderBottom: "1px solid #08081a", flexWrap: "wrap" }}>
                <span style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1, width: 38, flexShrink: 0 }}>STUDY</span>
                {[
                  { key: "fib",    label: "Fibonacci",  col: "#ff8c00" },
                  { key: "div",    label: "Divergence", col: "#a855f7" },
                  { key: "sr",     label: "S/R Levels", col: "#00ff9d" },
                  { key: "vol",    label: "Volume",     col: "#3a5a80" },
                  { key: "vwap",   label: "VWAP",       col: "#00d4ff" },
                  { key: "pivots", label: "Pivots",     col: "#ffcc00" },
                  { key: "vp",     label: "Vol Profile", col: "#ff6b35" },
                ].map(ind => (
                  <button key={ind.key}
                    onClick={() => setIndicators(p => ({ ...p, [ind.key]: !p[ind.key] }))}
                    style={{ background: indicators[ind.key] ? `${ind.col}22` : "transparent", border: `1px solid ${indicators[ind.key] ? ind.col : "#6a7a9a"}`, color: indicators[ind.key] ? ind.col : "#5a6a8a", padding: "2px 9px", borderRadius: 3, cursor: "pointer", fontSize: 9, fontFamily: "monospace", transition: "all .15s" }}>
                    {ind.label}
                  </button>
                ))}
                <button
                  onClick={() => setIndicators({ sma20: false, sma50: false, sma200: false, bb: false, fib: false, div: false, sr: false, vol: false, vwap: false, pivots: false, vp: false })}
                  style={{ background: "transparent", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontSize: 8, fontFamily: "monospace", marginLeft: 4 }}>
                  CLEAR ALL
                </button>
                <button
                  onClick={() => setIndicators({ sma20: true, sma50: false, sma200: false, bb: false, fib: true, div: true, sr: true, vol: true, vwap: false, pivots: false, vp: false })}
                  style={{ background: "transparent", border: "1px solid #6a7a9a", color: "#e8f0f8", padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontSize: 8, fontFamily: "monospace" }}>
                  RESET
                </button>
                {/* Sub-chart selector pushed right */}
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  {["RSI", "MACD"].map(t => (
                    <button key={t} style={S.tfBtn(subChart === t.toLowerCase())} onClick={() => setSubChart(t.toLowerCase())}>{t}</button>
                  ))}
                </div>
              </div>
              {/* ── Row 3: Drawing Tools ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1, width: 38, flexShrink: 0 }}>DRAW</span>
                {[
                  { id: "hline", label: "H-Line",    col: "#00d4ff", key: "H" },
                  { id: "tline", label: "Trendline",  col: "#ffcc00", key: "T" },
                  { id: "ray",   label: "Ray",        col: "#a855f7", key: "R" },
                ].map(tool => (
                  <button key={tool.id}
                    onClick={() => setDrawTool(t => t === tool.id ? "none" : tool.id)}
                    title={`Shortcut: ${tool.key}`}
                    style={{ background: drawTool === tool.id ? `${tool.col}28` : "transparent", border: `1px solid ${drawTool === tool.id ? tool.col : "#6a7a9a"}`, color: drawTool === tool.id ? tool.col : "#5a6a8a", padding: "2px 9px", borderRadius: 3, cursor: "crosshair", fontSize: 9, fontFamily: "monospace", transition: "all .15s", boxShadow: drawTool === tool.id ? `0 0 6px ${tool.col}44` : "none" }}>
                    {tool.label}
                  </button>
                ))}
                {activeDrawings.length > 0 && (
                  <button onClick={clearDrawings} style={{ background: "transparent", border: "1px solid #ff335540", color: "#ff335580", padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontSize: 8, fontFamily: "monospace" }}>
                    🗑 CLEAR ({activeDrawings.length})
                  </button>
                )}
                {drawTool !== "none" && <span style={{ fontSize: 8, color: "#ffcc0080", marginLeft: 4, animation: "pulse 1.5s ease-in-out infinite" }}>● {drawTool === "hline" ? "Click anywhere on chart" : "Click & drag"} · ESC to cancel</span>}
              </div>
            </div>
            <div style={{ padding: "4px 0" }}>
              {candles.length > 0 && analysis
                ? <CandleChart candles={candles} s20arr={analysis.s20} s50arr={analysis.s50} s200arr={analysis.s200} bbarr={analysis.bbarr} srLvls={analysis.srLvls} showSMA20={indicators.sma20} showSMA50={indicators.sma50} showSMA200={indicators.sma200} showBB={indicators.bb} showSR={indicators.sr} showVol={indicators.vol} fibData={indicators.fib ? analysis.fib : null} divergences={indicators.div ? analysis.divergences : []} vwapArr={indicators.vwap ? analysis.vwap : null} pivots={indicators.pivots ? analysis.pivots : null} drawTool={drawTool} drawings={activeDrawings} onAddDrawing={addDrawing} onDeleteDrawing={deleteDrawing} volProfile={indicators.vp ? analysis.volProfile : null} />
                : <div style={{ height: 320, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#6a7a9a", gap: 12 }}>
                  <div style={{ fontSize: 36 }}>📊</div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: 2 }}>ENTER TICKER AND FETCH DATA</div>
                  <div style={{ fontSize: 8, color: "#1f2535" }}>YAHOO FINANCE + GROQ AI + SMC ENGINE</div>
                </div>}
            </div>
            {candles.length > 0 && (
              <div style={{ display: "flex", gap: 14, padding: "4px 12px 8px", fontSize: 9, color: "#e8f0f8", flexWrap: "wrap" }}>
                {indicators.sma20  && <span style={{ color: "#00d4ff", fontSize: 8 }}>— SMA20</span>}
                {indicators.sma50  && <span style={{ color: "#ff8c00", fontSize: 8 }}>— SMA50</span>}
                {indicators.sma200 && <span style={{ color: "#ff3355", fontSize: 8 }}>--- SMA200</span>}
                {indicators.bb     && <span style={{ color: "#ffcc00", fontSize: 8 }}>⊂⊃ BB</span>}
                {indicators.sr     && <><span style={{ color: "#00ff9d", fontSize: 8 }}>— S</span><span style={{ color: "#ff3355", fontSize: 8 }}>— R</span></>}
                {indicators.fib    && <span style={{ color: "#ff8c00", fontSize: 8 }}>--- FIB</span>}
                {indicators.div    && <span style={{ color: "#a855f7", fontSize: 8 }}>— DIV</span>}
                {indicators.vol    && <span style={{ color: "#3a5a80", fontSize: 8 }}>▮ VOL</span>}
                {indicators.vp     && <span style={{ color: "#ff6b35", fontSize: 8 }}>▮ VP/VPOC</span>}
                <span style={{ marginLeft: "auto", fontSize: 8 }}>{candles.length} bars · {ticker.toUpperCase()} · {tf.replace("|", " ")}</span>
              </div>
            )}
          </div>
          {candles.length > 0 && analysis && (
            <div style={S.panel}>
              {subChart === "rsi" ? <RSIChart chartData={analysis.chartData} divergences={indicators.div ? analysis.divergences : []} totalCandles={candles.length} /> : <MACDChart chartData={analysis.chartData} divergences={indicators.div ? analysis.divergences : []} totalCandles={candles.length} />}
            </div>
          )}
        </div>

        {/* RIGHT — AI */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={S.panel}>
            <div style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: aiResult ? biasColor : "#6a7a9a", boxShadow: aiResult ? `0 0 10px ${biasColor}` : "none" }} />
                <span style={{ fontSize: 10, color: "#e8f0f8", letterSpacing: 2 }}>NEXUS AI ENGINE</span>
              </div>
              {!groqKey && <div style={{ fontSize: 10, color: "#ffcc0080", marginBottom: 8, padding: "6px 8px", background: "#ffcc0010", borderRadius: 4, border: "1px solid #ffcc0030" }}>⚠ Set Groq API key in ⚙ Settings</div>}
              {aiResult && <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 18, fontWeight: "bold", color: biasColor, letterSpacing: 3 }}>{aiResult.bias}</div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 9, color: "#e8f0f8" }}>CONFIDENCE</div>
                    <div style={{ fontSize: 16, fontWeight: "bold", color: aiResult.confidence > 70 ? "#00ff9d" : aiResult.confidence > 40 ? "#ffcc00" : "#ff3355" }}>{aiResult.confidence}%</div>
                  </div>
                </div>
                <div style={{ width: "100%", height: 4, background: "#1f2535", borderRadius: 2, marginBottom: 10 }}>
                  <div style={{ width: `${aiResult.confidence}%`, height: "100%", background: `linear-gradient(90deg,${biasColor},${biasColor}88)`, borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: 10, color: "#e8f0f8", lineHeight: 1.6, marginBottom: 10 }}>{aiResult.summary}</div>
                {aiResult.trend && <div style={{ marginBottom: 10, padding: 8, background: "#0a0a18", borderRadius: 4 }}>
                  {["short", "medium", "long"].map(t => <div key={t} style={{ display: "flex", gap: 8, padding: "2px 0", fontSize: 9 }}><span style={{ color: "#e8f0f8", width: 46, flexShrink: 0 }}>{t.toUpperCase()}</span><span style={{ color: "#e8f0f8" }}>{aiResult.trend[t]}</span></div>)}
                </div>}
              </>}
              {!aiResult && !aiLoading && candles.length > 0 && <div style={{ fontSize: 10, color: "#e8f0f8", lineHeight: 1.8 }}>
                {["→ Multi-TF analysis", "→ Smart Money Concepts", "→ Trade setup + R:R", "→ Key level detection", "→ Risk assessment"].map(l => <div key={l}>{l}</div>)}
              </div>}
              {aiLoading && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 20, color: "#00d4ff" }}><div style={{ fontSize: 24, animation: "spin 1s linear infinite" }}>◈</div><div style={{ fontSize: 10, letterSpacing: 2, color: "#e8f0f8" }}>ANALYZING...</div></div>}
            </div>
          </div>
          {aiResult?.setup && (
            <div style={S.panel}>
              <div style={S.panelHead}>TRADE SETUP</div>
              <div style={{ padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ padding: "4px 16px", borderRadius: 4, fontWeight: "bold", fontSize: 13, letterSpacing: 2, background: aiResult.setup.direction === "LONG" ? "#00ff9d20" : aiResult.setup.direction === "SHORT" ? "#ff335520" : "#ffcc0020", color: aiResult.setup.direction === "LONG" ? "#00ff9d" : aiResult.setup.direction === "SHORT" ? "#ff3355" : "#ffcc00", border: `1px solid ${aiResult.setup.direction === "LONG" ? "#00ff9d50" : aiResult.setup.direction === "SHORT" ? "#ff335550" : "#ffcc0050"}` }}>{aiResult.setup.direction}</div>
                  <div style={{ fontSize: 14, fontWeight: "bold", color: "#00d4ff" }}>R:R {aiResult.setup.rr}</div>
                </div>
                {[["ENTRY", aiResult.setup.entry, "#e8f0f8"], ["STOP LOSS", aiResult.setup.stopLoss, "#ff3355"], ["TARGET 1", aiResult.setup.tp1, "#00ff9d"], ["TARGET 2", aiResult.setup.tp2, "#00ffa0"]].map(([k, v, col]) => v && (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #0a0a1a" }}>
                    <span style={{ color: "#e8f0f8", fontSize: 9 }}>{k}</span><span style={{ color: col, fontWeight: "bold", fontSize: 11 }}>{v}</span>
                  </div>
                ))}
                {aiResult.setup.rationale && <div style={{ marginTop: 8, fontSize: 9, color: "#7a8aa8", lineHeight: 1.6, borderTop: "1px solid #0a0a1a", paddingTop: 8 }}>{aiResult.setup.rationale}</div>}
              </div>
            </div>
          )}
          {aiResult?.keyLevels?.length > 0 && <div style={S.panel}><div style={S.panelHead}>KEY LEVELS</div><div style={{ padding: 8 }}>{aiResult.keyLevels.map((l, i) => <div key={i} style={{ padding: "3px 4px", borderBottom: "1px solid #08081a", fontSize: 9, color: "#e8f0f8", lineHeight: 1.5 }}>◈ {l}</div>)}</div></div>}
          {aiResult?.smartMoney && <div style={S.panel}><div style={S.panelHead}>🧠 SMART MONEY</div><div style={{ padding: 10, fontSize: 9, color: "#7a8aa8", lineHeight: 1.7 }}>{aiResult.smartMoney}</div></div>}
          {aiResult?.indicators && <div style={S.panel}><div style={S.panelHead}>INDICATOR READS</div><div style={{ padding: 8 }}>{Object.entries(aiResult.indicators).map(([k, v]) => <div key={k} style={{ padding: "4px", borderBottom: "1px solid #08081a" }}><div style={{ fontSize: 8, color: "#e8f0f8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>{k}</div><div style={{ fontSize: 9, color: "#e8f0f8", lineHeight: 1.5 }}>{v}</div></div>)}</div></div>}
          {aiResult?.watch && <div style={S.panel}><div style={S.panelHead}>👁 WATCH FOR</div><div style={{ padding: 10, fontSize: 9, color: "#ffcc0090", lineHeight: 1.7, borderLeft: "2px solid #ffcc0040" }}>{aiResult.watch}</div></div>}
          {aiResult?.risks && <div style={S.panel}><div style={S.panelHead}>⚠ RISKS</div><div style={{ padding: 10, fontSize: 9, color: "#ff335580", lineHeight: 1.7 }}>{aiResult.risks}</div></div>}
          <RiskCalculator setup={aiResult?.setup} lastPrice={last?.close} />

          {/* AI CHAT */}
          <div style={S.panel}>
            <div onClick={() => setChatOpen(o => !o)} style={{ ...S.panelHead, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>💬 AI CHAT <span style={{ fontSize: 8, color: "#6a7a9a", letterSpacing: 0 }}>(C)</span></span>
              <span style={{ color: "#e8f0f8" }}>{chatOpen ? "▲" : "▼"}</span>
            </div>
            {chatOpen && <AIChatPanel ticker={ticker} tf={tf} analysis={analysis} candles={candles} groqKey={groqKey} groqModel={groqModel} />}
          </div>

          <div style={{ padding: 8, fontSize: 8, color: "#6a7a9a", lineHeight: 1.6, textAlign: "center" }}>NOT FINANCIAL ADVICE. EDUCATIONAL PURPOSES ONLY.</div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* BOTTOM EXPANSION PANEL — Watchlist · Portfolio · Alerts · News */}
      {/* ============================================================ */}
      <div style={{ margin: "0 4px 10px", background: "#06060f", border: "1px solid #1f2535", borderRadius: 6, overflow: "hidden", width: "calc(100% - 8px)", boxSizing: "border-box" }}>
        {/* Tab bar */}
        <div style={{ display: "flex", background: "#04040c", borderBottom: bottomOpen ? "1px solid #1f2535" : "none" }}>
          {BOTTOM_TABS.map(tab => (
            <button key={tab.id}
              onClick={() => { if (bottomTab === tab.id) setBottomOpen(o => !o); else { setBottomTab(tab.id); setBottomOpen(true); } }}
              style={{ background: bottomTab === tab.id && bottomOpen ? "#06060f" : "transparent", border: "none", borderRight: "1px solid #1f2535", borderBottom: bottomTab === tab.id && bottomOpen ? "2px solid #00d4ff" : "2px solid transparent", color: bottomTab === tab.id && bottomOpen ? "#00d4ff" : "#e8f0f8", padding: "9px 18px", cursor: "pointer", fontFamily: "monospace", fontSize: 10, letterSpacing: 1, transition: "color .15s" }}>
              {tab.label}
            </button>
          ))}
          <button onClick={() => setBottomOpen(o => !o)} style={{ marginLeft: "auto", background: "none", border: "none", borderLeft: "1px solid #1f2535", color: "#e8f0f8", cursor: "pointer", padding: "0 16px", fontSize: 11 }}>{bottomOpen ? "▼" : "▲"}</button>
        </div>
        {bottomOpen && (
          <div style={{ maxHeight: 430, overflowY: "auto" }}>
            {bottomTab === "watchlist" && <WatchlistPanel onLoadTicker={loadFromWatchlist} groqKey={groqKey} currentTicker={ticker} />}
            {bottomTab === "portfolio" && <PortfolioPanel currentTicker={ticker} currentPrice={last?.close} />}
            {bottomTab === "alerts" && <AlertsPanel currentTicker={ticker} currentPrice={last?.close} />}
            {bottomTab === "news" && <NewsSentimentPanel ticker={ticker} groqKey={groqKey} />}
            {bottomTab === "mtf" && <MultiTimeframePanel ticker={ticker} />}
            {bottomTab === "journal" && <TradeJournalPanel />}
            {bottomTab === "screener" && <ScreenerPanel onLoadTicker={loadFromWatchlist} />}
            {bottomTab === "memory" && <AIMemoryPanel groqKey={groqKey} currentTicker={ticker} currentTF={tf} currentFV={candles.length && analysis ? buildFeatureVector({ bias: aiResult?.bias||"NEUTRAL", confidence: aiResult?.confidence||50, rsiAtSignal: analysis.rsiarr.filter(v=>v).slice(-1)[0], macdHistAtSignal: analysis.macdarr.hist.filter(v=>v).slice(-1)[0], trendAtSignal: trendState(analysis.s20.filter(v=>v).slice(-1)[0], analysis.s50.filter(v=>v).slice(-1)[0], analysis.s200.filter(v=>v).slice(-1)[0], candles[candles.length-1]?.close), atrStateAtSignal: atrState(analysis.atrarr.filter(v=>v).slice(-1)[0], candles[candles.length-1]?.close), volumeStateAtSignal: volumeState(candles, candles.length-1), patterns: analysis.patterns.slice(-5).map(p=>p.name).join(","), smcSignals: analysis.smcSigs.slice(-5).map(s=>s.label).join(","), hasDivergence: analysis.divergences.length>0, divType: analysis.divergences[0]?.type||"none", nearFib: analysis.fib?analysis.fib.levels.some(l=>Math.abs(candles[candles.length-1].close-l.price)/candles[candles.length-1].close<0.015):false, nearFibRatio: analysis.fib?(analysis.fib.levels.find(l=>Math.abs(candles[candles.length-1].close-l.price)/candles[candles.length-1].close<0.015)?.ratio??null):null, atSR: analysis.srLvls.some(l=>Math.abs(candles[candles.length-1].close-l.p)/candles[candles.length-1].close<0.01), srStrength: Math.max(0,...analysis.srLvls.filter(l=>Math.abs(candles[candles.length-1].close-l.p)/candles[candles.length-1].close<0.01).map(l=>l.s||0)) }, null) : null} />}
            {bottomTab === "backtest" && <BacktestPanel candles={candles} ticker={ticker} tf={tf} groqKey={groqKey} groqModel={groqModel} />}
            {bottomTab === "paper"    && <PaperTradingPanel candles={candles} ticker={ticker} tf={tf} groqKey={groqKey} groqModel={groqModel} analysis={analysis} lastPrice={last?.close} />}
          </div>
        )}
      </div>

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "#00000090", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setShowSettings(false)}>
          <div style={{ background: "#0a0a18", border: "1px solid #6a7a9a", borderRadius: 8, padding: 24, width: 420, maxWidth: "90vw" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, fontWeight: "bold", color: "#00d4ff", marginBottom: 16, letterSpacing: 2 }}>⚙ SETTINGS</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: "#e8f0f8", letterSpacing: 1, marginBottom: 6 }}>GROQ API KEY</div>
              <input type="password" value={groqKey} onChange={e => setGroqKey(e.target.value)} style={S.inp} placeholder="gsk_..." />
              <div style={{ fontSize: 8, color: "#e8f0f8", marginTop: 4 }}>Free key at console.groq.com</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 9, color: "#e8f0f8", letterSpacing: 1, marginBottom: 6 }}>AI MODEL</div>
              <select value={groqModel} onChange={e => setGroqModel(e.target.value)} style={{ ...S.inp, cursor: "pointer" }}>
                {GROQ_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <div style={{ fontSize: 8, color: "#e8f0f8", marginTop: 4 }}>Recommended: llama-3.3-70b-versatile</div>
            </div>
            <div style={{ background: "#0a0a18", border: "1px solid #6a7a9a", borderRadius: 4, padding: 10, fontSize: 9, color: "#5a6a8a", lineHeight: 1.9, marginBottom: 16 }}>
              📡 Market data: Yahoo Finance via corsproxy.io<br />
              🧠 AI brain: Groq Cloud (free tier)<br />
              💾 Watchlist, portfolio &amp; alerts saved to localStorage<br />
              🔐 API key stored in React state only (not persisted)
            </div>
            <button style={{ ...S.btn("#00d4ff"), width: "100%" }} onClick={() => setShowSettings(false)}>SAVE &amp; CLOSE</button>
          </div>
        </div>
      )}
      <style>{`
        @keyframes spin  { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity: 0.5 } 50% { opacity: 1 } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #04040c; }
        ::-webkit-scrollbar-thumb { background: #6a7a9a; border-radius: 2px; }
        select option { background: #0a0a18; color: #e8f0f8; }
        button:disabled { opacity: 0.5; cursor: not-allowed !important; }
      `}</style>
    </div>
  );
}

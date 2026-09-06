/**
 * モンテカルロ・シミュレーション。
 *
 * 決定論モデル（毎年きっちり x% で運用）は、実際の市場が持つ最大のリスク
 * ——「同じ平均リターンでも、暴落がリタイア直後に来ると資産寿命が大きく縮む」
 * というシーケンス・オブ・リターン・リスク——を表現できない。
 * ここでは年次リターンを対数正規分布から抽選し、試行を多数回まわして
 * 「FIRE達成の確率」「資産が尽きる確率」を求める。
 *
 * 乱数はシード固定の疑似乱数を使う。入力を変えていないのに結果が毎回揺れると
 * 数値を比較できなくなるため、再現性を優先している。
 */

import { normalizeInput, project } from './simulator.js';
import { OTHER_VOLATILITY_RATIO, MONTE_CARLO_SEED, PERCENTILES } from './config.js';

/* ------------------------------------------------------------------ */
/* 乱数                                                                */
/* ------------------------------------------------------------------ */

/** mulberry32: 軽量・高品質なシード付き疑似乱数生成器。 */
function createRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller 法による標準正規乱数。 */
function createNormal(random) {
  let spare = null;
  return function next() {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = random() * 2 - 1;
      v = random() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const factor = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * factor;
    return u * factor;
  };
}

/**
 * 算術平均 mean・標準偏差 stdev のリターンを、対数正規分布のパラメータへ変換する。
 * 正規分布をそのまま使うと -100% を下回るリターンが発生しうるため、
 * 資産価格の分布として自然な対数正規を用いる。
 */
function toLogNormalParams(mean, stdev) {
  const growth = 1 + mean;
  if (growth <= 0) return { mu: 0, sigma: 0 };
  const sigmaSq = Math.log(1 + (stdev * stdev) / (growth * growth));
  return { mu: Math.log(growth) - sigmaSq / 2, sigma: Math.sqrt(sigmaSq) };
}

/* ------------------------------------------------------------------ */
/* 集計                                                                */
/* ------------------------------------------------------------------ */

/** 昇順ソート済み配列から線形補間でパーセンタイルを求める。 */
function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/* ------------------------------------------------------------------ */
/* 本体                                                                */
/* ------------------------------------------------------------------ */

/**
 * モンテカルロ分析を実行する。
 *
 * @param {object} state UI の状態
 * @param {object} options
 * @param {number} options.trials     試行回数
 * @param {number} options.volatility 株式の年間ボラティリティ（％表記の実数、例 18）
 * @returns {object} 成功率・枯渇率・達成年齢分位・資産の分位帯
 */
export function runMonteCarlo(state, { trials, volatility }) {
  const p = normalizeInput(state);
  const random = createRandom(MONTE_CARLO_SEED);
  const normal = createNormal(random);

  const stockParams = toLogNormalParams(p.baseYieldStock, volatility / 100);
  const otherParams = toLogNormalParams(
    p.baseYieldOther,
    (volatility / 100) * OTHER_VOLATILITY_RATIO,
  );

  const yearCount = p.horizon + 1;
  // assetsByYear[year] に全試行の期首資産を溜め、最後にまとめて分位を取る
  const assetsByYear = Array.from({ length: yearCount }, () => new Float64Array(trials));
  const fireYears = [];
  const terminalAssets = new Float64Array(trials);

  let achievedCount = 0;
  let depletedCount = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    // 1試行ぶんのリターン系列を先に生成し、project へ関数として渡す
    const stockSeries = new Float64Array(yearCount);
    const otherSeries = new Float64Array(yearCount);
    for (let year = 0; year < yearCount; year += 1) {
      stockSeries[year] = Math.exp(stockParams.mu + stockParams.sigma * normal()) - 1;
      otherSeries[year] = Math.exp(otherParams.mu + otherParams.sigma * normal()) - 1;
    }

    const run = project(p, {
      yieldStock: p.baseYieldStock,
      yieldOther: p.baseYieldOther,
      realizedYield: (year) => ({ stock: stockSeries[year], other: otherSeries[year] }),
      detectFire: true,
      // 明細は使わないため生成しない（試行回数ぶんのオブジェクト生成を回避）
      collectRows: false,
      observer: (year, startAssets) => {
        assetsByYear[year][trial] = startAssets;
      },
    });

    terminalAssets[trial] = run.terminalAssets;

    if (run.achieved) {
      achievedCount += 1;
      fireYears.push(run.fireYear);
    }
    if (run.depleted) depletedCount += 1;
  }

  // --- 分位の算出 ---
  const bands = assetsByYear.map((values, year) => {
    const sorted = Float64Array.from(values).sort();
    return {
      year,
      age: p.currentAge + year,
      p10: percentile(sorted, PERCENTILES.low),
      p50: percentile(sorted, PERCENTILES.mid),
      p90: percentile(sorted, PERCENTILES.high),
    };
  });

  const sortedFireYears = fireYears.slice().sort((a, b) => a - b);
  const sortedTerminal = Float64Array.from(terminalAssets).sort();

  const fireAgeAt = (ratio) =>
    sortedFireYears.length > 0
      ? Math.round(p.currentAge + percentile(sortedFireYears, ratio))
      : null;

  return {
    trials,
    volatility,
    successRate: achievedCount / trials,
    depletionRate: depletedCount / trials,
    fireAge: {
      p10: fireAgeAt(PERCENTILES.low),
      p50: fireAgeAt(PERCENTILES.mid),
      p90: fireAgeAt(PERCENTILES.high),
    },
    terminal: {
      p10: percentile(sortedTerminal, PERCENTILES.low),
      p50: percentile(sortedTerminal, PERCENTILES.mid),
      p90: percentile(sortedTerminal, PERCENTILES.high),
    },
    bands,
  };
}

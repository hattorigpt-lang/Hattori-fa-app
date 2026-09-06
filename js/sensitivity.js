/**
 * 感度分析（トルネードチャート用の計算）。
 *
 * 「どの変数を動かすとFIRE達成年が最も変わるか」を定量化する。
 * 3シナリオの比較は "利回りが違ったらどうなるか" しか答えないが、
 * 感度分析は "自分が何から手を付けるべきか" を答える。
 * 多くの家計では利回りより支出の削減が効くため、行動に直結する示唆が得られる。
 */

import { normalizeInput, project } from './simulator.js';
import { SENSITIVITY_DELTA_RATIO, SENSITIVITY_DELTA_RATE } from './config.js';

/**
 * 感度分析で動かすレバーの定義。
 * amount 系は比率、rate 系は絶対値（％ポイント）で変動させる。
 * apply は「状態と倍率／増分」を受け取り、変更後の状態を返す純粋関数。
 */
const LEVERS = [
  {
    key: 'monthlyIncome',
    label: '手取り月給',
    kind: 'ratio',
    apply: (state, factor) => ({ ...state, monthlyIncome: state.monthlyIncome * factor }),
    value: (state) => state.monthlyIncome,
    unit: '万円',
    better: 'increase',
  },
  {
    key: 'monthlyExpense',
    label: '月間支出（固定＋変動）',
    kind: 'ratio',
    apply: (state, factor) => ({
      ...state,
      monthlyFixed: state.monthlyFixed * factor,
      monthlyVar: state.monthlyVar * factor,
    }),
    value: (state) => state.monthlyFixed + state.monthlyVar,
    unit: '万円',
    better: 'decrease',
  },
  {
    key: 'annualBonus',
    label: '年間手取り賞与',
    kind: 'ratio',
    apply: (state, factor) => ({ ...state, annualBonus: state.annualBonus * factor }),
    value: (state) => state.annualBonus,
    unit: '万円',
    better: 'increase',
  },
  {
    key: 'annualExpense',
    label: '年間支出（特別費・レジャー）',
    kind: 'ratio',
    apply: (state, factor) => ({
      ...state,
      annualFixed: state.annualFixed * factor,
      annualVar: state.annualVar * factor,
    }),
    value: (state) => state.annualFixed + state.annualVar,
    unit: '万円',
    better: 'decrease',
  },
  {
    key: 'assets',
    label: '現在の総資産',
    kind: 'ratio',
    apply: (state, factor) => ({
      ...state,
      assetCash: state.assetCash * factor,
      assetNisa: state.assetNisa * factor,
      assetStock: state.assetStock * factor,
      assetOther: state.assetOther * factor,
    }),
    value: (state) => state.assetCash + state.assetNisa + state.assetStock + state.assetOther,
    unit: '万円',
    better: 'increase',
  },
  {
    key: 'events',
    label: 'ライフイベント総額',
    kind: 'ratio',
    apply: (state, factor) => ({
      ...state,
      events: state.events.map((event) => ({ ...event, cost: event.cost * factor })),
    }),
    value: (state) => state.events.reduce((sum, event) => sum + event.cost, 0),
    unit: '万円',
    better: 'decrease',
  },
  {
    key: 'spouseMonthlyIncome',
    label: '配偶者の手取り月給',
    kind: 'ratio',
    apply: (state, factor) => ({ ...state, spouseMonthlyIncome: state.spouseMonthlyIncome * factor }),
    value: (state) => state.spouseMonthlyIncome,
    unit: '万円',
    better: 'increase',
    requires: (state) => state.spouseEnabled,
  },
  {
    key: 'housingPrice',
    label: '物件価格',
    kind: 'ratio',
    apply: (state, factor) => ({ ...state, housingPrice: state.housingPrice * factor }),
    value: (state) => state.housingPrice,
    unit: '万円',
    better: 'decrease',
    requires: (state) => state.housingEnabled && state.housingPurchase,
  },
  {
    key: 'housingRentMonthly',
    label: '家賃（購入までの住居費）',
    kind: 'ratio',
    apply: (state, factor) => ({ ...state, housingRentMonthly: state.housingRentMonthly * factor }),
    value: (state) => state.housingRentMonthly,
    unit: '万円 / 月',
    better: 'decrease',
    requires: (state) => state.housingEnabled,
  },
  {
    key: 'prepaymentAnnual',
    label: '年間の繰り上げ返済額',
    kind: 'ratio',
    apply: (state, factor) => ({ ...state, prepaymentAnnual: state.prepaymentAnnual * factor }),
    value: (state) => state.prepaymentAnnual,
    unit: '万円 / 年',
    better: 'decrease',
    requires: (state) => state.housingEnabled && state.housingPurchase && state.prepaymentEnabled,
  },
  {
    key: 'housingLoanRate',
    label: '住宅ローン金利',
    kind: 'rate',
    apply: (state, delta) => ({
      ...state,
      housingLoanRate: Math.max(0, state.housingLoanRate + delta),
    }),
    value: (state) => state.housingLoanRate,
    unit: '%',
    bounds: [0, 8],
    better: 'decrease',
    requires: (state) => state.housingEnabled && state.housingPurchase,
  },
  {
    key: 'yieldStock',
    label: '期待利回り',
    kind: 'rate',
    apply: (state, delta) => ({ ...state, yieldStock: state.yieldStock + delta }),
    value: (state) => state.yieldStock,
    unit: '%',
    bounds: [0, 15],
    better: 'increase',
  },
  {
    key: 'inflationRate',
    label: 'インフレ率',
    kind: 'rate',
    apply: (state, delta) => ({ ...state, inflationRate: state.inflationRate + delta }),
    value: (state) => state.inflationRate,
    unit: '%',
    bounds: [-2, 8],
    better: 'decrease',
    requires: (state) => state.inflationEnabled,
  },
  {
    key: 'salaryGrowthRate',
    label: '昇給率',
    kind: 'rate',
    apply: (state, delta) => ({ ...state, salaryGrowthRate: state.salaryGrowthRate + delta }),
    value: (state) => state.salaryGrowthRate,
    unit: '%',
    bounds: [-5, 10],
    better: 'increase',
    requires: (state) => state.salaryGrowthEnabled,
  },
];

/** レバーの値を単位付きで整形する。 */
function formatValue(lever, value) {
  const digits = lever.kind === 'rate' ? 1 : Math.abs(value) < 100 ? 1 : 0;
  return `${Number(value.toFixed(digits)).toLocaleString('ja-JP')} ${lever.unit}`;
}

/**
 * 標準シナリオでのFIRE達成年数だけを求める軽量版。
 * 取り崩し可能額の二分探索や3シナリオ展開は行わない。
 */
function fireYearOf(state) {
  const p = normalizeInput(state);
  const run = project(p, {
    yieldStock: p.baseYieldStock,
    yieldOther: p.baseYieldOther,
    detectFire: true,
    collectRows: false,
  });
  return run.achieved
    ? { years: run.fireYearExact, achieved: true }
    : // 未達成は「想定寿命でも届かない」を表す上限値として扱い、棒の長さを頭打ちにする
      { years: p.horizon, achieved: false };
}

/**
 * 感度分析を実行する。
 * @param {object} state UI の状態
 * @returns {{baseline: object, items: object[], maxDelta: number}}
 */
export function runSensitivity(state) {
  const baseline = fireYearOf(state);

  const items = LEVERS.filter((lever) => !lever.requires || lever.requires(state)).map((lever) => {
    const isRatio = lever.kind === 'ratio';
    const downArg = isRatio ? 1 - SENSITIVITY_DELTA_RATIO : -SENSITIVITY_DELTA_RATE;
    const upArg = isRatio ? 1 + SENSITIVITY_DELTA_RATIO : SENSITIVITY_DELTA_RATE;

    const down = fireYearOf(lever.apply(state, downArg));
    const up = fireYearOf(lever.apply(state, upArg));

    return {
      key: lever.key,
      label: lever.label,
      current: formatValue(lever, lever.value(state)),
      deltaLabel: isRatio
        ? `±${SENSITIVITY_DELTA_RATIO * 100}%`
        : `±${SENSITIVITY_DELTA_RATE} pt`,
      down: { ...down, delta: down.years - baseline.years },
      up: { ...up, delta: up.years - baseline.years },
      impact: Math.max(Math.abs(down.years - baseline.years), Math.abs(up.years - baseline.years)),
    };
  });

  items.sort((a, b) => b.impact - a.impact);
  const maxDelta = Math.max(1, ...items.map((item) => item.impact));

  return { baseline, items, maxDelta };
}

/* ------------------------------------------------------------------ */
/* 目標逆算（ゴールシーク）                                              */
/* ------------------------------------------------------------------ */

/** 逆算する対象は影響の大きい上位レバーに絞る（計算量と可読性の両面から）。 */
const GOAL_SEEK_LEVERS = 5;

/** 二分探索の反復回数。0.01年の精度が出れば十分。 */
const GOAL_SEEK_ITERATIONS = 22;

/** 比率系レバーの探索上限（現在値に対する倍率）。 */
const RATIO_SEARCH_MAX = 5;

/**
 * 「FIRE達成を N 年早めるには、各変数をいくらにすればよいか」を逆算する。
 *
 * ±10% を振って傾きを見る感度分析に対し、こちらは目標から必要な水準を求める。
 * 「何をどれだけ変えればよいか」が数値で出るため、そのまま行動計画になる。
 *
 * @param {object} state UI の状態
 * @param {object} sensitivity runSensitivity の戻り値（影響順の並びを再利用する）
 * @param {number} targetYearsEarlier 何年早めたいか
 */
export function runGoalSeek(state, sensitivity, targetYearsEarlier) {
  const baseline = sensitivity.baseline;
  if (!baseline.achieved) return { achievable: false, reason: 'unachieved', targetYearsEarlier };

  const targetYears = baseline.years - targetYearsEarlier;
  if (targetYears <= 0) {
    return { achievable: false, reason: 'already-early', targetYearsEarlier, baseline };
  }

  const leverByKey = new Map(LEVERS.map((lever) => [lever.key, lever]));
  const items = sensitivity.items
    .slice(0, GOAL_SEEK_LEVERS)
    .map((item) => solveLever(state, leverByKey.get(item.key), targetYears))
    .filter(Boolean);

  return { achievable: true, targetYearsEarlier, targetYears, baseline, items };
}

/** レバー1本について、目標年数に到達する値を二分探索で求める。 */
function solveLever(state, lever, targetYears) {
  if (!lever) return null;
  const current = lever.value(state);
  const bounds = searchBounds(lever, current);
  if (bounds === null) return null;

  const evaluate = (value) => fireYearOf(withValue(state, lever, value, current)).years;

  // 探索の端でも目標に届かないなら「この変数だけでは到達不能」
  if (evaluate(bounds.limit) > targetYears) {
    return {
      key: lever.key,
      label: lever.label,
      unit: lever.unit,
      current,
      currentLabel: formatValue(lever, current),
      feasible: false,
      limitLabel: formatValue(lever, bounds.limit),
    };
  }

  let reachable = bounds.limit;
  let unreachable = current;
  for (let i = 0; i < GOAL_SEEK_ITERATIONS; i += 1) {
    const mid = (reachable + unreachable) / 2;
    if (evaluate(mid) <= targetYears) reachable = mid;
    else unreachable = mid;
  }

  return {
    key: lever.key,
    label: lever.label,
    unit: lever.unit,
    current,
    currentLabel: formatValue(lever, current),
    required: reachable,
    requiredLabel: formatValue(lever, reachable),
    delta: reachable - current,
    ratio: current !== 0 ? reachable / current - 1 : null,
    isRate: lever.kind === 'rate',
    feasible: true,
  };
}

/** レバーを「改善方向へ最大限振った値」を探索の端として返す。 */
function searchBounds(lever, current) {
  if (lever.kind === 'rate') {
    const [min, max] = lever.bounds ?? [-10, 20];
    return { limit: lever.better === 'increase' ? max : min };
  }
  // 比率系: 増やす方向は現在値の RATIO_SEARCH_MAX 倍、減らす方向は 0 まで
  if (lever.better === 'increase') {
    if (current <= 0) return null; // 0 からは比率で増やせない
    return { limit: current * RATIO_SEARCH_MAX };
  }
  if (current <= 0) return null; // すでに 0 なら減らす余地がない
  return { limit: 0 };
}

/** レバーを指定した値に設定した状態を返す。 */
function withValue(state, lever, value, current) {
  if (lever.kind === 'rate') return lever.apply(state, value - current);
  if (current === 0) return state;
  return lever.apply(state, value / current);
}

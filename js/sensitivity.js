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
    read: (state) => `${state.monthlyIncome} 万円`,
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
    read: (state) => `${state.monthlyFixed + state.monthlyVar} 万円`,
  },
  {
    key: 'annualBonus',
    label: '年間手取り賞与',
    kind: 'ratio',
    apply: (state, factor) => ({ ...state, annualBonus: state.annualBonus * factor }),
    read: (state) => `${state.annualBonus} 万円`,
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
    read: (state) => `${state.annualFixed + state.annualVar} 万円`,
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
    read: (state) =>
      `${state.assetCash + state.assetNisa + state.assetStock + state.assetOther} 万円`,
  },
  {
    key: 'events',
    label: 'ライフイベント総額',
    kind: 'ratio',
    apply: (state, factor) => ({
      ...state,
      events: state.events.map((event) => ({ ...event, cost: event.cost * factor })),
    }),
    read: (state) => `${state.events.reduce((sum, event) => sum + event.cost, 0)} 万円`,
  },
  {
    key: 'yieldStock',
    label: '期待利回り',
    kind: 'rate',
    apply: (state, delta) => ({ ...state, yieldStock: state.yieldStock + delta }),
    read: (state) => `${state.yieldStock} %`,
  },
  {
    key: 'inflationRate',
    label: 'インフレ率',
    kind: 'rate',
    apply: (state, delta) => ({ ...state, inflationRate: state.inflationRate + delta }),
    read: (state) => `${state.inflationRate} %`,
    requires: (state) => state.inflationEnabled,
  },
  {
    key: 'salaryGrowthRate',
    label: '昇給率',
    kind: 'rate',
    apply: (state, delta) => ({ ...state, salaryGrowthRate: state.salaryGrowthRate + delta }),
    read: (state) => `${state.salaryGrowthRate} %`,
    requires: (state) => state.salaryGrowthEnabled,
  },
];

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
      current: lever.read(state),
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

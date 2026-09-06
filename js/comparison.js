/**
 * 「生涯賃貸」と「購入」を同一条件で並べて比較する。
 *
 * 住宅は多くの家計で最大の意思決定でありながら、単独の試算では
 * 「買った場合の数字」しか見えず、賃貸を続けた場合との差が分からない。
 * ここでは住宅の設定だけを入れ替えた2本の試算を並べる。
 *
 * 入力のたびに実行されるため、取り崩し可能額の二分探索を伴う runSimulation は
 * 使わず、標準シナリオの年次プロジェクションだけを回す軽量経路で計算する。
 */

import { normalizeInput, project } from './simulator.js';

function summarize(state) {
  const p = normalizeInput(state);
  const run = project(p, {
    yieldStock: p.baseYieldStock,
    yieldOther: p.baseYieldOther,
    detectFire: true,
    collectRows: true,
  });

  const housingGross = run.rows.reduce((sum, row) => sum + row.housingCost, 0);
  const deduction = run.rows.reduce((sum, row) => sum + row.housingDeduction, 0);

  return {
    achieved: run.achieved,
    fireAge: run.fireAge,
    fireYear: run.fireYear,
    terminalAssets: run.terminalAssets,
    terminalNetWorth: run.terminalNetWorth,
    depleted: run.depleted,
    depletionAge: run.depletionAge,
    // 生涯の住居費（頭金・諸費用・返済・繰り上げ返済・維持費の累計、名目値）
    housingGross,
    housingNet: housingGross - deduction,
  };
}

/**
 * 賃貸と購入を比較する。住居費の試算が無効なら null を返す。
 * @param {object} state UI の状態
 */
export function compareHousing(state) {
  if (!state.housingEnabled) return null;

  const rent = summarize({ ...state, housingPurchase: false });
  const buy = summarize({ ...state, housingPurchase: true });

  // 「購入が有利か」は終端資産の差で判断する。FIRE達成年齢だけでは、
  // ローン返済中の一時的な支出増で不利に見えてしまうため。
  const assetDelta = buy.terminalNetWorth - rent.terminalNetWorth;
  const fireDelta =
    buy.achieved && rent.achieved ? buy.fireYear - rent.fireYear : null;

  return {
    rent,
    buy,
    current: state.housingPurchase ? 'buy' : 'rent',
    assetDelta,
    fireDelta,
    housingDelta: buy.housingNet - rent.housingNet,
  };
}

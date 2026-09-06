/**
 * 住居費セクションの表示制御とローン概要の描画。
 */

import { formatMan, formatMonthly } from '../formatters.js';
import { $, setText } from './dom.js';

/**
 * 月間固定費に家賃が含まれたままかを推定する。
 * 固定費が家賃を下回っていれば、家賃は既に除外されているとみなせる。
 */
function looksLikeRentIncluded(state) {
  return state.housingRentMonthly > 0 && state.monthlyFixed >= state.housingRentMonthly;
}

/**
 * 住居費の詳細入力の表示可否と、ローン試算の概要を更新する。
 * @param {object} state UI の状態
 * @param {object} plan  simulator が構築した住居費プラン
 */
export function renderHousing(state, plan) {
  const detail = $('#housing-detail');
  const purchaseDetail = $('#housing-purchase-detail');
  if (detail) detail.hidden = !state.housingEnabled;
  if (purchaseDetail) purchaseDetail.hidden = !state.housingPurchase;

  // 年次明細の住居費列は、住居費を試算する場合のみ表示する
  const timelineTable = $('#timeline-table');
  if (timelineTable) timelineTable.dataset.housing = state.housingEnabled ? 'on' : 'off';

  // 二重計上の注意喚起は、実際にその可能性があるときだけ出す。
  // 常時表示すると読み飛ばされ、繰り返し押せるボタンは固定費を削りすぎる原因になる。
  const overlapAlert = $('#rent-overlap-alert');
  if (overlapAlert) {
    const overlapping = state.housingEnabled && looksLikeRentIncluded(state);
    overlapAlert.hidden = !overlapping;
    if (overlapping) {
      setText($('#rent-overlap-fixed'), `${state.monthlyFixed} 万円`);
      setText($('#rent-overlap-rent'), `${state.housingRentMonthly} 万円`);
    }
  }

  if (!plan?.purchase) return;

  setText($('#housing-monthly'), formatMonthly(plan.monthlyPayment));
  setText($('#housing-loan'), formatMan(plan.loanAmount));
  setText($('#housing-total'), formatMan(plan.totalPayment));
  setText($('#housing-interest'), formatMan(plan.totalInterest));
  setText($('#housing-deduction'), plan.totalDeduction > 0 ? `−${formatMan(plan.totalDeduction)}` : '適用なし');
}

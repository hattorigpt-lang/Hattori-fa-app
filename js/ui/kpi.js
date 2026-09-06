/**
 * 入力サマリー（総資産・支出）、KPIカード、警告バナーの描画。
 */

import { collectWarnings } from '../state.js';
import { formatMan, formatMonthly, formatOku, formatPercent } from '../formatters.js';
import { $, setText, setHtml, icon, escapeHtml, toggleClass } from './dom.js';

const ASSET_SEGMENTS = [
  { key: 'cash', label: '現金', color: '#94a3b8' },
  { key: 'nisa', label: 'NISA', color: '#059669' },
  { key: 'stock', label: '株式（課税）', color: '#2f5bd8' },
  { key: 'other', label: 'その他', color: '#6366f1' },
];

/** 資産構成の合計バーと内訳テキストを更新する。 */
export function renderAssetSummary(state) {
  const amounts = {
    cash: state.assetCash,
    nisa: state.assetNisa,
    stock: state.assetStock,
    other: state.assetOther,
  };
  const total = Object.values(amounts).reduce((sum, value) => sum + value, 0);

  const oku = formatOku(total);
  setText($('#total-assets-value'), oku ? `${formatMan(total)}（${oku}）` : formatMan(total));

  ASSET_SEGMENTS.forEach((segment) => {
    const node = $(`.stack-bar__seg[data-seg="${segment.key}"]`);
    if (node) node.style.width = total > 0 ? `${(amounts[segment.key] / total) * 100}%` : '0%';
  });

  const shares = distributePercent(ASSET_SEGMENTS.map((segment) => amounts[segment.key]), total);
  const parts = ASSET_SEGMENTS
    .map((segment, index) => ({ label: segment.label, share: shares[index] }))
    .filter((item) => item.share > 0)
    .map((item) => `${item.label} ${item.share}%`);
  setText($('#asset-composition'), total > 0 ? parts.join(' ／ ') : '資産が未入力です');
}

/**
 * 構成比を整数へ丸めつつ、合計が必ず100%になるよう配分する（最大剰余法）。
 * 単純な四捨五入では「38% ／ 63%」のように合計101%となり、資料としての信頼性を損なうため。
 */
function distributePercent(values, total) {
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => (value / total) * 100);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; remainder > 0 && i < order.length; i += 1, remainder -= 1) {
    floors[order[i].index] += 1;
  }
  return floors;
}

/** 年間支出の合計と内訳を更新する。 */
export function renderExpenseSummary(state) {
  const monthlyTotal = state.monthlyFixed + state.monthlyVar;
  const annualTotal = monthlyTotal * 12 + state.annualFixed + state.annualVar;
  setText($('#expense-total'), formatMan(annualTotal));
  setText(
    $('#expense-breakdown'),
    `月次 ${formatMonthly(monthlyTotal)} × 12 ＋ 年次 ${formatMan(state.annualFixed + state.annualVar)}`,
  );
}

/** 3枚のKPIカードを更新する。表示元は常に「標準」シナリオ。 */
export function renderKpi(result) {
  const { derived, standard } = result;

  // --- 年間投資可能額 ---
  const investNode = $('#kpi-invest-value');
  setText(investNode, formatMan(derived.annualInvestable, { withUnit: false }));
  toggleClass(investNode, 'text-danger', derived.annualInvestable < 0);
  setText($('#kpi-invest-monthly'), formatMonthly(derived.monthlyInvestable));
  setText($('#kpi-invest-rate'), formatPercent(derived.savingsRate, 0));

  // --- FIRE達成 ---
  setText($('#kpi-fire-scenario'), `（${(standard.yieldStock * 100).toFixed(1)}% 運用）`);
  if (standard.achieved) {
    setText($('#kpi-fire-value'), String(standard.fireAge));
    setText($('#kpi-fire-unit'), '歳');
    setText($('#kpi-fire-years'), `${standard.fireYear} 年後に到達`);
  } else {
    setText($('#kpi-fire-value'), '未達成');
    setText($('#kpi-fire-unit'), '');
    setText($('#kpi-fire-years'), '想定寿命内には届きません');
  }
  setText($('#kpi-fire-target'), formatMan(standard.displayTarget));

  // --- リタイア後に使える月額 ---
  const withdrawNode = $('#kpi-withdraw-value');
  if (standard.achieved) {
    setText(withdrawNode, standard.sustainableMonthlySpend.toFixed(1));
    const currentMonthly = derived.annualExpense / 12;
    const diff = standard.sustainableMonthlySpend - currentMonthly;
    setText(
      $('#kpi-withdraw-compare'),
      `現在の生活費 ${currentMonthly.toFixed(1)} 万円と比べ ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} 万円`,
    );
  } else {
    setText(withdrawNode, '—');
    setText($('#kpi-withdraw-compare'), 'FIRE達成後に算出されます');
  }
}

/**
 * 入力の矛盾やシミュレーション結果のリスクを警告として表示する。
 * エラーで停止させるのではなく、「どの前提で計算したか」を明示する方針。
 */
export function renderAlerts(state, result) {
  const container = $('#alerts');
  if (!container) return;

  const items = collectWarnings(state).map((warning) => ({
    tone: 'warn',
    message: warning.message,
  }));

  const depleted = result.scenarios.filter((scenario) => scenario.depleted);
  if (depleted.length > 0) {
    const earliest = Math.min(...depleted.map((scenario) => scenario.depletionAge));
    items.unshift({
      tone: 'danger',
      message: `${depleted.map((s) => s.label).join('・')}シナリオでは ${earliest} 歳で資産が尽きます。支出・リタイア時期・積立額の見直しが必要です。`,
    });
  }

  if (items.length === 0) {
    setHtml(container, '');
    return;
  }

  setHtml(
    container,
    items
      .map(
        (item) => `<div class="alert${item.tone === 'danger' ? ' alert--danger' : ''}">
          ${icon(item.tone === 'danger' ? 'i-alert' : 'i-info')}<span>${escapeHtml(item.message)}</span>
        </div>`,
      )
      .join(''),
  );
}

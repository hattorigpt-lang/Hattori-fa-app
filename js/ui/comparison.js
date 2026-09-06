/**
 * 賃貸 vs 購入 比較カードの描画。
 */

import { formatMan, formatAge } from '../formatters.js';
import { $, setText, setHtml } from './dom.js';

/** 差分セル。購入側が有利なら緑、不利なら橙で表示する。 */
function deltaCell(value, { goodWhenPositive = true, unit = 'man' } = {}) {
  if (value === null || !Number.isFinite(value)) return '<span class="text-subtle">—</span>';
  const isGood = goodWhenPositive ? value > 0 : value < 0;
  const tone = Math.abs(value) < 0.5 ? 'text-subtle' : isGood ? 'text-emerald' : 'text-amber';
  const sign = value > 0 ? '+' : '';
  const text = unit === 'year' ? `${sign}${value.toFixed(0)} 年` : formatMan(value, { signed: true });
  return `<span class="${tone} fw-700">${text}</span>`;
}

function fireCell(summary) {
  if (!summary.achieved) return '<span class="text-subtle">未達成</span>';
  return `<strong>${summary.fireAge} 歳</strong>`;
}

function terminalCell(summary) {
  if (summary.depleted) {
    return `<span class="text-danger fw-700">${formatAge(summary.depletionAge)}で枯渇</span>`;
  }
  return formatMan(summary.terminalNetWorth);
}

export function renderComparison(comparison) {
  const card = $('#housing-compare-card');
  if (!card) return;
  if (!comparison) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const { rent, buy } = comparison;
  const rows = [
    {
      label: 'FIRE達成年齢',
      rent: fireCell(rent),
      buy: fireCell(buy),
      // 達成が早い（差がマイナス）ほど良い
      delta: deltaCell(comparison.fireDelta, { goodWhenPositive: false, unit: 'year' }),
    },
    {
      label: '寿命時点の資産（税引後）',
      rent: terminalCell(rent),
      buy: terminalCell(buy),
      delta: deltaCell(comparison.assetDelta),
    },
    {
      label: '生涯の住居費（控除後・累計）',
      rent: formatMan(rent.housingNet),
      buy: formatMan(buy.housingNet),
      delta: deltaCell(comparison.housingDelta, { goodWhenPositive: false }),
    },
  ];

  setHtml(
    $('#compare-tbody'),
    rows
      .map(
        (row, index) => `<tr${
          (index === 0 && comparison.current === 'rent') ? '' : ''
        }>
          <td>${row.label}</td>
          <td class="is-numeric">${row.rent}</td>
          <td class="is-numeric">${row.buy}</td>
          <td class="is-numeric">${row.delta}</td>
        </tr>`,
      )
      .join(''),
  );

  setText($('#compare-verdict'), buildVerdict(comparison));
}

/**
 * 数字の差を言葉にする。
 * 判断は終端資産（税引後）の差を主軸にする。FIRE達成年齢だけを見ると、
 * ローン返済中の一時的な支出増で購入が不当に不利に見えるため。
 */
function buildVerdict(comparison) {
  const { assetDelta, housingDelta, buy, rent } = comparison;
  const scale = Math.max(1, Math.abs(rent.terminalNetWorth));
  const negligible = Math.abs(assetDelta) / scale < 0.03;

  if (negligible) {
    return `この条件では、賃貸と購入で寿命時点の資産にほとんど差がありません（差 ${formatMan(assetDelta, { signed: true })}）。金銭面では中立のため、住み替えの自由度や住まいへの希望で判断してよい水準です。`;
  }

  const favored = assetDelta > 0 ? '購入' : '賃貸';
  const housingNote =
    housingDelta > 0
      ? `生涯の住居費は購入のほうが ${formatMan(housingDelta)} 多くかかりますが、`
      : `生涯の住居費は購入のほうが ${formatMan(-housingDelta)} 少なく済み、`;

  const fireNote =
    buy.achieved && rent.achieved
      ? comparison.fireDelta === 0
        ? 'FIRE達成年齢は変わりません。'
        : `FIRE達成は購入のほうが ${Math.abs(comparison.fireDelta)} 年 ${comparison.fireDelta > 0 ? '遅く' : '早く'}なります。`
      : '';

  return `${housingNote}寿命時点の資産（税引後）では${favored}が ${formatMan(Math.abs(assetDelta))} 上回ります。${fireNote} ローン完済後に住居費が維持費のみへ下がる効果と、頭金を運用に回せない機会損失の綱引きで決まります。`;
}

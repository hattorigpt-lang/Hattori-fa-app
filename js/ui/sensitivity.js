/**
 * 感度分析（トルネードチャート）の描画。
 *
 * 中央の軸を基準に、左へ伸びる棒は「FIRE前倒し」、右へ伸びる棒は「FIRE後ろ倒し」を表す。
 * 各行の上段が変数を下げたケース、下段が上げたケース。
 */

import { $, setText, setHtml, escapeHtml } from './dom.js';

/** 片側の棒を1本描く。基準からの差分の符号で左右を、大きさで長さを決める。 */
function bar(delta, maxDelta, position, capped) {
  const width = Math.min(50, (Math.abs(delta) / maxDelta) * 50);
  if (width < 0.2) return '';
  const isImprovement = delta < 0; // 達成が早まる＝良い
  const side = isImprovement ? `right:50%` : `left:50%`;
  const classes = [
    'tornado__bar',
    `tornado__bar--${position}`,
    isImprovement ? 'tornado__bar--good' : 'tornado__bar--bad',
    capped ? 'tornado__bar--capped' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<span class="${classes}" style="${side};width:${width}%"></span>`;
}

function formatDelta(entry) {
  if (!entry.achieved) return '未達成';
  const sign = entry.delta > 0 ? '+' : '';
  return `${sign}${entry.delta.toFixed(1)}年`;
}

function toneClass(entry) {
  if (!entry.achieved) return 'text-danger';
  if (entry.delta < -0.05) return 'text-emerald';
  if (entry.delta > 0.05) return 'text-amber';
  return 'text-subtle';
}

function row(item, maxDelta) {
  return `<div class="tornado__row">
    <div class="tornado__label">
      ${escapeHtml(item.label)}
      <small>現在 ${escapeHtml(item.current)} ／ ${escapeHtml(item.deltaLabel)}</small>
    </div>
    <div class="tornado__track">
      <span class="tornado__axis"></span>
      ${bar(item.down.delta, maxDelta, 'top', !item.down.achieved)}
      ${bar(item.up.delta, maxDelta, 'bottom', !item.up.achieved)}
    </div>
    <div class="tornado__values">
      <span class="${toneClass(item.down)}" title="変数を下げた場合">▼ ${formatDelta(item.down)}</span>
      <span class="${toneClass(item.up)}" title="変数を上げた場合">▲ ${formatDelta(item.up)}</span>
    </div>
  </div>`;
}

const NO_IMPACT_THRESHOLD = 0.05;

const EMPTY_MESSAGE = `<p class="tornado__empty">
  現在の条件では、いずれの変数を動かしても想定寿命内にFIREへ到達しません。
  支出・収入・FIRE目標タイプのいずれかを見直したうえで、あらためてご確認ください。
</p>`;

export function renderSensitivity(sensitivity, standard) {
  const baselineNode = $('#sens-baseline');
  if (standard.achieved) {
    setText(
      baselineNode,
      `基準: ${sensitivity.baseline.years.toFixed(1)} 年後（${standard.fireAge} 歳）に達成`,
    );
  } else {
    setText(baselineNode, '基準: 想定寿命内に未達成');
  }

  // どの変数を振っても達成年が動かない場合、棒がすべてゼロ幅になり
  // 「分析が壊れている」ように見えるため、理由を明示する
  if (!standard.achieved && sensitivity.maxDelta < NO_IMPACT_THRESHOLD) {
    setHtml($('#tornado'), EMPTY_MESSAGE);
    return;
  }

  setHtml($('#tornado'), sensitivity.items.map((item) => row(item, sensitivity.maxDelta)).join(''));
}

/* ------------------------------------------------------------------ */
/* 目標逆算                                                            */
/* ------------------------------------------------------------------ */

/** 変化量を「+13%」「-0.66pt」の形に整形する。 */
function formatChange(item) {
  if (item.isRate) {
    const sign = item.delta > 0 ? '+' : '';
    return `${sign}${item.delta.toFixed(2)} pt`;
  }
  if (item.ratio === null) return '—';
  const sign = item.ratio > 0 ? '+' : '';
  return `${sign}${(item.ratio * 100).toFixed(0)} %`;
}

function goalSeekRow(item) {
  if (!item.feasible) {
    return `<tr>
      <td>${escapeHtml(item.label)}</td>
      <td>${escapeHtml(item.currentLabel)}</td>
      <td colspan="2" class="text-subtle">この変数だけでは到達できません（限界 ${escapeHtml(item.limitLabel)}）</td>
    </tr>`;
  }
  return `<tr>
    <td>${escapeHtml(item.label)}</td>
    <td class="text-muted">${escapeHtml(item.currentLabel)}</td>
    <td><span class="goalseek__arrow">→</span><span class="goalseek__required">${escapeHtml(item.requiredLabel)}</span></td>
    <td class="text-brand fw-700">${escapeHtml(formatChange(item))}</td>
  </tr>`;
}

/**
 * 目標逆算の結果を描画する。
 * 感度分析が「傾き」を示すのに対し、こちらは「目標に必要な水準」を示す。
 */
export function renderGoalSeek(goalSeek) {
  const body = $('#goalseek-body');
  if (!body) return;

  if (!goalSeek || !goalSeek.achievable) {
    const message =
      goalSeek?.reason === 'already-early'
        ? `現在の条件では ${goalSeek.targetYearsEarlier} 年より早くFIREに到達するため、逆算する余地がありません。`
        : '現在の条件では想定寿命内にFIREへ到達しないため、逆算できません。';
    setHtml(body, `<p class="goalseek__note">${message}</p>`);
    return;
  }

  setHtml(
    body,
    `<table class="goalseek__table">
      <thead>
        <tr><th>変数</th><th>現在</th><th>必要な水準</th><th>変化</th></tr>
      </thead>
      <tbody>${goalSeek.items.map(goalSeekRow).join('')}</tbody>
    </table>
    <p class="goalseek__note">
      影響の大きい上位${goalSeek.items.length}項目について、その変数<strong>だけ</strong>で
      ${goalSeek.targetYearsEarlier}年の短縮を達成するために必要な水準です。
      実際には複数を組み合わせるため、それぞれの変化幅はこれより小さくて済みます。
    </p>`,
  );
}

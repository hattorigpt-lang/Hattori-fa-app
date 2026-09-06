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

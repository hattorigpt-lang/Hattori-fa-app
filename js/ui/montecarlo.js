/**
 * モンテカルロ分析カードの描画。
 */

import { formatMan, formatAge } from '../formatters.js';
import { $, setText, toggleClass } from './dom.js';

/** 成功率に応じた評価コメント。数値だけでなく「次に何をすべきか」を示す。 */
const VERDICTS = [
  { min: 0.9, tone: 'is-good', text: '非常に高い確度です。現在の計画は市場の変動に対して十分な余裕があります。' },
  { min: 0.75, tone: 'is-good', text: '概ね現実的な計画です。支出の増加余地を見込んでおくとさらに安定します。' },
  { min: 0.5, tone: 'is-warn', text: '5回に1回以上は計画どおりに進みません。支出削減かリタイア時期の後ろ倒しを検討してください。' },
  { min: 0, tone: 'is-bad', text: '計画の再設計が必要です。積立額・目標時期・目標タイプのいずれかを見直してください。' },
];

function verdictFor(rate) {
  return VERDICTS.find((verdict) => rate >= verdict.min) ?? VERDICTS[VERDICTS.length - 1];
}

/**
 * 分析結果を描画する。無効時はカードごと隠す。
 * @param {object|null} mc runMonteCarlo の戻り値。無効時は null
 */
export function renderMonteCarlo(mc) {
  const card = $('#mc-card');
  if (!card) return;

  if (!mc) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  setText(
    $('#mc-note'),
    `${mc.trials.toLocaleString('ja-JP')} 回試行 ／ ボラティリティ ${mc.volatility}%`,
  );

  const percent = mc.successRate * 100;
  setText($('#mc-success'), percent.toFixed(1));

  const gauge = $('#mc-gauge');
  const verdict = verdictFor(mc.successRate);
  if (gauge) {
    gauge.style.width = `${percent}%`;
    ['is-good', 'is-warn', 'is-bad'].forEach((tone) => toggleClass(gauge, tone, tone === verdict.tone));
  }
  setText($('#mc-verdict'), verdict.text);

  setText($('#mc-depletion'), `${(mc.depletionRate * 100).toFixed(1)} %`);
  setText($('#mc-age-p10'), mc.fireAge.p10 === null ? '—' : formatAge(mc.fireAge.p10));
  setText($('#mc-age-p50'), mc.fireAge.p50 === null ? '—' : formatAge(mc.fireAge.p50));
  setText($('#mc-age-p90'), mc.fireAge.p90 === null ? '—' : formatAge(mc.fireAge.p90));
  setText($('#mc-terminal-p50'), formatMan(mc.terminal.p50));
  setText($('#mc-terminal-p10'), formatMan(mc.terminal.p10));

  renderSequenceRisk(mc.sequenceRisk);
}

const percent = (value) => `${(value * 100).toFixed(1)} %`;

/**
 * シーケンス・オブ・リターン・リスクを描画する。
 * 「平均リターンは同じなのに、リタイア直後の数年が不調だと結果がどう変わるか」を
 * 3分割で並べ、リスクの正体を数値で示す。
 */
function renderSequenceRisk(risk) {
  const container = $('#seq-risk');
  if (!container) return;
  if (!risk) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  setText($('#seq-risk-window'), `（リタイア直後 ${risk.windowYears} 年の運用成績で分類）`);

  const cells = [
    ['#seq-worst', '#seq-worst-sub', risk.worst],
    ['#seq-overall', '#seq-overall-sub', risk.overall],
    ['#seq-best', '#seq-best-sub', risk.best],
  ];
  cells.forEach(([valueId, subId, group]) => {
    setText($(valueId), percent(group.depletionRate));
    setText($(subId), `資産が尽きる確率 ／ 年率 ${percent(group.medianReturn)}`);
  });

  const ratio = risk.best.depletionRate > 0
    ? risk.worst.depletionRate / risk.best.depletionRate
    : null;
  setText(
    $('#seq-risk-note'),
    `同じ平均リターンでも、リタイア直後${risk.windowYears}年が不調だった場合、資産が尽きる確率は ` +
      `${percent(risk.best.depletionRate)} から ${percent(risk.worst.depletionRate)} へ` +
      `${ratio ? `約${ratio.toFixed(1)}倍に` : ''}跳ね上がります。` +
      'リタイア直前は現金比率を高める、当初数年の取り崩し額を抑えるなどの備えが有効です。',
  );
}

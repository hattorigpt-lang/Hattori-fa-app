/**
 * シナリオ比較表と年次キャッシュフロー明細の描画。
 *
 * 年次明細は最大90行程度になるため、折りたたみが開いているときだけ描画する
 * （閉じている間の描画コストをゼロにする遅延レンダリング）。
 */

import { formatMan, formatMonthly, formatAge } from '../formatters.js';
import { $, setText, setHtml, escapeHtml } from './dom.js';

/* ------------------------------------------------------------------ */
/* シナリオ比較表                                                        */
/* ------------------------------------------------------------------ */

function scenarioRow(scenario) {
  const highlight = scenario.key === 'standard' ? ' class="is-highlight"' : '';
  const achievement = scenario.achieved
    ? `<strong>${scenario.fireAge} 歳</strong> <span class="text-subtle">(${scenario.fireYear}年後)</span>`
    : '<span class="text-subtle">想定寿命内に未達成</span>';
  const assetsAtFire = scenario.assetsAtFire === null ? '—' : formatMan(scenario.assetsAtFire);
  const monthly = scenario.achieved
    ? `<strong style="color:${scenario.color}">${formatMonthly(scenario.sustainableMonthlySpend)}</strong>`
    : '—';
  const terminal = scenario.depleted
    ? `<span class="text-danger fw-700">${formatAge(scenario.depletionAge)}で枯渇</span>`
    : `<span class="text-muted">${formatMan(scenario.terminalAssets)} 残存</span>`;

  return `<tr${highlight}>
    <td>
      <span class="row-scenario" style="color:${scenario.color}">
        <span class="asset-row__dot" style="background:${scenario.color}"></span>
        ${escapeHtml(scenario.label)} ${(scenario.yieldStock * 100).toFixed(1)}%
      </span>
    </td>
    <td>${achievement}</td>
    <td class="is-numeric">${formatMan(scenario.displayTarget)}</td>
    <td class="is-numeric">${assetsAtFire}</td>
    <td class="is-numeric">${monthly}</td>
    <td>${terminal}</td>
  </tr>`;
}

export function renderScenarioTable(result) {
  setHtml($('#scenario-tbody'), result.scenarios.map(scenarioRow).join(''));
}

/* ------------------------------------------------------------------ */
/* 年次キャッシュフロー明細                                              */
/* ------------------------------------------------------------------ */

let latestRows = [];
let panel = null;
let trigger = null;

function timelineRow(row) {
  const classes = [];
  if (row.eventsCost > 0) classes.push('is-event');
  if (row.isFireYear) classes.push('is-fire');

  const eventCell =
    row.eventsCost > 0
      ? `<span class="text-amber fw-700" title="${escapeHtml(row.eventNames.join('、'))}">-${formatMan(row.eventsCost, { withUnit: false })}</span>`
      : '<span class="text-subtle">—</span>';

  const flowClass = row.netFlow >= 0 ? 'text-brand' : 'text-danger fw-700';
  const ageLabel = row.isFireYear
    ? `<strong>${row.age} 歳</strong> <span class="badge badge--brand">FIRE</span>`
    : `<strong>${row.age} 歳</strong>`;

  return `<tr${classes.length ? ` class="${classes.join(' ')}"` : ''}>
    <td>${ageLabel}</td>
    <td class="text-subtle">${row.year} 年目</td>
    <td class="is-numeric text-emerald">${formatMan(row.income, { withUnit: false })}</td>
    <td class="is-numeric text-muted">${formatMan(row.baseExpense, { withUnit: false })}</td>
    <td class="is-numeric">${eventCell}</td>
    <td class="is-numeric ${flowClass}">${formatMan(row.netFlow, { withUnit: false, signed: true })}</td>
    <td class="is-numeric fw-700">${formatMan(row.endAssets, { withUnit: false })}</td>
    <td class="is-numeric text-muted">${formatMan(row.endNetWorth, { withUnit: false })}</td>
  </tr>`;
}

function paint() {
  if (!panel || panel.hidden) return;
  setHtml($('#timeline-tbody'), latestRows.map(timelineRow).join(''));
}

/** 最新の試算結果を保持し、開いていれば即時描画する。 */
export function renderTimeline(result) {
  latestRows = result.standard.rows;
  setText($('#timeline-scenario'), `標準 ${(result.standard.yieldStock * 100).toFixed(1)}%`);
  paint();
}

export function initTimeline() {
  panel = $('#timeline-panel');
  trigger = $('#timeline-trigger');
  if (!panel || !trigger) return;

  trigger.addEventListener('click', () => {
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', String(willOpen));
    setText($('#timeline-toggle-text'), willOpen ? '折りたたむ' : '表示する');
    if (willOpen) paint();
  });
}

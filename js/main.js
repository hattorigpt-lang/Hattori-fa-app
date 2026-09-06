/**
 * エントリポイント。
 * 状態ストア・計算エンジン・各UIモジュールを配線するだけに責務を限定する。
 */

import { PRESET_EVENTS } from './config.js';
import {
  getState, subscribe, replace, reset, addEvent, replaceEvents, sanitizeState,
} from './state.js';
import { runSimulation } from './simulator.js';
import {
  saveToStorage, loadFromStorage, loadFromUrl, stripShareParam,
  buildShareUrl, copyToClipboard, storageEnabled,
} from './persistence.js';

import { $, setText, showToast, debounce } from './ui/dom.js';
import { initInputs, syncInputs } from './ui/inputs.js';
import { initEvents, renderEvents } from './ui/events.js';
import { renderAssetSummary, renderExpenseSummary, renderKpi, renderAlerts } from './ui/kpi.js';
import { renderScenarioTable, renderTimeline, initTimeline } from './ui/tables.js';
import { initChart, renderChart } from './ui/chart.js';

let renderHandle = null;

/* ------------------------------------------------------------------ */
/* 描画                                                                */
/* ------------------------------------------------------------------ */

/**
 * 状態から結果を再計算し、全ビューを更新する。
 * 1フレームに1回へ束ねることで、連続入力時の過剰な再計算を防ぐ。
 */
function scheduleRender() {
  if (renderHandle !== null) return;
  renderHandle = window.requestAnimationFrame(() => {
    renderHandle = null;
    render();
  });
}

function render() {
  const state = getState();
  const result = runSimulation(state);

  syncInputs(state);
  renderEvents(state);
  renderAssetSummary(state);
  renderExpenseSummary(state);

  renderKpi(result);
  renderAlerts(state, result);
  renderChart(result);
  renderScenarioTable(result);
  renderTimeline(result);
}

/* ------------------------------------------------------------------ */
/* 永続化                                                              */
/* ------------------------------------------------------------------ */

const persist = debounce(() => {
  const saved = saveToStorage(getState());
  setText($('#save-indicator-text'), saved ? '保存しました' : '保存できません');
  window.setTimeout(() => setText($('#save-indicator-text'), '自動保存'), 1800);
}, 600);

/**
 * 起動時の状態を決定する。
 * 優先順位: 共有URL > localStorage > 既定値。
 * 共有URLで開いた場合は、閲覧者の保存内容を上書きしないようアドレスバーを整理する。
 */
function restoreInitialState() {
  const fromUrl = loadFromUrl();
  if (fromUrl) {
    replace(fromUrl, { source: 'url' });
    stripShareParam();
    showToast('共有された条件を読み込みました');
    return;
  }
  const fromStorage = loadFromStorage();
  if (fromStorage) {
    replace(fromStorage, { source: 'storage' });
  }
}

/* ------------------------------------------------------------------ */
/* ヘッダー・操作系                                                     */
/* ------------------------------------------------------------------ */

function initActions() {
  $('#share-btn')?.addEventListener('click', async () => {
    const url = buildShareUrl(getState());
    const copied = await copyToClipboard(url);
    showToast(copied ? '共有リンクをコピーしました' : 'コピーできませんでした。URLを手動で取得してください');
  });

  $('#reset-btn')?.addEventListener('click', () => {
    reset();
    showToast('初期値に戻しました');
  });

  $('#add-event-btn')?.addEventListener('click', () => {
    const event = addEvent();
    // 追加直後の行の名称欄へフォーカスし、そのまま入力を続けられるようにする
    window.requestAnimationFrame(() => {
      const input = document.querySelector(`tr[data-event-id="${event.id}"] [data-event-field="name"]`);
      input?.focus();
      input?.select();
    });
  });

  $('#preset-btn')?.addEventListener('click', () => {
    replaceEvents(PRESET_EVENTS);
    showToast('定番のライフイベントを読み込みました');
  });

  if (!storageEnabled) {
    setText($('#save-indicator-text'), '保存無効');
  }
}

/* ------------------------------------------------------------------ */
/* 起動                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  initInputs();
  initEvents();
  initTimeline();
  initChart();
  initActions();

  restoreInitialState();

  subscribe(() => {
    scheduleRender();
    persist();
  });

  render();

  // Chart.js は defer 読み込みのため、初回描画時にまだ未定義の場合がある。
  // 読み込み完了後に一度だけ再描画してグラフを確実に表示する。
  if (typeof window.Chart === 'undefined') {
    window.addEventListener('load', () => render(), { once: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// デバッグ用の最小限の公開（コンソールから状態を確認・投入できるようにする）
window.fireSimulator = { getState, runSimulation, sanitizeState, replace };

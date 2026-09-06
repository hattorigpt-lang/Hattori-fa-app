/**
 * ライフイベント表の描画と操作。
 *
 * 旧実装は入力のたびに tbody 全体を innerHTML で作り直し、
 * そのつどリスナーを貼り直していた（＝重い・入力中にフォーカスが飛ぶ）。
 * ここでは行を再利用する差分レンダリングと、tbody 1箇所へのイベント委譲に置き換える。
 */

import { FIELD_RULES } from '../config.js';
import { coerceField, updateEvent, removeEvent, patch, getState } from '../state.js';
import { $, setText, escapeHtml, icon } from './dom.js';

const rowCache = new Map();
let tbody = null;

const ROW_TEMPLATE = (event) => `
  <td>
    <input class="field__input" type="text" maxlength="40" data-event-field="name"
           value="${escapeHtml(event.name)}" aria-label="イベント名">
  </td>
  <td>
    <div class="field__control">
      <input class="field__input field__input--year" type="number" inputmode="numeric"
             min="${FIELD_RULES.eventYear.min}" max="${FIELD_RULES.eventYear.max}" step="1"
             data-event-field="year" value="${event.year}" aria-label="発生年（何年後）">
      <span class="field__suffix">年</span>
    </div>
  </td>
  <td>
    <div class="field__control">
      <input class="field__input field__input--cost" type="number" inputmode="decimal"
             min="${FIELD_RULES.eventCost.min}" max="${FIELD_RULES.eventCost.max}" step="10"
             data-event-field="cost" value="${event.cost}" aria-label="費用（万円）">
      <span class="field__suffix">万</span>
    </div>
  </td>
  <td>
    <button type="button" class="btn btn--icon" data-event-action="delete"
            title="削除" aria-label="このイベントを削除">${icon('i-trash')}</button>
  </td>
`;

const EMPTY_ROW = `
  <tr class="event-table__empty">
    <td colspan="4">ライフイベントは登録されていません。下のボタンから追加できます。</td>
  </tr>
`;

/** 経過年の昇順に並べ替えた配列を返す（元配列は破壊しない）。 */
function sortedByYear(events) {
  return [...events].sort((a, b) => a.year - b.year || a.id - b.id);
}

function createRow(event) {
  const tr = document.createElement('tr');
  tr.dataset.eventId = String(event.id);
  tr.innerHTML = ROW_TEMPLATE(event);
  return tr;
}

/** 編集中の入力欄は上書きしない。 */
function updateRow(tr, event) {
  tr.querySelectorAll('[data-event-field]').forEach((input) => {
    if (document.activeElement === input) return;
    const next = String(event[input.dataset.eventField]);
    if (input.value !== next) input.value = next;
  });
}

/**
 * イベント一覧を描画する。行の生成・削除・並べ替えを最小限の DOM 操作で行う。
 */
export function renderEvents(state) {
  if (!tbody) return;
  const events = sortedByYear(state.events);
  setText($('#event-count'), `${events.length} 件`);

  if (events.length === 0) {
    if (tbody.dataset.empty !== 'true') {
      tbody.innerHTML = EMPTY_ROW;
      tbody.dataset.empty = 'true';
      rowCache.clear();
    }
    return;
  }
  if (tbody.dataset.empty === 'true') {
    tbody.innerHTML = '';
    tbody.dataset.empty = 'false';
  }

  const seen = new Set();
  events.forEach((event, index) => {
    seen.add(event.id);
    let tr = rowCache.get(event.id);
    if (!tr) {
      tr = createRow(event);
      rowCache.set(event.id, tr);
    } else {
      updateRow(tr, event);
    }
    // 正しい位置になければ移動する（既に正しい場合 DOM は触らない）
    if (tbody.children[index] !== tr) {
      tbody.insertBefore(tr, tbody.children[index] ?? null);
    }
  });

  rowCache.forEach((tr, id) => {
    if (seen.has(id)) return;
    tr.remove();
    rowCache.delete(id);
  });
}

/** tbody へイベント委譲を1度だけ設定する。 */
export function initEvents() {
  tbody = $('#event-tbody');
  if (!tbody) return;

  tbody.addEventListener('input', (domEvent) => {
    const input = domEvent.target.closest('[data-event-field]');
    if (!input) return;
    const id = Number(input.closest('tr')?.dataset.eventId);
    const field = input.dataset.eventField;
    if (field === 'name') {
      updateEvent(id, { name: input.value });
    } else if (input.value.trim() !== '' && Number.isFinite(parseFloat(input.value))) {
      const ruleKey = field === 'year' ? 'eventYear' : 'eventCost';
      updateEvent(id, { [field]: coerceField(ruleKey, input.value).value });
    }
  });

  // 確定時に丸めとクランプを行い、経過年で並べ替える
  tbody.addEventListener('change', (domEvent) => {
    const input = domEvent.target.closest('[data-event-field]');
    if (!input) return;
    const id = Number(input.closest('tr')?.dataset.eventId);
    const field = input.dataset.eventField;

    if (field === 'name') {
      const name = input.value.trim() || '無題のイベント';
      input.value = name;
      updateEvent(id, { name });
      return;
    }

    const ruleKey = field === 'year' ? 'eventYear' : 'eventCost';
    const { value } = coerceField(ruleKey, input.value);
    input.value = String(value);
    updateEvent(id, { [field]: value });
    if (field === 'year') patch({ events: sortedByYear(getState().events) });
  });

  tbody.addEventListener('click', (domEvent) => {
    const button = domEvent.target.closest('[data-event-action="delete"]');
    if (!button) return;
    const id = Number(button.closest('tr')?.dataset.eventId);
    removeEvent(id);
  });
}

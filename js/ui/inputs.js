/**
 * 入力フォームと状態ストアの双方向バインディング。
 *
 * HTML 側の [data-field="キー名"] を唯一の接点とすることで、
 * 「要素IDを1つずつ手動でキャッシュする」旧実装の冗長さと更新漏れを解消する。
 */

import { FIELD_RULES, FIRE_TYPES, TRIAL_OPTIONS } from '../config.js';
import { estimatePension } from '../pension.js';
import { coerceField, patch, normalizeAges, getState } from '../state.js';
import { $, $$, setText, toggleClass } from './dom.js';

/** data-field を持つ全要素を収集する。 */
function collectBoundElements() {
  return $$('[data-field]');
}

/** FIELD_RULES から min/max/step を DOM へ反映し、ブラウザ標準のUIとも整合させる。 */
function applyRules(element, key) {
  const rule = FIELD_RULES[key];
  if (!rule || element.type !== 'number') return;
  element.min = String(rule.min);
  element.max = String(rule.max);
  if (!element.step) element.step = rule.integer ? '1' : 'any';
}

/** FIRE目標タイプの選択肢を config から生成する（HTML と定義の二重管理を避ける）。 */
function populateFireTypes(select) {
  if (!select || select.options.length > 0) return;
  Object.entries(FIRE_TYPES).forEach(([value, def]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = def.label;
    select.appendChild(option);
  });
}

/** モンテカルロの試行回数の選択肢を生成する。 */
function populateTrialOptions(select) {
  if (!select || select.options.length > 0) return;
  TRIAL_OPTIONS.forEach((count) => {
    const option = document.createElement('option');
    option.value = String(count);
    option.textContent = `${count.toLocaleString('ja-JP')} 回`;
    select.appendChild(option);
  });
}

/**
 * 入力バインディングを初期化する。
 * @param {(patchObject: object) => void} onChange 状態へ反映する際のコールバック
 */
export function initInputs() {
  populateFireTypes($('[data-field="fireType"]'));
  populateTrialOptions($('[data-field="trials"]'));

  collectBoundElements().forEach((element) => {
    const key = element.dataset.field;
    applyRules(element, key);

    if (element.type === 'checkbox') {
      element.addEventListener('change', () => {
        patch({ [key]: element.checked });
      });
      return;
    }

    if (element.tagName === 'SELECT') {
      element.addEventListener('change', () => {
        // data-type="number" の select は数値として状態へ入れる
        const value = element.dataset.type === 'number' ? Number(element.value) : element.value;
        patch({ [key]: value });
      });
      return;
    }

    // 数値入力: 入力中は素直に反映し、確定時（blur/change）に丸めとクランプを行う。
    element.addEventListener('input', () => {
      const { value } = coerceField(key, element.value);
      // 入力途中の空文字や '-' で状態を壊さないよう、パース可能なときだけ反映する
      if (element.value.trim() !== '' && Number.isFinite(parseFloat(element.value))) {
        patch({ [key]: value });
      }
    });

    element.addEventListener('change', () => {
      const { value, invalid } = coerceField(key, element.value);
      element.value = String(value);
      markInvalid(element, invalid, key);
      const next = { [key]: value };
      // 年齢は相互依存するため、確定時に整合性を取り直す
      if (key === 'currentAge' || key === 'deathAge') {
        const merged = normalizeAges({ ...getState(), ...next });
        next.currentAge = merged.currentAge;
        next.deathAge = merged.deathAge;
      }
      patch(next);
    });
  });
}

/** 範囲外入力の視覚的フィードバック。 */
function markInvalid(element, invalid, key) {
  const wrap = element.closest('.field');
  toggleClass(element, 'is-invalid', invalid);
  if (!wrap) return;
  toggleClass(wrap, 'is-invalid', invalid);
  const rule = FIELD_RULES[key];
  const errorNode = wrap.querySelector('.field__error');
  if (errorNode && rule) {
    setText(errorNode, invalid ? `${rule.label}は ${rule.min} 〜 ${rule.max} の範囲で入力してください。` : '');
  }
  if (invalid) {
    window.setTimeout(() => {
      toggleClass(element, 'is-invalid', false);
      toggleClass(wrap, 'is-invalid', false);
    }, 2600);
  }
}

/**
 * 状態 → フォームへの反映。
 * 編集中の要素は上書きしない（カーソル位置が飛ぶのを防ぐ）。
 */
export function syncInputs(state) {
  collectBoundElements().forEach((element) => {
    const key = element.dataset.field;
    const value = state[key];
    if (value === undefined) return;

    if (element.type === 'checkbox') {
      if (element.checked !== value) element.checked = value;
      return;
    }
    if (document.activeElement === element) return;
    const next = String(value);
    if (element.value !== next) element.value = next;
  });

  // NISA の利回りは株式と同率のため、読み取り専用欄へミラーリングする
  const mirror = $('#mirror-yield-nisa');
  if (mirror) mirror.value = Number(state.yieldStock).toFixed(1);

  const hint = $('#fire-type-hint');
  setText(hint, FIRE_TYPES[state.fireType]?.hint ?? '');

  // インフレ／昇給の率入力は、トグルOFF時に無効化して「効いていない」ことを明示する
  toggleDependentRate('inflationRate', state.inflationEnabled);
  toggleDependentRate('salaryGrowthRate', state.salaryGrowthEnabled);
  toggleDependentRate('volatility', state.monteCarloEnabled);
  toggleDependentRate('trials', state.monteCarloEnabled);

  const spouseDetail = $('#spouse-detail');
  if (spouseDetail) spouseDetail.hidden = !state.spouseEnabled;

  const startRow = $('#pension-start-row');
  if (startRow) startRow.hidden = !state.pensionAuto;
}

/**
 * 年金の自動推計をフォームへ反映する。
 * 推計値は state を書き換えず、表示だけを差し替える
 * （自動推計をOFFに戻したとき、手入力していた値が失われないようにするため）。
 */
export function renderPensionEstimate(state, members) {
  const badge = $('#pension-auto-badge');
  const spouseBadge = $('#spouse-pension-auto-badge');
  const breakdown = $('#pension-breakdown');
  const selfInput = $('[data-field="pensionMonthly"]');
  const spouseInput = $('[data-field="spousePensionMonthly"]');

  if (badge) badge.hidden = !state.pensionAuto;
  if (spouseBadge) spouseBadge.hidden = !state.pensionAuto;
  if (breakdown) breakdown.hidden = !state.pensionAuto;

  [selfInput, spouseInput].forEach((input) => {
    if (!input) return;
    input.readOnly = state.pensionAuto;
    input.tabIndex = state.pensionAuto ? -1 : 0;
  });

  if (!state.pensionAuto) return;

  members.forEach((member) => {
    const input = member.key === 'self' ? selfInput : spouseInput;
    if (input && document.activeElement !== input) {
      input.value = member.pensionMonthly.toFixed(1);
    }
  });

  const self = members[0];
  const estimate = estimatePension(self.annualIncome, state.pensionStartWorkAge);
  setText(
    breakdown,
    `基礎 ${estimate.basicAnnual.toFixed(0)}万円 ＋ 厚生 ${estimate.employeeAnnual.toFixed(0)}万円 ` +
      `＝ 年額 ${estimate.grossAnnual.toFixed(0)}万円（加入 ${estimate.enrolledYears}年 / ` +
      `平均標準報酬 ${estimate.standardRemuneration.toFixed(0)}万円）`,
  );
}

function toggleDependentRate(key, enabled) {
  const input = $(`[data-field="${key}"]`);
  if (!input) return;
  input.disabled = !enabled;
  input.style.opacity = enabled ? '' : '0.45';
}

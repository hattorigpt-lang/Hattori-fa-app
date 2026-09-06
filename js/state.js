/**
 * アプリケーションの単一状態ストア。
 * 状態の書き換えは必ず patch()/replace() を経由し、購読者へ変更を通知する。
 * グローバル変数への直接代入を排除することで、更新漏れと副作用の追跡困難さを防ぐ。
 */

import { DEFAULT_STATE, FIELD_RULES } from './config.js';

let state = cloneState(DEFAULT_STATE);
let nextEventId = computeNextEventId(state.events);
const listeners = new Set();

/** 状態の深いコピー。events 配列の共有参照による意図しない書き換えを防ぐ。 */
export function cloneState(source) {
  return {
    ...source,
    events: source.events.map((event) => ({ ...event })),
  };
}

function computeNextEventId(events) {
  return events.reduce((max, event) => Math.max(max, Number(event.id) || 0), 0) + 1;
}

/** 現在の状態のスナップショットを返す（呼び出し側からの破壊的変更を防ぐためコピー）。 */
export function getState() {
  return cloneState(state);
}

/** 状態変更の購読。戻り値を呼ぶと購読を解除できる。 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(meta) {
  const snapshot = getState();
  listeners.forEach((listener) => listener(snapshot, meta));
}

/**
 * 部分更新。値が実際に変化した場合のみ通知し、無駄な再計算を避ける。
 * @param {object} partial 更新したいキーと値
 * @param {object} [meta] 購読者へ渡す補足情報（例: { source: 'reset' }）
 */
export function patch(partial, meta = {}) {
  let changed = false;
  Object.entries(partial).forEach(([key, value]) => {
    if (key === 'events') {
      state.events = value.map((event) => ({ ...event }));
      changed = true;
      return;
    }
    if (state[key] !== value) {
      state[key] = value;
      changed = true;
    }
  });
  if (changed) notify(meta);
  return changed;
}

/** 状態全体を置き換える（復元・リセット用）。 */
export function replace(next, meta = {}) {
  state = sanitizeState(next);
  nextEventId = computeNextEventId(state.events);
  notify({ ...meta, full: true });
}

/** 初期値に戻す。 */
export function reset() {
  replace(cloneState(DEFAULT_STATE), { source: 'reset' });
}

/* ------------------------------------------------------------------ */
/* ライフイベント操作                                                    */
/* ------------------------------------------------------------------ */

export function addEvent(partial = {}) {
  const event = {
    id: nextEventId++,
    name: partial.name ?? '新規イベント',
    year: partial.year ?? 5,
    cost: partial.cost ?? 100,
  };
  state.events = [...state.events, event];
  notify({ source: 'event:add', eventId: event.id });
  return event;
}

export function updateEvent(id, partial) {
  const target = state.events.find((event) => event.id === id);
  if (!target) return false;
  const changed = Object.entries(partial).some(([key, value]) => target[key] !== value);
  if (!changed) return false;
  Object.assign(target, partial);
  notify({ source: 'event:update', eventId: id });
  return true;
}

export function removeEvent(id) {
  const before = state.events.length;
  state.events = state.events.filter((event) => event.id !== id);
  if (state.events.length === before) return false;
  notify({ source: 'event:remove', eventId: id });
  return true;
}

export function replaceEvents(events) {
  state.events = events.map((event, index) => ({
    id: index + 1,
    name: event.name,
    year: event.year,
    cost: event.cost,
  }));
  nextEventId = state.events.length + 1;
  notify({ source: 'event:replace' });
}

/* ------------------------------------------------------------------ */
/* バリデーション                                                        */
/* ------------------------------------------------------------------ */

/** 単一フィールドを丸め込み、範囲外なら境界値へクランプする。 */
export function coerceField(key, rawValue) {
  const rule = FIELD_RULES[key];
  const parsed = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue);
  if (!Number.isFinite(parsed)) return { value: rule ? rule.min : 0, invalid: true };
  if (!rule) return { value: parsed, invalid: false };

  let value = rule.integer ? Math.round(parsed) : parsed;
  let invalid = false;
  if (value < rule.min) {
    value = rule.min;
    invalid = true;
  }
  if (value > rule.max) {
    value = rule.max;
    invalid = true;
  }
  return { value, invalid };
}

/** 外部由来（URL・localStorage）の状態を安全な形へ正規化する。 */
export function sanitizeState(raw) {
  const base = cloneState(DEFAULT_STATE);
  if (!raw || typeof raw !== 'object') return base;

  Object.keys(base).forEach((key) => {
    if (key === 'events') return;
    const value = raw[key];
    if (value === undefined || value === null) return;

    if (typeof base[key] === 'boolean') {
      base[key] = Boolean(value);
    } else if (typeof base[key] === 'number') {
      base[key] = coerceField(key, value).value;
    } else if (typeof base[key] === 'string') {
      base[key] = String(value);
    }
  });

  if (Array.isArray(raw.events)) {
    base.events = raw.events.slice(0, 40).map((event, index) => ({
      id: index + 1,
      name: String(event?.name ?? 'イベント').slice(0, 40),
      year: coerceField('eventYear', event?.year).value,
      cost: coerceField('eventCost', event?.cost).value,
    }));
  }

  return normalizeAges(base);
}

/**
 * 年齢の整合性を担保する。想定寿命が現在年齢以下という論理破綻を許容しない。
 * @returns {object} 補正後の状態
 */
export function normalizeAges(target) {
  if (target.deathAge <= target.currentAge) {
    target.deathAge = Math.min(FIELD_RULES.deathAge.max, target.currentAge + 1);
  }
  return target;
}

/**
 * 状態全体を検査し、警告メッセージの配列を返す。
 * クランプ済みの値でも「利用者に伝えるべき前提の歪み」はここで検出する。
 */
export function collectWarnings(current) {
  const warnings = [];
  const annualIncome = current.monthlyIncome * 12 + current.annualBonus;
  const annualExpense =
    (current.monthlyFixed + current.monthlyVar) * 12 + current.annualFixed + current.annualVar;

  if (current.deathAge <= current.currentAge) {
    warnings.push({ field: 'deathAge', message: '想定寿命は現在の年齢より大きい値にしてください。' });
  }
  if (annualIncome <= 0) {
    warnings.push({ field: 'monthlyIncome', message: '収入が0のため、資産は取り崩しのみで推移します。' });
  }
  if (annualExpense > annualIncome) {
    warnings.push({
      field: 'monthlyFixed',
      message: '年間支出が年間収入を上回っています。毎年赤字となる前提で試算します。',
    });
  }
  if (current.assetNisa > 0 && !current.nisaEnabled) {
    warnings.push({
      field: 'assetNisa',
      message: 'NISA運用がOFFのため、NISA資産も課税口座として扱われます。',
    });
  }
  if (current.housingEnabled && current.housingPurchase) {
    const duplicated = current.events.find((event) => /住宅|マイホーム|家|住居/.test(event.name));
    if (duplicated) {
      warnings.push({
        field: 'housingEnabled',
        message: `住居費を試算中のため、ライフイベント「${duplicated.name}」と二重計上になっていないかご確認ください。`,
      });
    }
    if (current.housingDownPayment + current.housingFees > current.assetCash + current.assetNisa + current.assetStock + current.assetOther) {
      warnings.push({
        field: 'housingDownPayment',
        message: '頭金と諸費用の合計が現在の総資産を上回っています。購入時までの積立で賄える前提で試算します。',
      });
    }
  }

  const horizon = current.deathAge - current.currentAge;
  current.events.forEach((event) => {
    if (event.year > horizon) {
      warnings.push({
        field: `event:${event.id}`,
        message: `「${event.name}」は想定寿命（${horizon}年後）より先のため試算に含まれません。`,
      });
    }
  });
  return warnings;
}

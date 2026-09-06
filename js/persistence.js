/**
 * 状態の永続化と共有。
 * - localStorage: 入力内容の自動保存／復元
 * - URLハッシュ : 条件をリンクとして共有（サーバー送信を伴わないハッシュ部を使用）
 *
 * 外部由来のデータは必ず state.sanitizeState() を通してから採用し、
 * 壊れた保存データや改変されたURLでアプリが停止しないようにする。
 */

import { STORAGE_KEY, SHARE_PARAM, DEFAULT_STATE } from './config.js';
import { sanitizeState } from './state.js';

/** 保存対象のキー。将来キーが増えても、意図しない内部状態が混入しないよう明示列挙する。 */
const PERSISTED_KEYS = Object.keys(DEFAULT_STATE);

function pickPersisted(state) {
  const payload = {};
  PERSISTED_KEYS.forEach((key) => {
    payload[key] = state[key];
  });
  // イベントは id を持たせず配列順で保持し、共有URLを短く保つ
  payload.events = state.events.map((event) => [event.name, event.year, event.cost]);
  return payload;
}

function expandPersisted(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const restored = { ...payload };
  if (Array.isArray(payload.events)) {
    restored.events = payload.events.map((event, index) =>
      Array.isArray(event)
        ? { id: index + 1, name: event[0], year: event[1], cost: event[2] }
        : { ...event, id: index + 1 },
    );
  }
  return restored;
}

/* ------------------------------------------------------------------ */
/* localStorage                                                        */
/* ------------------------------------------------------------------ */

/** localStorage が使用できるか（プライベートモード等での例外を吸収）。 */
function storageAvailable() {
  try {
    const probe = '__fire_sim_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const canUseStorage = typeof window !== 'undefined' && storageAvailable();

export function saveToStorage(state) {
  if (!canUseStorage) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pickPersisted(state)));
    return true;
  } catch {
    return false;
  }
}

export function loadFromStorage() {
  if (!canUseStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeState(expandPersisted(JSON.parse(raw)));
  } catch {
    return null;
  }
}

export function clearStorage() {
  if (!canUseStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 保存領域が使えない環境では何もしない */
  }
}

/* ------------------------------------------------------------------ */
/* URL共有                                                              */
/* ------------------------------------------------------------------ */

/** UTF-8 を安全に base64url へ変換する（日本語のイベント名を含むため）。 */
function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(encoded) {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 現在の状態を埋め込んだ共有URLを生成する。 */
export function buildShareUrl(state) {
  const encoded = encodeBase64Url(JSON.stringify(pickPersisted(state)));
  const url = new URL(window.location.href);
  url.hash = `${SHARE_PARAM}=${encoded}`;
  return url.toString();
}

/** URLハッシュに共有データが含まれていれば状態として復元する。 */
export function loadFromUrl() {
  if (typeof window === 'undefined' || !window.location.hash) return null;
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const encoded = params.get(SHARE_PARAM);
  if (!encoded) return null;
  try {
    return sanitizeState(expandPersisted(JSON.parse(decodeBase64Url(encoded))));
  } catch {
    return null;
  }
}

/** 共有パラメータをURLから取り除く（復元後にアドレスバーを綺麗に保つ）。 */
export function stripShareParam() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState(null, '', url.toString());
}

/** クリップボードへコピー。Clipboard API が使えない環境では選択方式にフォールバックする。 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* フォールバックへ */
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export const storageEnabled = canUseStorage;

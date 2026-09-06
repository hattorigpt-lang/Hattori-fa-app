/** DOM 操作の薄いヘルパー。querySelector の繰り返しと textContent 更新を集約する。 */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/** 値が変わったときだけ textContent を書き換える（不要な再描画とスクリーンリーダーの再読み上げを防ぐ）。 */
export function setText(element, text) {
  if (!element) return;
  const next = String(text);
  if (element.textContent !== next) element.textContent = next;
}

export function setHtml(element, html) {
  if (!element) return;
  if (element.innerHTML !== html) element.innerHTML = html;
}

export function toggleClass(element, className, on) {
  if (!element) return;
  element.classList.toggle(className, Boolean(on));
}

/** SVG スプライトのアイコン要素を生成する。 */
export function icon(id, extraClass = '') {
  return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#${id}"/></svg>`;
}

/** HTML へ挿入するテキストのエスケープ（イベント名などのユーザー入力用）。 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

let toastTimer = null;

/** 画面下部に一時的な通知を表示する。 */
export function showToast(message, { duration = 2400 } = {}) {
  const toast = $('#toast');
  if (!toast) return;
  toast.innerHTML = `${icon('i-check')}<span>${escapeHtml(message)}</span>`;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), duration);
}

/** 指定ミリ秒だけ呼び出しをまとめる（連続入力による再計算ラッシュを抑える）。 */
export function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

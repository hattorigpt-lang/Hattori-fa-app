/**
 * 表示用の整形関数群。表記ゆれを防ぐため、画面に出る数値は必ずここを経由させる。
 */

const MAN_YEN = ' 万円';

/** 万円単位の金額を「1,234 万円」形式に整形する。1億円以上は「1.23 億円」を併記する。 */
export function formatMan(value, { withUnit = true, signed = false } = {}) {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  const sign = signed && rounded > 0 ? '+' : '';
  return `${sign}${rounded.toLocaleString('ja-JP')}${withUnit ? MAN_YEN : ''}`;
}

/** 1億円を超える額に「（1.2億円）」の補助表記を返す。閾値未満なら空文字。 */
export function formatOku(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 10000) return '';
  return `${(value / 10000).toFixed(2)} 億円`;
}

/** 月額を小数1桁で整形する。 */
export function formatMonthly(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} 万円`;
}

/** パーセント表記。 */
export function formatPercent(rate, digits = 1) {
  if (!Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(digits)} %`;
}

/** 年齢表記。 */
export function formatAge(age) {
  return Number.isFinite(age) ? `${age} 歳` : '—';
}

/**
 * FIRE達成結果を「46 歳（16年後）」形式に整形する。未達成時は理由が伝わる文言を返す。
 */
export function formatFireAchievement(result, { compact = false } = {}) {
  if (!result.achieved) return compact ? '未達成' : '想定寿命内に未達成';
  return compact ? `${result.fireAge} 歳` : `${result.fireAge} 歳（${result.fireYear}年後）`;
}

/** グラフ軸などで使う短縮表記（1,200万 → 1,200万 / 12,000万 → 1.2億）。 */
export function formatAxis(value) {
  if (!Number.isFinite(value)) return '';
  if (value === 0) return '0';
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)} 億`;
  return `${Math.round(value).toLocaleString('ja-JP')} 万`;
}

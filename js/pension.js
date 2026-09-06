/**
 * 公的年金の受給見込み額の概算。
 *
 * 「65歳以降の年金 月額」を手入力させても、多くの利用者はこの金額を把握していない。
 * 感度分析では年金が上位のレバーになることが多く、ここが当てずっぽうだと
 * 結論全体の信頼性が落ちるため、年収から機械的に概算できるようにする。
 *
 * === 算定式（2024年度の制度を基準にした概算） ===
 *   老齢基礎年金 = 満額 81.6万円 × 納付月数 / 480
 *   老齢厚生年金 = 平均標準報酬額 × 5.481/1000 × 厚生年金加入月数
 *
 * === 概算にあたっての割り切り ===
 * - 入力は手取り額のため、額面へ逆算してから標準報酬額を推定している。
 * - 生涯の平均標準報酬額は、現在の収入より低くなるのが通常のため係数で割り引く。
 * - 年金にも所得税・住民税・社会保険料がかかるため、手取り換算の係数を掛ける。
 * - 第3号被保険者（扶養内）、在職老齢年金による支給停止、加給年金、
 *   繰上げ／繰下げ受給、マクロ経済スライドは考慮していない。
 */

import {
  BASIC_PENSION_FULL_ANNUAL,
  BASIC_PENSION_MAX_MONTHS,
  EMPLOYEE_PENSION_RATE,
  STANDARD_REMUNERATION_CAP,
  NET_INCOME_RATIO,
  CAREER_AVERAGE_RATIO,
  PENSION_NET_RATIO,
  PENSION_START_AGE,
  BASIC_PENSION_END_AGE,
} from './config.js';

/**
 * 年金の受給見込みを概算する。
 *
 * @param {number} netAnnualIncome 手取り年収（万円）
 * @param {number} startWorkAge    就職年齢
 * @returns {{monthlyNet:number, grossAnnual:number, basicAnnual:number,
 *            employeeAnnual:number, standardRemuneration:number, enrolledYears:number}}
 */
export function estimatePension(netAnnualIncome, startWorkAge) {
  const workingYears = Math.max(0, PENSION_START_AGE - startWorkAge);

  // --- 老齢基礎年金: 20〜60歳の納付月数に比例 ---
  const basicMonths = Math.min(
    BASIC_PENSION_MAX_MONTHS,
    Math.max(0, (BASIC_PENSION_END_AGE - startWorkAge) * 12),
  );
  const basicAnnual = (BASIC_PENSION_FULL_ANNUAL * basicMonths) / BASIC_PENSION_MAX_MONTHS;

  // --- 老齢厚生年金: 平均標準報酬額 × 給付乗率 × 加入月数 ---
  const grossAnnualIncome = netAnnualIncome / NET_INCOME_RATIO;
  const standardRemuneration = Math.min(
    STANDARD_REMUNERATION_CAP,
    (grossAnnualIncome / 12) * CAREER_AVERAGE_RATIO,
  );
  const employeeAnnual = standardRemuneration * EMPLOYEE_PENSION_RATE * (workingYears * 12);

  const grossAnnual = basicAnnual + employeeAnnual;

  return {
    basicAnnual,
    employeeAnnual,
    grossAnnual,
    standardRemuneration,
    enrolledYears: workingYears,
    monthlyNet: (grossAnnual * PENSION_NET_RATIO) / 12,
  };
}

/**
 * 状態から、指定した人物の年金月額（手取り）を求める。
 * 自動推計がOFFなら手入力値をそのまま返す。
 */
export function resolvePensionMonthly(state, { netAnnualIncome, manualMonthly }) {
  if (!state.pensionAuto) return manualMonthly;
  return estimatePension(netAnnualIncome, state.pensionStartWorkAge).monthlyNet;
}

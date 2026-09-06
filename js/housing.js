/**
 * 住居費（家賃・住宅ローン）のモデル化。
 *
 * 住宅は多くの家計で最大の支出でありながら、一括の「頭金」だけを
 * ライフイベントとして引くモデルでは、購入後30年以上続く返済・維持費や、
 * 家賃が消える効果、住宅ローン控除を表現できない。
 *
 * === モデルの前提 ===
 * 1. 住居費は「月間固定費」とは独立した支出ストリームとして扱う。
 *    利用者には固定費から家賃を除いてもらうことで二重計上を防ぐ。
 * 2. 購入までは家賃、購入後は「ローン返済＋維持費」を計上する。
 *    購入しない設定なら家賃が生涯続く。
 * 3. 物件価格・頭金・諸費用は購入年までインフレで上昇させる。
 *    一方、ローン返済額は契約時に固定される名目額のため、以後は上昇させない。
 *    （インフレ下では返済の実質負担が軽くなる、という現実の効果を再現する）
 * 4. 住宅そのものは金融資産に含めない。売却して生活費に充てられる資産ではなく、
 *    FIRE判定の対象とすると資産額を過大評価するため。
 * 5. 住宅ローン控除は年末残高（借入限度額まで）× 0.7% を13年間、収入として加算する。
 *    所得税額を上限とする制度上の制約は考慮していない。
 */

import {
  HOUSING_DEDUCTION_RATE,
  HOUSING_DEDUCTION_YEARS,
  HOUSING_DEDUCTION_LOAN_CAP,
} from './config.js';

const EMPTY_COST = Object.freeze({ oneTime: 0, recurring: 0, deduction: 0 });

/** 元利均等返済の毎月返済額。金利0%の場合は単純割り。 */
export function monthlyPayment(principal, annualRatePercent, years) {
  const months = Math.max(1, Math.round(years * 12));
  if (principal <= 0) return 0;
  const monthlyRate = annualRatePercent / 100 / 12;
  if (monthlyRate <= 0) return principal / months;
  return (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
}

/**
 * 住居費の計画を構築する。年次ループから参照できるよう、
 * 経過年をキーにした「一時費用・経常費用・控除額」を先に確定させておく。
 *
 * @param {object} state UI の状態
 * @param {number} inflation インフレ率（小数）
 * @param {number} horizon 試算年数
 */
export function buildHousingPlan(state, inflation, horizon) {
  if (!state.housingEnabled) {
    return { enabled: false, costAt: () => EMPTY_COST };
  }

  const annualRent = state.housingRentMonthly * 12;

  if (!state.housingPurchase) {
    // 生涯賃貸: 家賃のみがインフレとともに上昇する
    return {
      enabled: true,
      purchase: false,
      annualRent,
      costAt: (year, inflationFactor) => ({
        oneTime: 0,
        recurring: annualRent * inflationFactor,
        deduction: 0,
      }),
    };
  }

  const purchaseYear = Math.min(state.housingYear, horizon);
  const purchaseFactor = (1 + inflation) ** purchaseYear;

  // 購入時点の名目額へ引き直す
  const price = state.housingPrice * purchaseFactor;
  const fees = state.housingFees * purchaseFactor;
  const downPayment = Math.min(state.housingDownPayment * purchaseFactor, price);
  const loanAmount = Math.max(0, price - downPayment);

  const payment = monthlyPayment(loanAmount, state.housingLoanRate, state.housingLoanYears);
  const annualPayment = payment * 12;

  // 年末残高の償却スケジュール（住宅ローン控除の算定に必要）
  const monthlyRate = state.housingLoanRate / 100 / 12;
  const yearEndBalance = [];
  let balance = loanAmount;
  for (let year = 0; year < state.housingLoanYears; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      balance = Math.max(0, balance * (1 + monthlyRate) - payment);
    }
    yearEndBalance.push(balance);
  }

  const deductions = yearEndBalance
    .slice(0, HOUSING_DEDUCTION_YEARS)
    .map((remaining) =>
      state.housingDeduction
        ? Math.min(remaining, HOUSING_DEDUCTION_LOAN_CAP) * HOUSING_DEDUCTION_RATE
        : 0,
    );

  const totalPayment = annualPayment * state.housingLoanYears;
  const totalDeduction = deductions.reduce((sum, value) => sum + value, 0);

  return {
    enabled: true,
    purchase: true,
    purchaseYear,
    price,
    fees,
    downPayment,
    loanAmount,
    monthlyPayment: payment,
    annualPayment,
    totalPayment,
    totalInterest: Math.max(0, totalPayment - loanAmount),
    totalDeduction,
    annualRent,

    /**
     * 指定年の住居費を返す。
     * @param {number} year 経過年
     * @param {number} inflationFactor その年のインフレ係数
     */
    costAt(year, inflationFactor) {
      // 購入前は家賃
      if (year < purchaseYear) {
        return { oneTime: 0, recurring: annualRent * inflationFactor, deduction: 0 };
      }
      const elapsed = year - purchaseYear;
      return {
        // 頭金と諸費用は購入年に一括で発生する
        oneTime: elapsed === 0 ? downPayment + fees : 0,
        // ローン返済は名目固定、維持費はインフレ連動
        recurring:
          (elapsed < state.housingLoanYears ? annualPayment : 0) +
          state.housingUpkeepAnnual * inflationFactor,
        deduction: deductions[elapsed] ?? 0,
      };
    },
  };
}

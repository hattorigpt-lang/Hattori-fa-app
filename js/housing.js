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
 * 6. 繰り上げ返済は各年の年末にまとめて実行するものとして償却する。
 *    期間短縮型は返済額を据え置いて完済を早め、返済額軽減型は完済時期を
 *    据え置いて残存期間で返済額を再計算する。
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

  const schedule = amortize(loanAmount, state, { prepayment: prepaymentOf(state) });
  // 繰り上げ返済の効果を示すため、返済しない場合の償却も計算して比較する
  const baseline = prepaymentOf(state) > 0 ? amortize(loanAmount, state, { prepayment: 0 }) : null;

  const deductions = schedule.years
    .slice(0, HOUSING_DEDUCTION_YEARS)
    .map((entry) =>
      state.housingDeduction
        ? Math.min(entry.endBalance, HOUSING_DEDUCTION_LOAN_CAP) * HOUSING_DEDUCTION_RATE
        : 0,
    );
  const totalDeduction = deductions.reduce((sum, value) => sum + value, 0);

  return {
    enabled: true,
    purchase: true,
    purchaseYear,
    price,
    fees,
    downPayment,
    loanAmount,
    monthlyPayment: schedule.initialPayment,
    annualPayment: schedule.initialPayment * 12,
    payoffYears: schedule.years.length,
    /** 指定した経過年時点の毎月返済額（返済額軽減型の推移を示すため）。 */
    paymentAtYear: (elapsed) => schedule.years[elapsed]?.payment ?? 0,
    totalPayment: schedule.totalPaid,
    totalPrepayment: schedule.totalPrepaid,
    totalInterest: schedule.totalInterest,
    finalMonthlyPayment: schedule.finalPayment,
    totalDeduction,
    annualRent,

    // 繰り上げ返済の削減効果（返済しない場合との差分）
    prepaymentEffect: baseline
      ? {
          interestSaved: baseline.totalInterest - schedule.totalInterest,
          yearsShortened: baseline.years.length - schedule.years.length,
          paymentReduced: schedule.initialPayment - schedule.finalPayment,
          baselineInterest: baseline.totalInterest,
          baselineYears: baseline.years.length,
        }
      : null,

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
      const entry = schedule.years[elapsed];
      return {
        // 頭金と諸費用は購入年に一括で発生する
        oneTime: elapsed === 0 ? downPayment + fees : 0,
        // ローン返済と繰り上げ返済は名目固定、維持費はインフレ連動
        recurring:
          (entry ? entry.paid + entry.prepaid : 0) +
          state.housingUpkeepAnnual * inflationFactor,
        deduction: deductions[elapsed] ?? 0,
      };
    },
  };
}

/** 有効な繰り上げ返済額（無効なら0）。 */
function prepaymentOf(state) {
  return state.prepaymentEnabled ? Math.max(0, state.prepaymentAnnual) : 0;
}

/**
 * 元利均等返済を月次で償却し、年ごとの返済額・繰り上げ返済額・年末残高を返す。
 * 完済した時点でループを打ち切るため、期間短縮型では配列長そのものが完済年数になる。
 */
function amortize(loanAmount, state, { prepayment }) {
  const monthlyRate = state.housingLoanRate / 100 / 12;
  const totalMonths = Math.max(1, Math.round(state.housingLoanYears * 12));
  let payment = monthlyPayment(loanAmount, state.housingLoanRate, state.housingLoanYears);
  const initialPayment = payment;

  let balance = loanAmount;
  let totalPaid = 0;
  let totalPrepaid = 0;
  const years = [];

  for (let year = 0; year < state.housingLoanYears && balance > 0.005; year += 1) {
    let paid = 0;
    for (let month = 0; month < 12 && balance > 0.005; month += 1) {
      const interest = balance * monthlyRate;
      // 最終回は残高＋利息のみを支払う（払い過ぎを発生させない）
      const due = Math.min(payment, balance + interest);
      balance = balance + interest - due;
      paid += due;
    }

    let prepaid = 0;
    if (prepayment > 0 && balance > 0.005) {
      prepaid = Math.min(prepayment, balance);
      balance -= prepaid;

      // 返済額軽減型は、残りの契約期間で返済額を組み直す
      if (state.prepaymentType === 'reduce' && balance > 0.005) {
        const remainingMonths = totalMonths - (year + 1) * 12;
        if (remainingMonths > 0) {
          payment = monthlyPaymentForMonths(balance, monthlyRate, remainingMonths);
        }
      }
    }

    totalPaid += paid;
    totalPrepaid += prepaid;
    years.push({ paid, prepaid, payment, endBalance: Math.max(0, balance) });
  }

  return {
    years,
    initialPayment,
    finalPayment: payment,
    totalPaid,
    totalPrepaid,
    totalInterest: Math.max(0, totalPaid + totalPrepaid - loanAmount),
  };
}

/** 残高・月利・残存月数から元利均等の毎月返済額を求める。 */
function monthlyPaymentForMonths(principal, monthlyRate, months) {
  if (principal <= 0 || months <= 0) return 0;
  if (monthlyRate <= 0) return principal / months;
  return (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
}

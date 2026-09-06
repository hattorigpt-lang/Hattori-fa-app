/**
 * アプリケーション全体で共有する定数と初期値。
 * 金額の単位はすべて「万円」、率はすべて「％表記の実数（例: 5.0 = 5%）」で保持する。
 */

/** 上場株式等の譲渡益課税（所得税15% + 復興特別所得税0.315% + 住民税5%）。 */
export const TAX_RATE = 0.20315;

/** 新NISAの非課税保有限度額（簿価ベース・生涯）。 */
export const NISA_LIFETIME_LIMIT = 1800;

/** 新NISAの年間投資枠（つみたて120万 + 成長投資枠240万）。 */
export const NISA_ANNUAL_LIMIT = 360;

/** 公的年金の受給開始年齢。 */
export const PENSION_START_AGE = 65;

/* --- 公的年金の概算（2024年度の制度が基準） --- */

/** 老齢基礎年金の満額（万円 / 年）。 */
export const BASIC_PENSION_FULL_ANNUAL = 81.6;

/** 老齢基礎年金が満額となる納付月数（40年）。 */
export const BASIC_PENSION_MAX_MONTHS = 480;

/** 国民年金の納付が終了する年齢。 */
export const BASIC_PENSION_END_AGE = 60;

/** 老齢厚生年金（報酬比例部分）の給付乗率。 */
export const EMPLOYEE_PENSION_RATE = 5.481 / 1000;

/** 標準報酬月額の上限（万円）。これを超える報酬は年金額に反映されない。 */
export const STANDARD_REMUNERATION_CAP = 65;

/** 手取り年収から額面年収を逆算する際の手取り率。 */
export const NET_INCOME_RATIO = 0.78;

/** 生涯の平均標準報酬額を、現在の報酬から見積もる際の割引係数。 */
export const CAREER_AVERAGE_RATIO = 0.85;

/** 年金にかかる税・社会保険料を差し引いた手取り率。 */
export const PENSION_NET_RATIO = 0.9;

/** FIRE判定を打ち切る年齢。これ以降の到達は「達成」と見なさない。 */
export const FIRE_JUDGE_AGE_LIMIT = 80;

/** 期待利回りが極端に低い場合に「完全FIRE」目標が発散するのを防ぐ上限倍率。 */
export const FIRE_TARGET_CAP_MULTIPLE = 50;

/** 実効利回りがこの値を下回る場合は倍率フォールバックに切り替える。 */
export const MIN_EFFECTIVE_YIELD = 0.005;

/** 比較シナリオ。標準は入力値、堅実／積極はそこから±2ポイント。 */
export const SCENARIO_DEFS = [
  { key: 'conservative', label: '堅実', offset: -2, color: '#059669', accentClass: 'text-emerald-600' },
  { key: 'standard', label: '標準', offset: 0, color: '#2563eb', accentClass: 'text-blue-600' },
  { key: 'aggressive', label: '積極', offset: 2, color: '#6366f1', accentClass: 'text-indigo-600' },
];

/** FIRE目標タイプの定義。ratio は生活費のうち運用益で賄う割合。 */
export const FIRE_TYPES = {
  '25x': {
    label: '25倍ルール（年間支出の25倍）',
    hint: '年間支出の25倍を貯めた時点を達成とみなす、最も一般的な目安です。',
  },
  full: {
    label: '完全FIRE（運用益のみで生活）',
    ratio: 1.0,
    hint: '税引後の運用益だけで生活費の100%を賄える資産額を目標にします。',
  },
  side: {
    label: 'サイドFIRE（生活費の50%を労働）',
    ratio: 0.5,
    hint: '生活費の50%を運用益、残り50%を軽い労働で賄う前提の目標額です。',
  },
};

/** 資産の取り崩し順序。非課税枠は複利を最大化するため最後に温存する。 */
export const WITHDRAWAL_ORDER = ['cash', 'taxable', 'other', 'nisa'];

/* --- 住宅ローン --- */

/** 住宅ローン控除の控除率（年末残高に対して）。 */
export const HOUSING_DEDUCTION_RATE = 0.007;

/** 住宅ローン控除の適用年数（新築・認定住宅等）。 */
export const HOUSING_DEDUCTION_YEARS = 13;

/** 住宅ローン控除の対象となる借入限度額（万円）。制度上の名目額のためインフレ調整しない。 */
export const HOUSING_DEDUCTION_LOAN_CAP = 3000;

/** 繰り上げ返済の方式。 */
export const PREPAYMENT_TYPES = {
  shorten: {
    label: '期間短縮型（返済期間を縮める）',
    hint: '毎月の返済額は変えず、完済を早めます。利息の削減効果は最も大きくなります。',
  },
  reduce: {
    label: '返済額軽減型（毎月の負担を減らす）',
    hint: '完済時期は変えず、毎月の返済額を下げます。月々のキャッシュフローに余裕が生まれます。',
  },
};

/* --- モンテカルロ分析 --- */

/** 株式の年間ボラティリティ（標準偏差）の既定値。先進国株式の長期実績に近い水準。 */
export const DEFAULT_VOLATILITY = 18;

/** その他運用資産のボラティリティは、株式に対するこの比率で設定する。 */
export const OTHER_VOLATILITY_RATIO = 0.5;

/** 乱数のシード。入力を変えていないのに結果が揺れないよう固定する。 */
export const MONTE_CARLO_SEED = 20260101;

/** 試行回数の選択肢。 */
export const TRIAL_OPTIONS = [500, 1000, 3000];

/** 分位の定義（下限・中央・上限）。 */
export const PERCENTILES = { low: 0.1, mid: 0.5, high: 0.9 };

/* --- 感度分析 --- */

/** 金額系の変数を動かす比率（±10%）。 */
export const SENSITIVITY_DELTA_RATIO = 0.1;

/** 率系の変数を動かす幅（±1パーセントポイント）。 */
export const SENSITIVITY_DELTA_RATE = 1;

/** 目標逆算で選べる「何年早めたいか」。 */
export const GOAL_SEEK_OPTIONS = [3, 5, 10];

/** localStorage の保存キー。スキーマ変更時はバージョンを上げる。 */
export const STORAGE_KEY = 'fire-simulator:v1';

/** URL共有で使用するハッシュパラメータ名。 */
export const SHARE_PARAM = 's';

/** 初期状態。リセット時もこの値に戻る。 */
export const DEFAULT_STATE = Object.freeze({
  currentAge: 30,
  deathAge: 85,

  monthlyIncome: 40,
  annualBonus: 100,
  pensionMonthly: 15,

  pensionAuto: false,
  pensionStartWorkAge: 22,

  spouseEnabled: false,
  spouseAge: 30,
  spouseMonthlyIncome: 25,
  spouseAnnualBonus: 60,
  spousePensionMonthly: 12,

  assetCash: 300,
  assetStock: 500,
  assetNisa: 0,
  assetOther: 0,
  yieldStock: 5.0,
  yieldOther: 2.0,

  monthlyFixed: 12,
  monthlyVar: 8,
  annualFixed: 30,
  annualVar: 50,

  fireType: '25x',
  retireOnFire: true,

  inflationEnabled: true,
  inflationRate: 2.0,
  salaryGrowthEnabled: true,
  salaryGrowthRate: 1.5,
  taxEnabled: true,
  nisaEnabled: true,

  housingEnabled: false,
  housingPurchase: true,
  housingRentMonthly: 9,
  housingYear: 7,
  housingPrice: 3500,
  housingDownPayment: 400,
  housingFees: 150,
  housingLoanRate: 1.0,
  housingLoanYears: 35,
  housingUpkeepAnnual: 30,
  housingDeduction: true,
  prepaymentEnabled: false,
  prepaymentAnnual: 50,
  prepaymentType: 'shorten',

  goalSeekYears: 5,

  monteCarloEnabled: true,
  volatility: DEFAULT_VOLATILITY,
  trials: 1000,

  events: [
    { id: 1, name: '結婚・結婚式', year: 3, cost: 400 },
    { id: 2, name: '海外旅行', year: 4, cost: 80 },
    { id: 3, name: '車の購入', year: 5, cost: 300 },
    { id: 4, name: '住宅購入（頭金）', year: 8, cost: 800 },
  ],
});

/** 「定番セット」ボタンで投入するライフイベント。 */
export const PRESET_EVENTS = [
  { name: '結婚・結婚式', year: 3, cost: 400 },
  { name: '出産・育児初期', year: 4, cost: 200 },
  { name: '車の買い替え', year: 5, cost: 300 },
  { name: '住宅購入（頭金）', year: 8, cost: 800 },
  { name: '海外旅行', year: 10, cost: 100 },
  { name: '教育費（進学）', year: 15, cost: 500 },
];

/** 入力値の許容範囲。バリデーションと input 要素の min/max を単一のソースから供給する。 */
export const FIELD_RULES = {
  currentAge: { min: 18, max: 80, integer: true, label: '現在の年齢' },
  deathAge: { min: 50, max: 110, integer: true, label: '想定寿命' },
  monthlyIncome: { min: 0, max: 1000, label: '手取り月給' },
  annualBonus: { min: 0, max: 5000, label: '年間手取り賞与' },
  pensionMonthly: { min: 0, max: 100, label: '公的年金（月額）' },
  pensionStartWorkAge: { min: 15, max: 60, integer: true, label: '就職年齢' },
  spouseAge: { min: 18, max: 100, integer: true, label: '配偶者の年齢' },
  spouseMonthlyIncome: { min: 0, max: 1000, label: '配偶者の手取り月給' },
  spouseAnnualBonus: { min: 0, max: 5000, label: '配偶者の手取り賞与' },
  spousePensionMonthly: { min: 0, max: 100, label: '配偶者の公的年金（月額）' },
  assetCash: { min: 0, max: 1000000, label: '現金・預貯金' },
  assetStock: { min: 0, max: 1000000, label: '株式（課税口座）' },
  assetNisa: { min: 0, max: NISA_LIFETIME_LIMIT, label: 'NISA口座' },
  assetOther: { min: 0, max: 1000000, label: 'その他運用資産' },
  yieldStock: { min: -5, max: 20, label: '株式の期待利回り' },
  yieldOther: { min: -5, max: 20, label: 'その他資産の期待利回り' },
  monthlyFixed: { min: 0, max: 1000, label: '月間固定費' },
  monthlyVar: { min: 0, max: 1000, label: '月間変動費' },
  annualFixed: { min: 0, max: 10000, label: '年間固定費' },
  annualVar: { min: 0, max: 10000, label: '年間変動費' },
  inflationRate: { min: -5, max: 10, label: 'インフレ率' },
  salaryGrowthRate: { min: -10, max: 10, label: '昇給率' },
  housingRentMonthly: { min: 0, max: 200, label: '家賃' },
  housingYear: { min: 0, max: 60, integer: true, label: '購入時期' },
  housingPrice: { min: 0, max: 100000, label: '物件価格' },
  housingDownPayment: { min: 0, max: 100000, label: '頭金' },
  housingFees: { min: 0, max: 10000, label: '購入諸費用' },
  housingLoanRate: { min: 0, max: 10, label: '住宅ローン金利' },
  housingLoanYears: { min: 1, max: 50, integer: true, label: '返済年数' },
  housingUpkeepAnnual: { min: 0, max: 1000, label: '住宅の維持費' },
  prepaymentAnnual: { min: 0, max: 5000, label: '繰り上げ返済額' },
  volatility: { min: 0, max: 50, label: 'ボラティリティ' },
  trials: { min: 100, max: 5000, integer: true, label: '試行回数' },
  goalSeekYears: { min: 1, max: 30, integer: true, label: '短縮したい年数' },
  eventYear: { min: 0, max: 80, integer: true, label: '発生年' },
  eventCost: { min: 0, max: 100000, label: 'イベント費用' },
};

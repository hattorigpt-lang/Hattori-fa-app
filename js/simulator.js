/**
 * 資産推移シミュレーションエンジン。
 *
 * このモジュールは DOM に一切依存しない純粋関数のみで構成する。
 * 入力（state）を受け取り、結果オブジェクトを返すだけなので、
 * Node からそのまま読み込んで数値検証が可能。
 *
 * === モデルの前提 ===
 * 1. 資産は4つのバケットで管理する
 *    - cash    : 現金・預貯金（利回り0%、非課税）
 *    - nisa    : NISA口座（株式利回り、非課税、生涯枠1,800万・年間枠360万）
 *    - taxable : 課税口座の株式・投資信託（株式利回り、売却時に含み益へ課税）
 *    - other   : その他運用資産（個別利回り、売却時に含み益へ課税）
 * 2. 課税は「売却時課税」。運用中は非課税で複利が回り、取り崩した金額のうち
 *    含み益に相当する部分にのみ 20.315% を課す（毎年課税する簡易法より実態に近い）。
 * 3. 取り崩し順序は 現金 → 課税株式 → その他 → NISA。
 *    非課税枠の複利を最後まで温存するのが税効率上有利なため。
 * 4. 金額の単位はすべて「万円」、率は小数（0.05 = 5%）で扱う。
 */

import {
  TAX_RATE,
  NISA_LIFETIME_LIMIT,
  NISA_ANNUAL_LIMIT,
  PENSION_START_AGE,
  FIRE_JUDGE_AGE_LIMIT,
  FIRE_TARGET_CAP_MULTIPLE,
  MIN_EFFECTIVE_YIELD,
  SCENARIO_DEFS,
  FIRE_TYPES,
  WITHDRAWAL_ORDER,
} from './config.js';

const EPSILON = 1e-6;

/* ------------------------------------------------------------------ */
/* 入力の正規化                                                          */
/* ------------------------------------------------------------------ */

/**
 * UI の状態を、エンジンが扱いやすいパラメータへ変換する。
 * ここで単位変換（％→小数）とトグルの反映（OFFなら率を0に）を済ませ、
 * 以降の計算では条件分岐を持ち込まない。
 */
export function normalizeInput(state) {
  const currentAge = state.currentAge;
  const deathAge = Math.max(currentAge + 1, state.deathAge);
  const nisaEnabled = Boolean(state.nisaEnabled);

  return {
    currentAge,
    deathAge,
    horizon: deathAge - currentAge,

    baseAnnualIncome: state.monthlyIncome * 12 + state.annualBonus,
    baseAnnualExpense:
      (state.monthlyFixed + state.monthlyVar) * 12 + state.annualFixed + state.annualVar,
    baseMonthlyExpense: state.monthlyFixed + state.monthlyVar,
    annualPension: state.pensionMonthly * 12,

    assetCash: state.assetCash,
    // NISA運用がOFFの場合、NISA資産は課税口座へ合算して扱う。
    assetNisa: nisaEnabled ? state.assetNisa : 0,
    assetStock: nisaEnabled ? state.assetStock : state.assetStock + state.assetNisa,
    assetOther: state.assetOther,

    baseYieldStock: state.yieldStock / 100,
    baseYieldOther: state.yieldOther / 100,

    inflation: state.inflationEnabled ? state.inflationRate / 100 : 0,
    salaryGrowth: state.salaryGrowthEnabled ? state.salaryGrowthRate / 100 : 0,
    taxRate: state.taxEnabled ? TAX_RATE : 0,
    nisaEnabled,

    fireType: state.fireType,
    retireOnFire: Boolean(state.retireOnFire),

    // 想定寿命を超えるイベントは試算対象外（警告は state.collectWarnings が担当）
    events: state.events
      .filter((event) => event.year >= 0 && event.year <= deathAge - currentAge)
      .map((event) => ({ ...event })),
  };
}

/* ------------------------------------------------------------------ */
/* バケット操作                                                          */
/* ------------------------------------------------------------------ */

function createBuckets(p) {
  return {
    cash: { value: p.assetCash, basis: p.assetCash, taxFree: true },
    nisa: { value: p.assetNisa, basis: p.assetNisa, taxFree: true },
    taxable: { value: p.assetStock, basis: p.assetStock, taxFree: false },
    other: { value: p.assetOther, basis: p.assetOther, taxFree: false },
  };
}

function cloneBuckets(buckets) {
  return Object.fromEntries(
    Object.entries(buckets).map(([key, bucket]) => [key, { ...bucket }]),
  );
}

function totalValue(buckets) {
  return Object.values(buckets).reduce((sum, bucket) => sum + bucket.value, 0);
}

/** 含み益に対する将来の税負担を差し引いた「実質手取り資産」。 */
function netWorth(buckets, taxRate) {
  return Object.values(buckets).reduce((sum, bucket) => {
    const gain = bucket.taxFree ? 0 : Math.max(0, bucket.value - bucket.basis);
    return sum + bucket.value - gain * taxRate;
  }, 0);
}

/**
 * 指定バケットから「手取りで netNeeded」を確保するために売却する。
 * 含み益割合に応じて売却額をグロスアップし、取得原価は売却比率で按分して減らす。
 * @returns {number} 実際に確保できた手取り額
 */
function withdrawNet(bucket, netNeeded, taxRate) {
  if (bucket.value <= EPSILON || netNeeded <= EPSILON) return 0;

  const gainRatio = Math.max(0, (bucket.value - bucket.basis) / bucket.value);
  const effectiveTax = bucket.taxFree ? 0 : gainRatio * taxRate;
  const netPerUnit = 1 - effectiveTax; // 税率は最大20.315%のため必ず正
  const grossWanted = netNeeded / netPerUnit;
  const gross = Math.min(bucket.value, grossWanted);

  bucket.basis -= bucket.basis * (gross / bucket.value);
  bucket.value -= gross;
  return gross * netPerUnit;
}

/** 余剰資金を NISA 優先で積み立てる。枠を使い切った分は課税口座へ回す。 */
function contribute(buckets, amount, p, tracker) {
  if (amount <= EPSILON) return;
  let remaining = amount;

  if (p.nisaEnabled) {
    const room = Math.min(NISA_ANNUAL_LIMIT, Math.max(0, NISA_LIFETIME_LIMIT - tracker.nisaUsed));
    const invested = Math.min(remaining, room);
    if (invested > 0) {
      buckets.nisa.value += invested;
      buckets.nisa.basis += invested;
      tracker.nisaUsed += invested;
      remaining -= invested;
    }
  }

  buckets.taxable.value += remaining;
  buckets.taxable.basis += remaining;
}

/** 1年分の運用。現金は利回り0%のため据え置く。 */
function grow(buckets, yieldStock, yieldOther) {
  buckets.nisa.value *= 1 + yieldStock;
  buckets.taxable.value *= 1 + yieldStock;
  buckets.other.value *= 1 + yieldOther;
}

/**
 * ポートフォリオ全体の税引後実効利回り。
 * 現金比率が高いほど下がるため、「完全FIRE」の目標額が現実的な水準になる。
 */
function effectiveYield(buckets, yieldStock, yieldOther, taxRate) {
  const total = totalValue(buckets);
  if (total <= EPSILON) return 0;
  const net =
    buckets.nisa.value * yieldStock +
    buckets.taxable.value * yieldStock * (1 - taxRate) +
    buckets.other.value * yieldOther * (1 - taxRate);
  return net / total;
}

/** FIRE目標資産額。利回りが極端に低い場合は倍率フォールバックで発散を防ぐ。 */
function calcFireTarget(fireType, annualExpense, effYield) {
  if (fireType === '25x') return annualExpense * 25;
  const ratio = FIRE_TYPES[fireType]?.ratio ?? 1;
  const cap = annualExpense * ratio * FIRE_TARGET_CAP_MULTIPLE;
  if (effYield < MIN_EFFECTIVE_YIELD) return cap;
  return Math.min((annualExpense * ratio) / effYield, cap);
}

/* ------------------------------------------------------------------ */
/* 年次プロジェクション本体                                               */
/* ------------------------------------------------------------------ */

/**
 * 年次ループを回して資産推移を計算する。
 *
 * @param {object} p normalizeInput の戻り値
 * @param {object} cfg
 * @param {number} cfg.yieldStock       株式系の期待利回り（小数）。FIRE目標額の算定に使う
 * @param {number} cfg.yieldOther       その他資産の期待利回り（小数）
 * @param {(year:number)=>{stock:number,other:number}} [cfg.realizedYield]
 *        年ごとの実現利回り。モンテカルロ分析で乱数系列を注入するための差込口。
 *        省略時は期待利回りをそのまま毎年適用する（決定論モデル）。
 * @param {number} [cfg.startYear=0]    開始経過年
 * @param {object} [cfg.buckets]        開始時点の資産バケット（省略時は初期資産）
 * @param {object} [cfg.tracker]        NISA枠の使用状況
 * @param {number|null} [cfg.spendingReal=null] 実質年間支出の上書き（取り崩し額探索用）
 * @param {'auto'|'none'} [cfg.laborMode='auto'] 'none' は完全リタイア（労働収入ゼロ）
 * @param {boolean} [cfg.detectFire=true]  FIRE達成判定を行うか
 * @param {boolean} [cfg.collectRows=true] 年次明細を収集するか
 * @param {(year:number, startAssets:number)=>void} [cfg.observer]
 *        年次の期首資産だけを受け取る軽量フック。モンテカルロのように
 *        試行回数が多い場合に、明細オブジェクトの生成コストを避けるために使う。
 */
export function project(p, cfg) {
  const {
    yieldStock,
    yieldOther,
    startYear = 0,
    buckets = createBuckets(p),
    tracker = { nisaUsed: p.nisaEnabled ? p.assetNisa : 0 },
    spendingReal = null,
    laborMode = 'auto',
    detectFire = true,
    collectRows = true,
    realizedYield = null,
    observer = null,
  } = cfg;

  const rows = [];
  let retired = laborMode === 'none';
  let fireYear = null;
  let fireAge = null;
  let fireTarget = 0;
  let snapshotAtFire = null;
  let depleted = false;
  let depletionAge = null;
  let targetToday = 0;
  let targetAtHorizon = 0;

  for (let year = startYear; year <= p.horizon; year += 1) {
    const age = p.currentAge + year;
    const inflationFactor = (1 + p.inflation) ** year;
    const salaryFactor = (1 + p.salaryGrowth) ** year;

    const startAssets = totalValue(buckets);
    const startNet = netWorth(buckets, p.taxRate);
    if (observer) observer(year, startAssets);

    // --- FIRE判定（その年の期首資産で評価する） ---
    const baseExpense = (spendingReal ?? p.baseAnnualExpense) * inflationFactor;
    const target = calcFireTarget(
      p.fireType,
      baseExpense,
      effectiveYield(buckets, yieldStock, yieldOther, p.taxRate),
    );

    if (year === startYear) targetToday = target;
    targetAtHorizon = target;

    if (detectFire && fireYear === null && startNet >= target && age <= FIRE_JUDGE_AGE_LIMIT) {
      fireYear = year;
      fireAge = age;
      fireTarget = target;
      snapshotAtFire = { buckets: cloneBuckets(buckets), tracker: { ...tracker } };
      if (p.retireOnFire) retired = true;
    }

    // --- 収入 ---
    let laborIncome = 0;
    if (age < PENSION_START_AGE && laborMode === 'auto') {
      if (!retired) {
        laborIncome = p.baseAnnualIncome * salaryFactor;
      } else if (p.fireType === 'side') {
        // サイドFIRE: 生活費の50%を軽い労働で賄い続ける
        laborIncome = baseExpense * (FIRE_TYPES.side.ratio ?? 0.5);
      }
    }
    const pensionIncome = age >= PENSION_START_AGE ? p.annualPension * inflationFactor : 0;
    const income = laborIncome + pensionIncome;

    // --- 支出 ---
    const yearEvents = p.events.filter((event) => event.year === year);
    const eventsCost = yearEvents.reduce((sum, event) => sum + event.cost * inflationFactor, 0);
    const expenses = baseExpense + eventsCost;

    // --- 運用（期首資産を1年運用してから当年のキャッシュフローを充当） ---
    const realized = realizedYield ? realizedYield(year) : { stock: yieldStock, other: yieldOther };
    grow(buckets, realized.stock, realized.other);

    // --- キャッシュフローの充当 ---
    const netFlow = income - expenses;
    let shortfall = 0;
    if (netFlow >= 0) {
      contribute(buckets, netFlow, p, tracker);
    } else {
      let need = -netFlow;
      for (const key of WITHDRAWAL_ORDER) {
        if (need <= EPSILON) break;
        need -= withdrawNet(buckets[key], need, p.taxRate);
      }
      if (need > EPSILON) {
        shortfall = need;
        if (!depleted) {
          depleted = true;
          depletionAge = age;
        }
      }
    }

    const endAssets = totalValue(buckets);
    const endNet = netWorth(buckets, p.taxRate);

    if (collectRows) {
      rows.push({
        year,
        age,
        retired,
        isFireYear: fireYear === year,
        startAssets,
        startNetWorth: startNet,
        laborIncome,
        pensionIncome,
        income,
        baseExpense,
        eventsCost,
        eventNames: yearEvents.map((event) => event.name),
        netFlow,
        shortfall,
        endAssets,
        endNetWorth: endNet,
        fireTarget: target,
        breakdown: {
          cash: buckets.cash.value,
          nisa: buckets.nisa.value,
          taxable: buckets.taxable.value,
          other: buckets.other.value,
        },
      });
    }
  }

  return {
    rows,
    achieved: fireYear !== null,
    fireYear,
    fireAge,
    fireTarget,
    // 未達成時でも比較表に必要資産を表示できるよう、現時点／終端の目標額を常に返す
    targetToday,
    targetAtHorizon,
    displayTarget: fireYear !== null ? fireTarget : targetToday,
    snapshotAtFire,
    depleted,
    depletionAge,
    terminalAssets: totalValue(buckets),
    terminalNetWorth: netWorth(buckets, p.taxRate),
  };
}

/**
 * リタイア後に生涯を通じて使える「実質年間支出額」を二分探索で求める。
 * 年金・インフレ・ライフイベント・売却時課税をすべて織り込んだうえで、
 * 想定寿命の時点で資産がちょうど尽きる水準を返す（今日の価値）。
 */
function solveSustainableSpending(p, base, startYear, snapshot) {
  const assetsAtStart = totalValue(snapshot.buckets);
  const remainingYears = Math.max(1, p.horizon - startYear);

  let low = 0;
  let high = assetsAtStart + p.annualPension * remainingYears + p.baseAnnualExpense + 1000;

  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const result = project(p, {
      ...base,
      startYear,
      buckets: cloneBuckets(snapshot.buckets),
      tracker: { ...snapshot.tracker },
      spendingReal: mid,
      laborMode: 'none',
      detectFire: false,
      collectRows: false,
    });
    if (!result.depleted && result.terminalNetWorth >= 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

/* ------------------------------------------------------------------ */
/* 公開API                                                              */
/* ------------------------------------------------------------------ */

/**
 * 3シナリオ（堅実／標準／積極）を一括で試算する。
 * @param {object} state UI の状態
 * @returns {{derived: object, scenarios: object[], standard: object}}
 */
export function runSimulation(state) {
  const p = normalizeInput(state);

  const totalAssets = p.assetCash + p.assetNisa + p.assetStock + p.assetOther;
  const annualInvestable = p.baseAnnualIncome - p.baseAnnualExpense;
  const derived = {
    totalAssets,
    annualIncome: p.baseAnnualIncome,
    annualExpense: p.baseAnnualExpense,
    annualInvestable,
    monthlyInvestable: annualInvestable / 12,
    savingsRate: p.baseAnnualIncome > 0 ? annualInvestable / p.baseAnnualIncome : 0,
    horizon: p.horizon,
  };

  const scenarios = SCENARIO_DEFS.map((def) => {
    // シナリオは市況全体の想定として、リスク資産の利回りを一律にシフトさせる。
    const yieldStock = p.baseYieldStock + def.offset / 100;
    const yieldOther = p.baseYieldOther + def.offset / 100;
    const base = { yieldStock, yieldOther };

    const run = project(p, { ...base, detectFire: true, collectRows: true });

    let sustainableAnnualSpend = 0;
    if (run.snapshotAtFire) {
      sustainableAnnualSpend = solveSustainableSpending(p, base, run.fireYear, run.snapshotAtFire);
    }

    return {
      ...def,
      yieldStock,
      yieldOther,
      ...run,
      assetsAtFire: run.snapshotAtFire ? totalValue(run.snapshotAtFire.buckets) : null,
      sustainableAnnualSpend,
      sustainableMonthlySpend: sustainableAnnualSpend / 12,
    };
  });

  const standard = scenarios.find((scenario) => scenario.key === 'standard') ?? scenarios[0];
  return { derived, scenarios, standard, params: p };
}

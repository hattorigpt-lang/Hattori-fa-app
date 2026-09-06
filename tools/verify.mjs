/**
 * 計算エンジンの回帰検証スクリプト。Node で `node tools/verify.mjs` を実行する。
 * DOM に依存しない設計のため、ブラウザを起動せずに数値の妥当性を確認できる。
 */
import { runSimulation } from '../js/simulator.js';
import { DEFAULT_STATE, TAX_RATE } from '../js/config.js';
import { cloneState } from '../js/state.js';

let failures = 0;
function check(name, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}
const round = (v) => Math.round(v * 100) / 100;

/* --- 1. 既定値でのベースライン --- */
const base = runSimulation(cloneState(DEFAULT_STATE));
const std = base.standard;
console.log('--- baseline (default state) ---');
console.log('総資産:', base.derived.totalAssets, '万円 / 年間投資可能額:', base.derived.annualInvestable);
console.log('貯蓄率:', (base.derived.savingsRate * 100).toFixed(1), '%');
base.scenarios.forEach((s) => {
  console.log(
    `${s.label} (${(s.yieldStock * 100).toFixed(1)}%)`,
    '達成:', s.achieved ? `${s.fireAge}歳(${s.fireYear}年後)` : '未達成',
    '目標:', Math.round(s.fireTarget),
    '達成時資産:', s.assetsAtFire === null ? '—' : Math.round(s.assetsAtFire),
    '月間可能額:', round(s.sustainableMonthlySpend),
    '枯渇:', s.depleted ? `${s.depletionAge}歳` : 'なし',
  );
});

// 手取り年収 40*12+100=580 万円、年間支出 (12+8)*12+30+50=320 万円
check('年間投資可能額 = 580 - 320', base.derived.annualInvestable === 260,
  `actual=${base.derived.annualInvestable}`);
check('標準シナリオでFIRE達成', std.achieved);
// 未達成は Infinity 扱いで単調性を検査する
const fireYears = base.scenarios.map((s) => (s.achieved ? s.fireYear : Infinity));
check('利回りが高いほど早く達成',
  fireYears[0] >= fireYears[1] && fireYears[1] >= fireYears[2],
  fireYears.join(' >= '));
check('未達成シナリオでも必要資産額を提示できる',
  base.scenarios[0].displayTarget > 0,
  `displayTarget=${Math.round(base.scenarios[0].displayTarget)}`);
check('行数 = 想定寿命 - 現在年齢 + 1', std.rows.length === 85 - 30 + 1, `actual=${std.rows.length}`);

/* --- 2. ライフイベントが資産に反映されているか --- */
const eventYear = std.rows.find((r) => r.year === 8);
check('住宅頭金がイベント費として計上される', eventYear.eventsCost > 800,
  `year8 eventsCost=${Math.round(eventYear.eventsCost)}（インフレ考慮で800超）`);

const noEvents = runSimulation({ ...cloneState(DEFAULT_STATE), events: [] });
check('イベントを消すとFIRE達成が早まる', noEvents.standard.fireYear < std.fireYear,
  `${noEvents.standard.fireYear} < ${std.fireYear}`);

/* --- 3. 課税モデルの検証 --- */
const noTax = runSimulation({ ...cloneState(DEFAULT_STATE), taxEnabled: false });
check('非課税のほうが終端資産が多い', noTax.standard.terminalAssets >= std.terminalAssets,
  `${Math.round(noTax.standard.terminalAssets)} >= ${Math.round(std.terminalAssets)}`);
check('課税ONでは実質資産 < 時価評価額',
  std.rows.at(-1).endNetWorth < std.rows.at(-1).endAssets,
  `net=${Math.round(std.rows.at(-1).endNetWorth)} < gross=${Math.round(std.rows.at(-1).endAssets)}`);

/* --- 4. NISAの効果 --- */
// リタイアトグルONだと「達成が早い＝働く期間が短い＝終端資産が減る」ため交絡する。
// NISA単体の効果を見るには就労継続で比較する。
const workOn = runSimulation({ ...cloneState(DEFAULT_STATE), retireOnFire: false });
const workNoNisa = runSimulation({ ...cloneState(DEFAULT_STATE), retireOnFire: false, nisaEnabled: false });
check('NISA利用時のほうが終端資産が多い（就労継続で比較）',
  workOn.standard.terminalAssets > workNoNisa.standard.terminalAssets,
  `${Math.round(workOn.standard.terminalAssets)} > ${Math.round(workNoNisa.standard.terminalAssets)}`);
check('NISA利用時のほうがFIRE達成が早い',
  workOn.standard.fireYear <= workNoNisa.standard.fireYear,
  `${workOn.standard.fireYear} <= ${workNoNisa.standard.fireYear}`);

/* --- 5. その他運用資産の利回りが効いているか（旧コードの欠陥） --- */
const otherLow = runSimulation({ ...cloneState(DEFAULT_STATE), assetOther: 1000, yieldOther: 0 });
const otherHigh = runSimulation({ ...cloneState(DEFAULT_STATE), assetOther: 1000, yieldOther: 6 });
check('yieldOther が結果に反映される',
  otherHigh.standard.terminalAssets > otherLow.standard.terminalAssets,
  `${Math.round(otherHigh.standard.terminalAssets)} > ${Math.round(otherLow.standard.terminalAssets)}`);

/* --- 6. リタイアトグルの挙動 --- */
const keepWorking = runSimulation({ ...cloneState(DEFAULT_STATE), retireOnFire: false });
check('就労継続のほうが終端資産が多い',
  keepWorking.standard.terminalAssets > std.terminalAssets,
  `${Math.round(keepWorking.standard.terminalAssets)} > ${Math.round(std.terminalAssets)}`);
check('リタイアONではFIRE後に労働収入が消える',
  std.rows.find((r) => r.year === std.fireYear + 1)?.laborIncome === 0,
  `labor=${std.rows.find((r) => r.year === std.fireYear + 1)?.laborIncome}`);

/* --- 7. 取り崩し可能額の妥当性（二分探索の解） --- */
const spend = std.sustainableAnnualSpend;
check('取り崩し可能額が正の値', spend > 0, `${round(spend)} 万円/年`);
check('取り崩し可能額が現在の生活費を上回る', spend > base.derived.annualExpense * 0.8,
  `${round(spend)} vs 生活費 ${base.derived.annualExpense}`);

/* --- 8. 資産枯渇の検出 --- */
const broke = runSimulation({
  ...cloneState(DEFAULT_STATE),
  assetCash: 0, assetStock: 0, assetNisa: 0, assetOther: 0,
  monthlyIncome: 5, annualBonus: 0, monthlyFixed: 30, monthlyVar: 20,
});
check('赤字家計で資産枯渇を検出', broke.standard.depleted, `枯渇年齢=${broke.standard.depletionAge}`);

/* --- 9. 極端な入力での堅牢性 --- */
const edge = runSimulation({ ...cloneState(DEFAULT_STATE), currentAge: 64, deathAge: 65 });
check('寿命まで1年でも例外なく完走', edge.standard.rows.length === 2, `rows=${edge.standard.rows.length}`);
const zeroYield = runSimulation({ ...cloneState(DEFAULT_STATE), yieldStock: 0, yieldOther: 0, fireType: 'full' });
check('利回り0%の完全FIREでも目標額が発散しない',
  Number.isFinite(zeroYield.standard.displayTarget) && zeroYield.standard.displayTarget > 0,
  `target=${Math.round(zeroYield.standard.displayTarget)}（生活費の50倍で上限クランプ）`);

/* --- 10. 売却時課税の手計算突合 --- */
// 資産1000万（うち含み益なし）を全額課税口座で保有し、収支ゼロ・利回り10%で1年運用。
// 期末時価 1100万、含み益 100万 → 実質資産 = 1100 - 100*0.20315 = 1079.685万
const manual = runSimulation({
  ...cloneState(DEFAULT_STATE),
  currentAge: 30, deathAge: 31,
  assetCash: 0, assetStock: 1000, assetNisa: 0, assetOther: 0,
  yieldStock: 10, monthlyIncome: 0, annualBonus: 0,
  monthlyFixed: 0, monthlyVar: 0, annualFixed: 0, annualVar: 0,
  inflationEnabled: false, salaryGrowthEnabled: false, nisaEnabled: false,
  events: [],
});
const y0 = manual.standard.rows[0];
const expectedNet = 1100 - 100 * TAX_RATE;
check('売却時課税モデルの手計算一致',
  Math.abs(y0.endAssets - 1100) < 0.01 && Math.abs(y0.endNetWorth - expectedNet) < 0.01,
  `gross=${round(y0.endAssets)} (期待1100) / net=${round(y0.endNetWorth)} (期待${round(expectedNet)})`);

console.log(`\n${failures === 0 ? '✅ すべて合格' : `❌ ${failures} 件の不一致`}`);
process.exit(failures === 0 ? 0 : 1);

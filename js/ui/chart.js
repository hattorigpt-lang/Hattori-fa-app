/**
 * Chart.js による資産推移グラフ。
 *
 * 旧実装は再計算のたびに destroy() → new Chart() でインスタンスを作り直しており、
 * 入力中のちらつきと GC 負荷の原因になっていた。ここでは1インスタンスを保持し、
 * データを差し替えて update('none') するだけにする。
 *
 * FIRE達成点・ライフイベント・資産枯渇はカスタムプラグインで直接キャンバスへ描画し、
 * 外部の annotation プラグインへの依存を持たない。
 */

import { formatAxis, formatMan } from '../formatters.js';
import { $, setText, setHtml, toggleClass } from './dom.js';

let chart = null;
let canvas = null;
/** 凡例のクリックリスナーは1度だけ登録する（再構築のたびに重複登録しないため）。 */
let legendBound = false;

/* ------------------------------------------------------------------ */
/* カスタムプラグイン: マイルストーンの描画                                */
/* ------------------------------------------------------------------ */

const milestonePlugin = {
  id: 'milestones',
  afterDatasetsDraw(instance) {
    const marks = instance.$milestones;
    if (!marks) return;
    const { ctx, chartArea, scales } = instance;
    if (!chartArea) return;

    ctx.save();
    ctx.font = '600 10px Inter, "Noto Sans JP", sans-serif';
    ctx.textBaseline = 'top';

    // --- ライフイベント: 縦の破線 ---
    marks.events.forEach((mark) => {
      const x = scales.x.getPixelForValue(mark.index);
      if (!Number.isFinite(x)) return;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();

      // 目盛り線と混同されないよう、マーカーは描画領域の外側（上部の余白）に置く
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(180, 83, 9, 0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('◆', x, chartArea.top - 15);
    });

    // --- 資産枯渇: 赤の縦線 ---
    if (marks.depletion) {
      const x = scales.x.getPixelForValue(marks.depletion.index);
      if (Number.isFinite(x)) {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(194, 50, 31, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        drawLabel(ctx, `${marks.depletion.age}歳 枯渇`, x, chartArea.top + 4, '#c2321f', chartArea);
      }
    }

    // --- FIRE達成点 ---
    if (marks.fire) {
      const x = scales.x.getPixelForValue(marks.fire.index);
      const y = scales.y.getPixelForValue(marks.fire.value);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(47, 91, 216, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = marks.fire.color;
        ctx.stroke();

        drawLabel(ctx, `FIRE ${marks.fire.age}歳`, x, y - 26, marks.fire.color, chartArea);
      }
    }
    ctx.restore();
  },
};

/** 背景付きのラベルを、描画領域からはみ出さない位置に描く。 */
function drawLabel(ctx, text, x, y, color, chartArea) {
  const paddingX = 6;
  const width = ctx.measureText(text).width + paddingX * 2;
  const height = 17;
  let left = x - width / 2;
  left = Math.max(chartArea.left, Math.min(left, chartArea.right - width));
  const top = Math.max(chartArea.top, y);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 4);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + paddingX, top + height / 2 + 0.5);
  ctx.textBaseline = 'top';
}

/* ------------------------------------------------------------------ */
/* データ整形                                                           */
/* ------------------------------------------------------------------ */

function buildDatasets(result, mc) {
  const scenarios = result.scenarios.map((scenario) => ({
    label: `${scenario.label} ${(scenario.yieldStock * 100).toFixed(1)}%`,
    data: scenario.rows.map((row) => Math.round(row.startAssets)),
    borderColor: scenario.color,
    backgroundColor: scenario.key === 'standard' ? 'rgba(47, 91, 216, 0.08)' : 'transparent',
    borderWidth: scenario.key === 'standard' ? 2.6 : 1.8,
    fill: scenario.key === 'standard',
    tension: 0.25,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBorderWidth: 2,
    pointHoverBackgroundColor: '#ffffff',
    pointHoverBorderColor: scenario.color,
    order: scenario.key === 'standard' ? 0 : 1,
  }));

  if (!mc) return scenarios;

  // 10〜90%レンジ。上限線を先に置き、下限線が '-1'（直前のデータセット）まで塗りつぶす。
  const bandStyle = {
    borderColor: 'rgba(99, 102, 241, 0.32)',
    borderWidth: 1,
    borderDash: [4, 3],
    pointRadius: 0,
    pointHoverRadius: 0,
    tension: 0.25,
    order: 3,
  };
  return [
    ...scenarios,
    { ...bandStyle, label: '90パーセンタイル', data: mc.bands.map((b) => Math.round(b.p90)), fill: false },
    {
      ...bandStyle,
      label: '10パーセンタイル',
      data: mc.bands.map((b) => Math.round(b.p10)),
      fill: '-1',
      backgroundColor: 'rgba(99, 102, 241, 0.10)',
    },
  ];
}

function buildMilestones(result) {
  const standard = result.standard;
  const rows = standard.rows;
  const indexOfYear = (year) => rows.findIndex((row) => row.year === year);

  const eventYears = [...new Set(result.params.events.map((event) => event.year))];

  return {
    events: eventYears
      .map((year) => ({ index: indexOfYear(year), year }))
      .filter((mark) => mark.index >= 0),
    fire: standard.achieved
      ? {
          index: indexOfYear(standard.fireYear),
          value: Math.round(rows[indexOfYear(standard.fireYear)].startAssets),
          age: standard.fireAge,
          color: standard.color,
        }
      : null,
    depletion: standard.depleted
      ? { index: rows.findIndex((row) => row.age === standard.depletionAge), age: standard.depletionAge }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* 凡例（HTML側で描画し、クリックで表示切替）                              */
/* ------------------------------------------------------------------ */

function renderLegend(result, mc) {
  const container = $('#chart-legend');
  if (!container) return;

  const signature = `${result.scenarios.length}:${mc ? 'band' : 'none'}`;
  if (container.dataset.signature !== signature) {
    const items = result.scenarios.map(
      (scenario, index) => `
          <button type="button" class="chart-legend__item" data-dataset="${index}" aria-pressed="true">
            <span class="chart-legend__swatch" style="background:${scenario.color}"></span>
            <span data-legend-label="${index}"></span>
          </button>`,
    );
    if (mc) {
      // バンドは上限・下限の2データセットで1つの表示単位として扱う
      items.push(`
          <button type="button" class="chart-legend__item" data-dataset="${result.scenarios.length}"
                  data-dataset-extra="${result.scenarios.length + 1}" aria-pressed="true">
            <span class="chart-legend__swatch" style="background:rgba(99,102,241,0.35)"></span>
            <span>10〜90%レンジ</span>
          </button>`);
    }
    setHtml(container, items.join(''));
    container.dataset.signature = signature;
  }

  if (!legendBound) {
    legendBound = true;
    container.addEventListener('click', (domEvent) => {
      const button = domEvent.target.closest('[data-dataset]');
      if (!button || !chart) return;
      const index = Number(button.dataset.dataset);
      const visible = chart.isDatasetVisible(index);
      chart.setDatasetVisibility(index, !visible);
      if (button.dataset.datasetExtra) {
        // 分位帯は上限線と下限線の2本で1組のため、まとめて切り替える
        chart.setDatasetVisibility(Number(button.dataset.datasetExtra), !visible);
      }
      chart.update('none');
      toggleClass(button, 'is-hidden', visible);
      button.setAttribute('aria-pressed', String(!visible));
    });
  }

  result.scenarios.forEach((scenario, index) => {
    setText(
      container.querySelector(`[data-legend-label="${index}"]`),
      `${scenario.label} ${(scenario.yieldStock * 100).toFixed(1)}%`,
    );
  });
}

/* ------------------------------------------------------------------ */
/* 公開API                                                              */
/* ------------------------------------------------------------------ */

export function initChart() {
  canvas = $('#asset-chart');
}

/** グラフライブラリが利用できない場合の代替表示を切り替える。 */
function showFallback(show) {
  const frame = canvas?.closest('.chart-frame');
  if (!frame) return;
  let notice = frame.querySelector('.chart-fallback');
  if (show && !notice) {
    notice = document.createElement('p');
    notice.className = 'chart-fallback';
    notice.textContent =
      'グラフ描画ライブラリ（Chart.js）を読み込めませんでした。ネットワーク接続をご確認ください。数値は下の比較表と年次明細でご確認いただけます。';
    frame.appendChild(notice);
  } else if (!show && notice) {
    notice.remove();
  }
  canvas.style.visibility = show ? 'hidden' : '';
}

/** 試算結果をグラフへ反映する。初回のみインスタンスを生成し、以降は差分更新する。 */
export function renderChart(result, mc = null) {
  if (!canvas) return;

  // 凡例と説明はグラフ描画の可否にかかわらず更新する
  renderLegend(result, mc);
  setText(
    $('#chart-caption'),
    '各年齢時点の資産（時価評価額）。◆はライフイベント発生年、○はFIRE達成点です。',
  );

  // Chart.js（CDN）が読み込めない環境では、無言の空白ではなく理由を提示する
  if (typeof window.Chart === 'undefined') {
    showFallback(true);
    return;
  }
  showFallback(false);

  const labels = result.standard.rows.map((row) => row.age);
  const datasets = buildDatasets(result, mc);

  if (!chart) {
    chart = new window.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: buildOptions(result, mc),
      plugins: [milestonePlugin],
    });
  } else {
    chart.data.labels = labels;
    if (chart.data.datasets.length === datasets.length) {
      // 本数が同じ場合は既存オブジェクトを再利用し、内部状態の作り直しを避ける
      chart.data.datasets.forEach((dataset, index) => Object.assign(dataset, datasets[index]));
    } else {
      chart.data.datasets = datasets;
    }
    chart.options = buildOptions(result, mc);
  }

  chart.$milestones = buildMilestones(result);
  chart.update('none');
}

function buildOptions(result, mc) {
  const rowsByAge = new Map(result.standard.rows.map((row) => [row.age, row]));
  const mcBands = mc ? mc.bands : null;

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 18 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0f172a',
        titleFont: { size: 12, weight: '700' },
        bodyFont: { size: 12 },
        padding: 10,
        boxPadding: 4,
        cornerRadius: 8,
        displayColors: true,
        // 凡例と同じ「堅実→標準→積極」の順で並べ、分位帯はツールチップから除く
        itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
        filter: (item) => !item.dataset.label.includes('パーセンタイル'),
        callbacks: {
          title: (items) => `${items[0].label} 歳`,
          label: (context) => ` ${context.dataset.label}: ${formatMan(context.parsed.y)}`,
          afterBody: (items) => {
            const row = rowsByAge.get(Number(items[0].label));
            if (!row) return '';
            const lines = [];
            if (mcBands) {
              const band = mcBands[row.year];
              if (band) lines.push(`10〜90%レンジ: ${formatMan(band.p10)} 〜 ${formatMan(band.p90)}`);
            }
            if (row.eventNames.length > 0) {
              lines.push(`イベント: ${row.eventNames.join('、')} / -${formatMan(row.eventsCost)}`);
            }
            if (row.retired) lines.push('リタイア後（労働収入なし）');
            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: '#e6e9ef' },
        ticks: {
          font: { size: 10 },
          color: '#94a0b1',
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12,
          callback(value) {
            return `${this.getLabelForValue(value)}歳`;
          },
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: '#eef1f5' },
        border: { display: false },
        ticks: {
          font: { size: 10 },
          color: '#94a0b1',
          maxTicksLimit: 7,
          callback: (value) => formatAxis(value),
        },
      },
    },
  };
}

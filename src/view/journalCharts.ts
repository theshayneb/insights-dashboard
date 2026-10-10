import { Chart, type ChartConfiguration } from 'chart.js'
import { getThemeColors } from './charts'  // also registers the Chart.js components

export interface MoodSeries { key: string; label: string; color: string }

/** Entry counts; fractions appear when a note has several moods. */
export function entriesText(n: number): string {
  return n === 1 ? '1 entry' : `${n} entries`
}

export function formatCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * Monthly bars stacked by mood (bottom = first mood), like the Overview's
 * monthly expense chart; each bar is labelled with its number of entries.
 */
export function drawMoodTrend(
  container: HTMLElement,
  months: { label: string; tooltip: string; moods: ReadonlyMap<string, number>; entries: number }[],
  moods: MoodSeries[],
): Chart {
  const colors = getThemeColors()
  const canvas = container.createEl('canvas')
  const values = moods.map(m => months.map(month => month.moods.get(m.key) ?? 0))
  const topIndex = months.map((_, i) => {
    for (let c = values.length - 1; c >= 0; c--) if (values[c][i] > 0) return c
    return -1
  })

  const cfg: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: moods.map((m, mi) => ({
        label: m.label,
        data: values[mi],
        backgroundColor: m.color,
        borderWidth: 0,
        maxBarThickness: 56,
        stack: 'mood',
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 18 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => (item.raw as number) > 0,
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          callbacks: {
            title: (items) => months[items[0].dataIndex].tooltip,
            label: (ctx) => `${ctx.dataset.label ?? ''}: ${formatCount(ctx.raw as number)}`,
            footer: (items) => items.length
              ? entriesText(months[items[0].dataIndex].entries)
              : '',
          },
        },
        datalabels: {
          color: colors.label,
          clip: false,
          anchor: 'end',
          align: 'top',
          offset: 2,
          display: (ctx) => ctx.datasetIndex === topIndex[ctx.dataIndex],
          formatter: (_v: number, ctx) => String(months[ctx.dataIndex].entries),
          font: { size: 10, weight: 'bold' },
        },
      },
      scales: {
        x: { stacked: true, border: { display: false }, grid: { display: false }, ticks: { color: colors.muted } },
        y: {
          stacked: true,
          beginAtZero: true,
          border: { display: false },
          grid: { color: colors.grid },
          ticks: { color: colors.muted, maxTicksLimit: 6, precision: 0 },
        },
      },
    },
  }
  return new Chart(canvas, cfg)
}

/**
 * One horizontal 100% bar per group (weekday, weather, …) split by mood, so
 * groups of different sizes compare at a glance. The first row is usually the
 * all-entries baseline.
 */
export function drawMoodShares(
  container: HTMLElement,
  rows: { label: string; entries: number; moods: ReadonlyMap<string, number> }[],
  moods: MoodSeries[],
): Chart {
  const colors = getThemeColors()
  const wrap = container.createDiv('ins-chart-wrap ins-share-wrap')
  // Fixed row height so every breakdown card reads the same
  wrap.setCssProps({ height: `${rows.length * 30 + 16}px` })
  const canvas = wrap.createEl('canvas')

  const pct = moods.map(m => rows.map(r => r.entries ? ((r.moods.get(m.key) ?? 0) / r.entries) * 100 : 0))

  const cfg: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      labels: rows.map(r => `${r.label} (${r.entries})`),
      datasets: moods.map((m, mi) => ({
        label: m.label,
        data: pct[mi],
        backgroundColor: m.color,
        borderWidth: 0,
        barPercentage: 0.8,
        categoryPercentage: 1,
        stack: 'mood',
      })),
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', axis: 'y', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => (item.raw as number) > 0,
          itemSort: (a, b) => (b.raw as number) - (a.raw as number),
          callbacks: {
            title: (items) => rows[items[0].dataIndex].label,
            label: (ctx) => {
              const count = rows[ctx.dataIndex].moods.get(moods[ctx.datasetIndex].key) ?? 0
              return `${ctx.dataset.label ?? ''}: ${Math.round(ctx.raw as number)}% (${formatCount(count)})`
            },
            footer: (items) => items.length
              ? entriesText(rows[items[0].dataIndex].entries)
              : '',
          },
        },
        datalabels: {
          color: '#fff',
          display: (ctx) => (ctx.dataset.data[ctx.dataIndex] as number) >= 12,
          formatter: (v: number) => `${Math.round(v)}%`,
          font: { size: 10, weight: 'bold' },
        },
      },
      scales: {
        x: { stacked: true, min: 0, max: 100, display: false },
        y: {
          stacked: true,
          border: { display: false },
          grid: { display: false },
          ticks: { color: colors.muted, autoSkip: false },
        },
      },
    },
  }
  return new Chart(canvas, cfg)
}

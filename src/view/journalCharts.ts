import { Chart, type ChartConfiguration } from 'chart.js'
import { getThemeColors } from './charts'  // also registers the Chart.js components

/** One value of the tracked dimension, as a colored series. */
export interface Series { key: string; label: string; color: string }

export function entriesText(n: number): string {
  return n === 1 ? '1 note' : `${n} notes`
}

/** Entry counts; fractions appear when a note has several tracked values. */
export function formatCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * Upright columns stacked by tracked value (bottom = first value), like
 * PennyWallet's monthly expense chart; each column is labelled with its entries.
 * Used for months and for short, ordered groups (weekdays, seasons). In
 * 'percent' mode every column fills to 100%. Clicking a column calls
 * `onColumnClick` with its index.
 */
export function drawTrend(
  container: HTMLElement,
  months: { label: string; tooltip: string; mix: ReadonlyMap<string, number>; entries: number }[],
  series: Series[],
  { mode = 'count', onColumnClick }: { mode?: 'percent' | 'count'; onColumnClick?: (index: number) => void } = {},
): Chart {
  const colors = getThemeColors()
  if (onColumnClick) container.addClass('is-clickable')
  const canvas = container.createEl('canvas')
  const pct = (i: number, key: string) => months[i].entries ? ((months[i].mix.get(key) ?? 0) / months[i].entries) * 100 : 0
  const values = series.map(s => months.map((month, i) => mode === 'percent' ? pct(i, s.key) : month.mix.get(s.key) ?? 0))
  const topIndex = months.map((_, i) => {
    for (let c = values.length - 1; c >= 0; c--) if (values[c][i] > 0) return c
    return -1
  })

  const cfg: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: series.map((s, si) => ({
        label: s.label,
        data: values[si],
        backgroundColor: s.color,
        borderWidth: 0,
        maxBarThickness: 56,
        stack: 'tracked',
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 18 } },
      interaction: { mode: 'index', intersect: false },
      onClick: onColumnClick
        ? (_e, elements) => { if (elements.length) onColumnClick(elements[0].index) }
        : undefined,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => (item.raw as number) > 0,
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          callbacks: {
            title: (items) => months[items[0].dataIndex].tooltip,
            label: (ctx) => {
              const count = months[ctx.dataIndex].mix.get(series[ctx.datasetIndex].key) ?? 0
              return mode === 'percent'
                ? `${ctx.dataset.label ?? ''}: ${Math.round(ctx.raw as number)}% (${formatCount(count)})`
                : `${ctx.dataset.label ?? ''}: ${formatCount(count)}`
            },
            footer: (items) => items.length ? entriesText(months[items[0].dataIndex].entries) : '',
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
          ...(mode === 'percent' ? { max: 100 } : {}),
          border: { display: false },
          grid: { color: colors.grid },
          ticks: {
            color: colors.muted,
            maxTicksLimit: 6,
            precision: 0,
            callback: (v) => mode === 'percent' ? `${v as number}%` : String(v),
          },
        },
      },
    },
  }
  return new Chart(canvas, cfg)
}

/**
 * One horizontal bar per group (weekday, weather, …) split by tracked value.
 * In 'percent' mode each bar is 100%, so groups of different sizes compare at a
 * glance; in 'count' mode bars show entries. Clicking a row calls `onRowClick`
 * with its index.
 */
export function drawShares(
  container: HTMLElement,
  rows: { label: string; entries: number; mix: ReadonlyMap<string, number> }[],
  series: Series[],
  mode: 'percent' | 'count',
  onRowClick?: (rowIndex: number) => void,
): Chart {
  const colors = getThemeColors()
  const wrap = container.createDiv('ins-chart-wrap ins-share-wrap')
  // Fixed row height so every breakdown card reads the same
  wrap.setCssProps({ height: `${rows.length * 30 + 16}px` })
  if (onRowClick) wrap.addClass('is-clickable')
  const canvas = wrap.createEl('canvas')

  const pct = (r: typeof rows[number], key: string) => r.entries ? ((r.mix.get(key) ?? 0) / r.entries) * 100 : 0
  const data = series.map(s => rows.map(r => mode === 'percent' ? pct(r, s.key) : r.mix.get(s.key) ?? 0))
  const maxEntries = Math.max(1, ...rows.map(r => r.entries))

  const cfg: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      labels: rows.map(r => `${r.label} (${r.entries})`),
      datasets: series.map((s, si) => ({
        label: s.label,
        data: data[si],
        backgroundColor: s.color,
        borderWidth: 0,
        barPercentage: 0.8,
        categoryPercentage: 1,
        stack: 'tracked',
      })),
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', axis: 'y', intersect: false },
      onClick: onRowClick
        ? (_e, elements) => { if (elements.length) onRowClick(elements[0].index) }
        : undefined,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => (item.raw as number) > 0,
          itemSort: (a, b) => (b.raw as number) - (a.raw as number),
          callbacks: {
            title: (items) => rows[items[0].dataIndex].label,
            label: (ctx) => {
              const row = rows[ctx.dataIndex]
              const key = series[ctx.datasetIndex].key
              return `${ctx.dataset.label ?? ''}: ${Math.round(pct(row, key))}% (${formatCount(row.mix.get(key) ?? 0)})`
            },
            footer: (items) => items.length ? entriesText(rows[items[0].dataIndex].entries) : '',
          },
        },
        datalabels: {
          color: '#fff',
          // Label segments wide enough to hold it
          display: (ctx) => pct(rows[ctx.dataIndex], series[ctx.datasetIndex].key)
            * (mode === 'percent' ? 1 : rows[ctx.dataIndex].entries / maxEntries) >= 12,
          formatter: (v: number) => mode === 'percent' ? `${Math.round(v)}%` : formatCount(v),
          font: { size: 10, weight: 'bold' },
        },
      },
      scales: {
        x: mode === 'percent'
          ? { stacked: true, min: 0, max: 100, display: false }
          : { stacked: true, min: 0, display: false },
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

import {
  Chart,
  BarElement, BarController,
  ArcElement, PieController,
  CategoryScale, LinearScale,
  Tooltip, Legend,
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'

Chart.register(
  BarElement, BarController,
  ArcElement, PieController,
  CategoryScale, LinearScale,
  Tooltip, Legend,
  ChartDataLabels,
)

/** Neutral color for the pie's grouped "Other" slice. */
export const OTHER_COLOR = '#888780'

export function getThemeColors() {
  const dark = document.body.classList.contains('theme-dark')
  return {
    muted: dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)',
    label: dark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
    grid:  dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
    palette: [
      '#EF9F27', '#378ADD', '#AFA9EC', '#1D9E75', '#5DCAA5', '#85B7EB', '#D85A30',
      '#D4537E', '#E3C34B', '#7F5BD5', '#9C6B3E',
    ],
  }
}

/** Returns the last `count` months (YYYY-MM) ending at (and including) `endYearMonth`. */
export function getMonthRangeEndingAt(endYearMonth: string, count: number): string[] {
  const [y, m] = endYearMonth.split('-').map(Number)
  const result: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
}

/** "Mar" for the axis; "Mar 2026" for tooltips. */
export function formatMonth(yearMonth: string, withYear = false): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, withYear ? { month: 'short', year: 'numeric' } : { month: 'short' })
    .format(new Date(y, m - 1, 1))
}

// ─── Pie chart ────────────────────────────────────────────────────────────────

/**
 * The values to draw, without empty ones. Every value keeps its own slice and
 * legend row, however small (pies are only used for a few values), so a rare
 * rating can still be seen and clicked.
 */
export function filterPieData(data: Map<string, number>): Map<string, number> {
  return new Map([...data].filter(([, value]) => value > 0))
}

/** "12%", or "<1%" for a sliver that isn't zero. */
export function percentText(value: number, total: number): string {
  const pct = (value / total) * 100
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

export function drawPie(
  container: HTMLElement,
  data: Map<string, number>,
  onSegmentClick: ((key: string) => void) | undefined,
  labelFor: (key: string) => string,
  colorFor?: (key: string) => string | undefined,  // fixed per-key colors; otherwise by position
  size = 200,
): Chart {
  const filtered = filterPieData(data)
  const total = [...filtered.values()].reduce((a, b) => a + b, 0)
  const segments = [...filtered].map(([key, value]) => ({
    key,
    label: key === '__other__' ? 'Other' : labelFor(key),
    value,
  }))

  const { palette } = getThemeColors()
  const segColors = segments.map((s, i) =>
    s.key === '__other__' ? OTHER_COLOR : colorFor?.(s.key) ?? palette[i % palette.length])

  const wrap = container.createDiv('ins-pie-wrap')
  // Fixed-size wrapper lets Chart.js stay responsive with a stable size (and correct touch coordinates on mobile)
  const canvasWrap = wrap.createDiv('ins-pie-canvas-wrap')
  canvasWrap.setCssProps({ width: `${size}px`, height: `${size}px` })
  if (onSegmentClick) canvasWrap.addClass('is-clickable')
  const canvas = canvasWrap.createEl('canvas')

  const chart = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: segments.map(s => s.label),
      datasets: [{
        data: segments.map(s => s.value),
        backgroundColor: segColors,
        borderColor: 'rgba(0,0,0,0.08)',
        borderWidth: 1,
        hoverOffset: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 8 },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => segments[items[0].dataIndex].label,
            label: (ctx) => {
              const seg = segments[ctx.dataIndex]
              return `${seg.value} (${percentText(seg.value, total)})`
            },
          },
        },
      },
      onClick: onSegmentClick
        ? (_, elements) => {
            if (!elements.length) return
            const seg = segments[elements[0].index]
            onSegmentClick(seg.key === '__other__' ? '' : seg.key)
          }
        : undefined,
    },
  })

  // HTML legend: inherits the theme's text color and supports clicks
  const legend = wrap.createDiv('ins-pie-legend')
  segments.forEach((seg, i) => {
    const item = legend.createDiv('ins-legend-item')
    if (onSegmentClick) {
      item.addClass('is-clickable')
      item.addEventListener('click', () => onSegmentClick(seg.key === '__other__' ? '' : seg.key))
    }
    item.createSpan({ cls: 'ins-legend-dot' }).setCssProps({ 'background-color': segColors[i] })
    item.createSpan({ text: seg.label, cls: 'ins-legend-name' })
    item.createSpan({ text: String(seg.value), cls: 'ins-legend-amt' })
    item.createSpan({ text: percentText(seg.value, total), cls: 'ins-legend-pct' })
  })

  return chart
}

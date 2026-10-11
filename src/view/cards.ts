import { App, CachedMetadata, TFile, getAllTags, getLinkpath } from 'obsidian'
import { Chart } from 'chart.js'
import type { Range, ValueMode } from '../settings'
import { OTHER_COLOR, drawPie, formatMonth, getMonthRangeEndingAt, getThemeColors } from './charts'
import { Series, drawShares, drawTrend, entriesText } from './journalCharts'
import { resolveDimension } from '../embed'
import {
  BUILTIN_DIMENSIONS, Breakdown, Filter, JournalEntry, JournalValue, LinkedNote, Link, Source, Tally,
  applyFilters, breakdownByDimension, breakdownByGroup, builtinDimension, buildEntry, colorKey, colorValues, countValues,
  dimensionKind, discoverProperties, entriesSince, findLinks, limitValues, matchesSource, orderValues,
  overallBreakdown, valuesOf, yearMonthOf,
} from '../journal'

// Shared by the dashboard and the `insights` embed block: reading notes into a
// model, and drawing its cards.

export const RANGES: { id: Range; label: string; months: number | null }[] = [
  { id: '3m', label: '3 months', months: 3 },
  { id: '6m', label: '6 months', months: 6 },
  { id: '12m', label: '12 months', months: 12 },
  { id: 'all', label: 'All', months: null },
]

const MAX_TREND_MONTHS = 36  // longer spans are charted by year
const MAX_GROUPS = 10      // rows per breakdown chart
const MAX_SERIES = 10     // tracked values with their own color; the rest are "Other"
const TOP_LIST_AT = 9     // a property with this many values gets a ranked list instead of a pie
const TOP_LIST_ROWS = 15

export function rangeMonths(range: Range): number | null {
  return RANGES.find(r => r.id === range)?.months ?? null
}

/** Start of the range: the first day of the oldest month in it (null = all). */
export function rangeStart(range: Range): Date | null {
  const months = rangeMonths(range)
  if (months === null) return null
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
}

/** First letter upper-case, for titles built from property names. */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function dateText(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The dashboard's notes as entries, newest first, with their links followed (see buildEntry). */
export function readEntries(app: App, source: Source, dateProperty: string): JournalEntry[] {
  const linkedCache = new Map<string, LinkedNote | null>()
  const linkedNote = (file: TFile): LinkedNote => {
    const cache = app.metadataCache.getFileCache(file)
    return {
      name: file.basename,
      frontmatter: cache?.frontmatter as Record<string, unknown> | undefined,
      tags: (cache ? getAllTags(cache) ?? [] : []).map(t => t.replace(/^#/, '')),
    }
  }
  const entries: JournalEntry[] = []
  for (const file of app.vault.getMarkdownFiles()) {
    const cache: CachedMetadata | null = app.metadataCache.getFileCache(file)
    if (!cache) continue
    if (!matchesSource(source, { path: file.path, tags: getAllTags(cache) ?? [] })) continue
    const resolve = (link: string): LinkedNote | null => {
      const key = `${file.path}\u0000${link}`
      if (!linkedCache.has(key)) {
        const dest = app.metadataCache.getFirstLinkpathDest(getLinkpath(link), file.path)
        linkedCache.set(key, dest && dest.extension === 'md' ? linkedNote(dest) : null)
      }
      return linkedCache.get(key) ?? null
    }
    const outgoing = [...(cache.links ?? []), ...(cache.frontmatterLinks ?? [])].map(l => l.link)
    entries.push(buildEntry(
      { path: file.path, basename: file.basename, ctime: file.stat.ctime },
      cache.frontmatter as Record<string, unknown> | undefined,
      dateProperty,
      { resolve, outgoing },
    ))
  }
  return entries.sort((a, b) => b.date.getTime() - a.date.getTime() || a.path.localeCompare(b.path))
}


export type Dim = { id: string; name: string; notes: number }

/** Everything one render needs, worked out once. */
export interface Model {
  all: JournalEntry[]
  entries: JournalEntry[]              // in range and matching the filters
  dims: Dim[]                          // every property found, then the built-ins
  tracked: string
  trackedName: string
  compare: string[]                    // compared dimensions that exist
  series: Series[]                     // the tracked values, in order, with colors ("Other" last if needed)
  trackedTally: Tally[]
  trackedOf: (e: JournalEntry) => JournalValue[]  // tracked values, rare ones counted as "Other"
  unresolved: string[]                 // names (byName) that match nothing
}

export interface ModelOptions {
  source: Source
  dateProperty: string
  ignoredProperties: string[]
  tracked: string
  compare: string[] | null   // null = picked automatically
  filters: Filter[]
  range: Range
  valueColors: Record<string, Record<string, string>>
  // Embeds: tracked, compare and filters as written (names like "Related → #song",
  // filter values like "Rainy"); what doesn't match goes to Model.unresolved
  byName?: boolean
}

export function dimName(dims: Dim[], id: string): string {
  return dims.find(d => d.id === id)?.name ?? builtinDimension(id)?.name ?? id
}

/** A dimension's values in display order, with the chosen colors or palette ones. */
export function colorsFor(dim: string, tally: Tally[], valueColors: Record<string, Record<string, string>>): { order: string[]; colors: Map<string, string> } {
  return colorValues(orderValues(tally, dim), valueColors?.[dim] ?? {}, getThemeColors().palette)
}

/** For a new tab: its most used properties, then the most used linked ones. */
function autoCompare(propIds: string[], tracked: string): string[] {
  const others = propIds.filter(id => id !== tracked)
  return [
    ...others.filter(id => dimensionKind(id) === 'property').slice(0, 3),
    ...others.filter(id => dimensionKind(id) === 'linked').slice(0, 2),
  ]
}

export function buildModel(app: App, o: ModelOptions): Model {
  const dateProperty = (o.dateProperty ?? '').trim() || 'date'
  const all = readEntries(app, o.source, dateProperty)
  const props = discoverProperties(all, [...(o.ignoredProperties ?? []), dateProperty.toLowerCase()])
  const dims: Dim[] = [
    ...props.map(p => ({ id: p.id, name: p.name, notes: p.entries })),
    ...BUILTIN_DIMENSIONS.map(d => ({ id: d.id, name: d.name, notes: all.length })),
  ]
  const exists = (id: string) => dims.some(d => d.id === id)
  const unresolved: string[] = []
  if (o.byName) o = resolveNames(o, dims, all, unresolved)
  // A tracked property that no note has (yet) falls back to the most used one, without saving
  const tracked = exists(o.tracked) ? o.tracked : (props[0]?.id ?? '@weekday')
  const entries = applyFilters(entriesSince(all, rangeStart(o.range)), o.filters ?? [])

  const fullTally = countValues(entries, e => valuesOf(e, tracked))
  const { order, colors } = colorsFor(tracked, fullTally, o.valueColors)
  // Many values (dozens of teas or songs): the top ones keep a color, the rest are "Other"
  const kept = limitValues(order, fullTally, o.valueColors?.[tracked] ?? {}, MAX_SERIES)
  const hasOther = kept.size < order.length
  const other: JournalValue = { key: '__other__', label: 'Other' }
  const trackedOf = (e: JournalEntry): JournalValue[] => {
    const values = valuesOf(e, tracked)
    if (!hasOther) return values
    const out = values.filter(v => kept.has(v.key))
    return out.length < values.length ? [...out, other] : out
  }
  const trackedTally = countValues(entries, trackedOf)
  const labels = new Map(fullTally.map(v => [v.key, v.label]))
  const series: Series[] = order.filter(k => kept.has(k)).map(key => ({ key, label: labels.get(key) ?? key, color: colors.get(key)! }))
  if (hasOther) series.push({ key: '__other__', label: 'Other', color: OTHER_COLOR })

  return {
    all,
    entries,
    dims,
    tracked,
    trackedName: dimName(dims, tracked),
    compare: (o.compare ?? autoCompare(props.map(p => p.id), tracked)).filter(id => id !== tracked && exists(id)),
    series,
    trackedTally,
    trackedOf,
    unresolved,
  }
}

/** Embeds name dimensions and filter values as shown; turn them into ids and keys. */
function resolveNames(o: ModelOptions, dims: Dim[], all: JournalEntry[], unresolved: string[]): ModelOptions {
  const dim = (name: string) => {
    if (!name) return ''
    const d = resolveDimension(dims, name)
    if (!d) unresolved.push(name)
    return d?.id ?? ''
  }
  const filters: Filter[] = []
  for (const f of o.filters) {
    const id = dim(f.dim)
    if (!id) continue
    const want = colorKey(f.label)
    const match = countValues(all, e => valuesOf(e, id)).find(v => colorKey(v.label) === want || v.key === f.label.toLowerCase())
    if (match) filters.push({ dim: id, value: match.key, label: match.label })
    else unresolved.push(`${f.dim} = ${f.label}`)
  }
  return {
    ...o,
    tracked: dim(o.tracked),
    compare: o.compare ? o.compare.map(dim).filter(Boolean) : null,
    filters,
  }
}

export interface DrawOptions {
  valueMode: ValueMode
  rangeMonths: number | null
  valueColors: Record<string, Record<string, string>>
  onFilter?: (dim: string, value: string, label: string) => void  // clicks filter; none in embeds
}

/** Draws the cards' contents (into a card element that already has its title). */
export class CardDrawer {
  readonly charts: Chart[] = []

  constructor(private readonly opts: DrawOptions) {}

  private filter(dim: string, value: string, label: string) {
    this.opts.onFilter?.(dim, value, label)
  }

  /** `min`: only groups with at least this many notes (never fewer than 3, so a link means something). */
  drawLinks(card: HTMLElement, m: Model, min = 1) {
    const tracked = m.trackedName.toLowerCase()
    const minEntries = Math.max(3, min)
    card.createDiv({
      text: `Groups where one ${tracked} value shows up clearly more often than usual (${minEntries} or more notes). ${this.opts.onFilter ? 'Click one to filter by it.' : ''}`,
      cls: 'ins-hint',
    })
    const overall = overallBreakdown(m.entries, m.trackedOf, 'All notes')
    const links: Link[] = findLinks(m.compare.map(dim => ({
      id: dim,
      name: dimName(m.dims, dim),
      groups: breakdownByDimension(m.entries, dim, m.trackedOf),
    })), overall, { minEntries })
    if (links.length === 0) {
      card.createEl('p', { text: 'Nothing stands out yet. Compare with more properties, or check back after a few more notes.', cls: 'ins-no-data' })
      return
    }
    for (const l of links) {
      const series = m.series.find(s => s.key === l.valueKey)
      const row = card.createDiv('ins-link')
      row.setAttribute('role', 'button')
      row.tabIndex = 0
      const what = row.createDiv('ins-link-group')
      what.createSpan({ text: `${l.dimension}: `, cls: 'ins-link-dim' })
      what.createSpan({ text: l.group })
      this.chip(row, series?.label ?? l.valueKey, series?.color)
      row.createSpan({ text: `${Math.round(l.share * 100)}% vs ${Math.round(l.baseline * 100)}% overall`, cls: 'ins-link-share' })
      row.createSpan({ text: entriesText(l.entries), cls: 'ins-link-n' })
      row.addEventListener('click', () => this.filter(l.dimensionId, l.groupKey, l.group))
    }
  }

  drawTrendCard(card: HTMLElement, m: Model) {
    card.addClass('ins-trend-card')
    if (m.series.length === 0) {
      card.createEl('p', { text: `No notes in this period have a ${m.trackedName} value.`, cls: 'ins-no-data' })
      return
    }
    this.legend(card, m.series)
    const now = yearMonthOf(new Date())
    let count = this.opts.rangeMonths
    if (count === null) {
      const first = m.all.length ? yearMonthOf(m.all[m.all.length - 1].date) : now
      const [fy, fm] = first.split('-').map(Number)
      const [ny, nm] = now.split('-').map(Number)
      count = Math.max(1, (ny - fy) * 12 + (nm - fm) + 1)
      // Years of notes: one column per year
      if (count > MAX_TREND_MONTHS) {
        const byYear = breakdownByDimension(m.entries, '@year', m.trackedOf)
        this.charts.push(drawTrend(card.createDiv('ins-chart-wrap'),
          byYear.map(g => ({ label: g.label, tooltip: g.label, mix: g.mix, entries: g.entries })), m.series,
          { onColumnClick: (i) => this.filter('@year', byYear[i].key, byYear[i].label) }))
        return
      }
    }
    const byMonth = new Map(breakdownByGroup(m.entries,
      e => [{ key: yearMonthOf(e.date), label: '' }], m.trackedOf).map(g => [g.key, g]))
    const months = getMonthRangeEndingAt(now, count).map(ym => ({
      label: formatMonth(ym),
      tooltip: formatMonth(ym, true),
      mix: byMonth.get(ym)?.mix ?? new Map<string, number>(),
      entries: byMonth.get(ym)?.entries ?? 0,
    }))
    this.charts.push(drawTrend(card.createDiv('ins-chart-wrap'), months, m.series))
  }

  /** `min`: only groups with at least this many notes. */
  drawSplit(card: HTMLElement, m: Model, dim: string, min = 1) {
    const all: Breakdown[] = breakdownByDimension(m.entries, dim, m.trackedOf)
    const groups = all.filter(g => g.entries >= min)
    if (groups.length === 0 || m.series.length === 0) {
      card.createEl('p', { text: all.length ? `No group has ${min} or more notes` : 'No data in this period', cls: 'ins-no-data' })
      return
    }
    this.legend(card, m.series)
    const mode = this.opts.valueMode
    // Date groups are few and in order: upright columns, like the month chart
    if (builtinDimension(dim)) {
      // In % mode an "All" column first gives the usual mix to compare with
      const columns = mode === 'percent' ? [overallBreakdown(m.entries, m.trackedOf, 'All'), ...groups] : groups
      const chart = drawTrend(card.createDiv('ins-chart-wrap ins-columns-wrap'),
        columns.map(g => ({ label: g.label, tooltip: g.label === 'All' ? 'All notes' : g.label, mix: g.mix, entries: g.entries })),
        m.series,
        { mode, onColumnClick: (i) => { if (columns[i].key !== '__all__') this.filter(dim, columns[i].key, columns[i].label) } })
      this.charts.push(chart)
      return
    }
    const rows = [overallBreakdown(m.entries, m.trackedOf, 'All notes'), ...groups.slice(0, MAX_GROUPS)]
    this.charts.push(drawShares(card, rows, m.series, mode, (i) => {
      if (i > 0) this.filter(dim, rows[i].key, rows[i].label)
    }))
    if (groups.length > MAX_GROUPS) {
      card.createDiv({ text: `Showing the ${MAX_GROUPS} biggest of ${groups.length} groups`, cls: 'ins-hint ins-more' })
    }
    this.hiddenNote(card, all.length - groups.length, min)
  }

  /** Says how many values a card's minimum leaves out. */
  private hiddenNote(card: HTMLElement, hidden: number, min: number) {
    if (hidden <= 0) return
    card.createDiv({ text: `${hidden} with fewer than ${min} notes not shown`, cls: 'ins-hint ins-more' })
  }

  /** `min`: only values that at least this many notes have. */
  drawPieCard(card: HTMLElement, m: Model, dim: string, min = 1) {
    const all = countValues(m.entries, e => valuesOf(e, dim))
    const tally = all.filter(v => v.count >= min)
    if (tally.length === 0) {
      card.createEl('p', { text: all.length ? `No value is in ${min} or more notes` : 'No data in this period', cls: 'ins-no-data' })
      return
    }
    // A list when the property has many values (decided before the minimum, so the card keeps its look)
    if (all.length >= TOP_LIST_AT) {
      // One color: with dozens of values, per-value colors would mostly repeat
      this.drawTopList(card, tally, dim)
      this.hiddenNote(card, all.length - tally.length, min)
      return
    }
    const labels = new Map(tally.map(v => [v.key, v.label]))
    const { order, colors } = dim === m.tracked
      ? { order: m.series.map(s => s.key), colors: new Map(m.series.map(s => [s.key, s.color])) }
      : colorsFor(dim, tally, this.opts.valueColors)
    const counts = new Map(order.map(key => [key, tally.find(v => v.key === key)?.count ?? 0]))
    this.charts.push(drawPie(card, counts,
      (key) => { if (key) this.filter(dim, key, labels.get(key) ?? key) },
      (key) => labels.get(key) ?? key,
      (key) => colors.get(key)))
    this.hiddenNote(card, all.length - tally.length, min)
  }

  /** Values ranked by how many notes have them (e.g. most frequent songs); click one to filter by it. */
  drawTopList(card: HTMLElement, tally: Tally[], dim: string, colors?: Map<string, string>) {
    card.addClass('ins-top-card')
    const max = tally[0].count
    const list = card.createDiv('ins-top-list')
    for (const v of tally.slice(0, TOP_LIST_ROWS)) {
      const row = list.createDiv('ins-top-row')
      row.setAttribute('role', 'button')
      row.tabIndex = 0
      row.createDiv({ text: v.label, cls: 'ins-top-label' })
      const bar = row.createDiv('ins-top-bar')
      const fill = bar.createDiv('ins-top-fill')
      fill.setCssProps({ width: `${Math.max(2, (v.count / max) * 100)}%` })
      const color = colors?.get(v.key)
      if (color) fill.setCssProps({ 'background-color': color })
      row.createDiv({ text: String(v.count), cls: 'ins-top-count' })
      row.addEventListener('click', () => this.filter(dim, v.key, v.label))
    }
    if (tally.length > TOP_LIST_ROWS) {
      card.createDiv({ text: `Top ${TOP_LIST_ROWS} of ${tally.length}`, cls: 'ins-hint ins-more' })
    }
  }

  chip(parent: HTMLElement, label: string, color: string | undefined) {
    const chip = parent.createSpan('ins-chip')
    chip.createSpan({ cls: 'ins-legend-dot' }).setCssProps({ 'background-color': color ?? 'var(--text-faint)' })
    chip.createSpan({ text: label })
  }

  legend(parent: HTMLElement, series: Series[]) {
    const legend = parent.createDiv('ins-legend')
    for (const s of series) this.chip(legend, s.label, s.color)
  }
}

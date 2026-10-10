import { App, CachedMetadata, ItemView, WorkspaceLeaf, debounce, getAllTags } from 'obsidian'
import { Chart } from 'chart.js'
import type InsightsDashboardPlugin from '../main'
import { OTHER_COLOR, assignColors, drawPie, formatMonth, getMonthRangeEndingAt, getThemeColors } from './charts'
import { MoodSeries, drawMoodShares, drawMoodTrend, entriesText } from './journalCharts'
import {
  JournalEntry, JournalSettings, JournalValue, MoodBreakdown, MoodLink, SEASONS, WEEKDAYS,
  breakdownByGroup, buildEntry, countValues, entriesSince, findMoodLinks, orderMoods,
  overallBreakdown, seasonOf, streaks, yearMonthOf,
} from '../journal'

export const INSIGHTS_VIEW_TYPE = 'insights-dashboard'

type Range = '3m' | '6m' | '12m' | 'all'
const RANGES: { id: Range; label: string; months: number | null }[] = [
  { id: '3m', label: '3 months', months: 3 },
  { id: '6m', label: '6 months', months: 6 },
  { id: '12m', label: '12 months', months: 12 },
  { id: 'all', label: 'All', months: null },
]

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SEASON_NAMES: Record<string, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' }

const MAX_TREND_MONTHS = 24
const MAX_GROUPS = 10      // rows per breakdown chart
const RECENT_LIMIT = 30

type Tally = JournalValue & { count: number }

/** First letter upper-case, for titles built from property names. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function dateText(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Tag comparison key: case-insensitive, no "#", and "-" / "_" count as the same. */
function tagKey(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase().replace(/-/g, '_')
}

/** Notes tagged `tag` (or a nested tag under it), as journal entries, newest first. */
export function readJournalEntries(app: App, tag: string, settings: JournalSettings): JournalEntry[] {
  const key = tagKey(tag)
  if (!key) return []
  const entries: JournalEntry[] = []
  for (const file of app.vault.getMarkdownFiles()) {
    const cache: CachedMetadata | null = app.metadataCache.getFileCache(file)
    if (!cache) continue
    const tags = getAllTags(cache) ?? []
    if (!tags.some(tg => { const k = tagKey(tg); return k === key || k.startsWith(key + '/') })) continue
    entries.push(buildEntry(
      { path: file.path, basename: file.basename, ctime: file.stat.ctime },
      cache.frontmatter as Record<string, unknown> | undefined,
      settings,
    ))
  }
  return entries.sort((a, b) => b.date.getTime() - a.date.getTime() || a.path.localeCompare(b.path))
}

/**
 * How often each mood comes up and how it lines up with the other properties,
 * the weekday and the season.
 */
export class InsightsView extends ItemView {
  private range: Range = '12m'
  private charts: Chart[] = []
  private readonly insScheduleRender = debounce(() => this.render(), 1000, true)

  constructor(leaf: WorkspaceLeaf, private readonly plugin: InsightsDashboardPlugin) {
    super(leaf)
  }

  getViewType() { return INSIGHTS_VIEW_TYPE }
  getDisplayText() { return 'Insights dashboard' }
  getIcon() { return 'smile' }

  getState(): Record<string, unknown> {
    return { ...super.getState(), range: this.range }
  }

  async setState(state: Record<string, unknown>, result: Parameters<ItemView['setState']>[1]) {
    const range = RANGES.find(r => r.id === state?.range)
    if (range) this.range = range.id
    await super.setState(state, result)
    this.render()
  }

  onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on('css-change', () => this.render()))
    // Re-read when notes change; debounced so typing in a journal note doesn't redraw constantly
    this.registerEvent(this.app.metadataCache.on('changed', () => this.insScheduleRender()))
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.insScheduleRender()))
    this.registerEvent(this.app.vault.on('delete', () => this.insScheduleRender()))
    this.registerEvent(this.app.vault.on('rename', () => this.insScheduleRender()))
    this.render()
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.insScheduleRender.cancel()
    this.clearCharts()
    this.contentEl.empty()
    return Promise.resolve()
  }

  private clearCharts() {
    this.charts.forEach(c => c.destroy())
    this.charts = []
  }

  private journalSettings(): JournalSettings & { tag: string } {
    const s = this.plugin.settings
    return {
      tag: (s.tag ?? '').trim(),
      moodProperty: (s.moodProperty ?? '').trim() || 'Mood',
      factorProperties: (s.factorProperties ?? []).map(p => p.trim()).filter(Boolean),
      dateProperty: (s.dateProperty ?? '').trim() || 'date',
    }
  }

  private rangeMonths(): number | null {
    return RANGES.find(r => r.id === this.range)?.months ?? null
  }

  private since(): Date | null {
    const months = this.rangeMonths()
    if (months === null) return null
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  }

  render(): void {
    const { contentEl } = this
    const scrollTop = contentEl.scrollTop
    this.clearCharts()
    contentEl.empty()
    contentEl.addClass('ins-dashboard')

    const settings = this.journalSettings()
    const all = readJournalEntries(this.app, settings.tag, settings)
    const entries = entriesSince(all, this.since())

    this.renderHeader(contentEl, settings.tag, entries.length)

    if (all.length === 0) {
      const card = this.card(contentEl.createDiv('ins-empty'))
      card.createEl('p', {
        text: `No notes tagged #${settings.tag || 'journal_entry'} yet. The tag and properties can be changed in the plugin settings.`,
        cls: 'ins-no-data',
      })
      return
    }

    const moodName = settings.moodProperty
    const moodLower = moodName.toLowerCase()
    const moodTally = countValues(entries, e => e.mood)
    const moodOrder = orderMoods(moodTally)
    const moodLabels = new Map(moodTally.map(m => [m.key, m.label]))
    // Colors follow the display order, so numeric moods (1–5) keep the same colors
    const moodColors = assignColors(moodOrder, getThemeColors().palette)
    const moods: MoodSeries[] = moodOrder.map(key => ({ key, label: moodLabels.get(key) ?? key, color: moodColors.get(key)! }))

    const grid = contentEl.createDiv('ins-grid')
    const left = grid.createDiv('ins-grid-left')
    const right = grid.createDiv('ins-grid-right')

    // ── Summary + recent entries ─────────────────────────────────────────────
    const topRow = left.createDiv('ins-left-top')
    this.renderSummary(topRow, entries, moodTally[0], moodLower, moodColors)
    this.renderRecent(topRow, entries, settings, moodColors)

    if (moods.length === 0) {
      this.card(left).createEl('p', { text: `No entries in this period have a ${moodName} property.`, cls: 'ins-no-data' })
    } else {
      // ── Breakdowns ─────────────────────────────────────────────────────────
      const overall = overallBreakdown(entries, 'All entries')
      const weekdays = this.orderGroups(
        breakdownByGroup(entries, e => [{ key: String(e.date.getDay()), label: '' }]),
        WEEKDAYS.map(String), (key) => WEEKDAY_NAMES[Number(key)],
      )
      const seasons = this.orderGroups(
        breakdownByGroup(entries, e => [{ key: seasonOf(e.date), label: '' }]),
        SEASONS, (key) => SEASON_NAMES[key],
      )
      const factorGroups = settings.factorProperties.map(prop => ({
        name: prop,
        groups: breakdownByGroup(entries, e => e.factors[prop] ?? [])
          .sort((a, b) => b.entries - a.entries || a.label.localeCompare(b.label)),
      }))

      const links = findMoodLinks([
        ...factorGroups,
        { name: 'day of week', groups: weekdays },
        { name: 'season', groups: seasons },
      ], overall)
      this.renderLinks(left, links, moodLower, moodLabels, moodColors)

      // Monthly trend, stacked by mood
      const trendCard = this.card(left, sentence(`${moodLower} by month`), 'ins-trend-card')
      this.renderMoodLegend(trendCard, moods)
      this.charts.push(drawMoodTrend(trendCard.createDiv('ins-chart-wrap'), this.trendMonths(entries, all), moods))

      const shareCard = (factor: string, groups: MoodBreakdown[]) => {
        const card = this.card(left, sentence(`${moodLower} by ${factor.toLowerCase()}`))
        if (groups.length === 0) {
          card.createEl('p', { text: 'No data in this period', cls: 'ins-no-data' })
          return
        }
        this.renderMoodLegend(card, moods)
        this.charts.push(drawMoodShares(card, [overall, ...groups.slice(0, MAX_GROUPS)], moods))
      }
      for (const f of factorGroups) shareCard(f.name, f.groups)
      shareCard('day of week', weekdays)
      shareCard('season', seasons)
    }

    // ── Pies: how often each value comes up ──────────────────────────────────
    const pie = (prop: string, tally: Tally[], colorFor?: (key: string) => string | undefined) => {
      const card = this.card(right, prop)
      if (tally.length === 0) {
        card.createEl('p', { text: 'No data in this period', cls: 'ins-no-data' })
        return
      }
      const labels = new Map(tally.map(v => [v.key, v.label]))
      // Moods in display order; other properties most common first
      const order = colorFor ? moodOrder : tally.map(v => v.key)
      const counts = new Map(order.map(key => [key, tally.find(v => v.key === key)?.count ?? 0]))
      this.charts.push(drawPie(card, counts,
        (key) => { if (key) this.searchFor(settings.tag, prop, labels.get(key) ?? key) },
        (key) => labels.get(key) ?? key, colorFor))
    }
    pie(moodName, moodTally, (key) => moodColors.get(key))
    for (const prop of settings.factorProperties) pie(prop, countValues(entries, e => e.factors[prop] ?? []))

    contentEl.scrollTop = scrollTop
  }

  private card(parent: HTMLElement, title?: string, cls?: string): HTMLElement {
    const card = parent.createDiv('ins-card' + (cls ? ` ${cls}` : ''))
    if (title) card.createDiv({ text: title, cls: 'ins-card-title' })
    return card
  }

  private renderHeader(parent: HTMLElement, tag: string, count: number) {
    const root = parent.createDiv('ins-header')
    root.createDiv({ text: `#${tag} · ${entriesText(count)}`, cls: 'ins-header-count' })
    const tabs = root.createDiv('ins-header-tabs')
    for (const range of RANGES) {
      const active = range.id === this.range
      const btn = tabs.createEl('button', { text: range.label, cls: 'ins-header-tab' + (active ? ' is-active' : '') })
      if (!active) btn.addEventListener('click', () => { this.range = range.id; this.render() })
    }
    root.createDiv('ins-header-end')
  }

  private renderSummary(parent: HTMLElement, entries: JournalEntry[], topMood: Tally | undefined, moodLower: string, moodColors: Map<string, string>) {
    const card = this.card(parent, undefined, 'ins-summary')
    const stats = card.createDiv('ins-stats')
    const stat = (label: string, value: string, sub?: string) => {
      const el = stats.createDiv('ins-stat')
      el.createDiv({ text: label, cls: 'ins-stat-label' })
      const valueEl = el.createDiv({ text: value, cls: 'ins-stat-value' })
      if (sub) el.createDiv({ text: sub, cls: 'ins-stat-sub' })
      return valueEl
    }

    const days = new Set(entries.map(e => dateText(e.date))).size
    const since = this.since() ?? (entries.length ? entries[entries.length - 1].date : new Date())
    const spanDays = Math.max(1, Math.round((Date.now() - since.getTime()) / 86_400_000) + 1)
    stat('Entries', String(entries.length), `${Math.min(100, Math.round((days / spanDays) * 100))}% of days`)

    const dayCount = (n: number) => n === 1 ? '1 day' : `${n} days`
    const { current, longest } = streaks(entries, new Date())
    stat('Current streak', dayCount(current))
    stat('Longest streak', dayCount(longest))

    if (topMood) {
      const withMood = entries.filter(e => e.mood.length > 0).length
      const valueEl = stat(`Most common ${moodLower}`, topMood.label, `${topMood.count} / ${entriesText(withMood)}`)
      valueEl.setCssProps({ color: moodColors.get(topMood.key) ?? '' })
    }
  }

  /** Newest entries; click to open the note in a new tab. */
  private renderRecent(parent: HTMLElement, entries: JournalEntry[], settings: JournalSettings, moodColors: Map<string, string>) {
    const card = this.card(parent, undefined, 'ins-recent')
    const head = card.createDiv('ins-card-title ins-recent-title')
    head.createSpan({ text: 'Recent entries' })
    head.createSpan({ text: String(entries.length), cls: 'ins-recent-count' })

    if (entries.length === 0) {
      card.createEl('p', { text: 'No data in this period', cls: 'ins-no-data' })
      return
    }

    const list = card.createDiv('ins-recent-list')
    for (const e of entries.slice(0, RECENT_LIMIT)) {
      const row = list.createDiv('ins-row')
      row.setAttribute('role', 'link')
      row.tabIndex = 0
      const top = row.createDiv('ins-row-top')
      const date = dateText(e.date)
      top.createSpan({ text: `${date} · ${WEEKDAY_NAMES[e.date.getDay()]}`, cls: 'ins-row-date' })
      for (const m of e.mood) this.chip(top, m.label, moodColors.get(m.key) ?? OTHER_COLOR)
      if (!e.title.includes(date)) row.createDiv({ text: e.title, cls: 'ins-row-title' })
      const details = settings.factorProperties.flatMap(p => (e.factors[p] ?? []).map(v => v.label))
      if (details.length) row.createDiv({ text: details.join(' · '), cls: 'ins-row-details' })

      const open = () => { void this.app.workspace.openLinkText(e.path, '', 'tab') }
      row.addEventListener('click', open)
      row.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return
        ev.preventDefault()
        open()
      })
    }
  }

  private renderLinks(parent: HTMLElement, links: MoodLink[], moodLower: string, moodLabels: Map<string, string>, moodColors: Map<string, string>) {
    const card = this.card(parent, `What goes with your ${moodLower}`)
    card.createDiv({
      text: `Where a ${moodLower} shows up clearly more often than usual (groups of 3 or more entries).`,
      cls: 'ins-hint',
    })
    if (links.length === 0) {
      card.createEl('p', { text: 'Nothing stands out yet. Check back after a few more entries.', cls: 'ins-no-data' })
      return
    }
    for (const l of links) {
      const row = card.createDiv('ins-link')
      const what = row.createDiv('ins-link-group')
      what.createSpan({ text: `${sentence(l.dimension)}: `, cls: 'ins-link-dim' })
      what.createSpan({ text: l.group })
      this.chip(row, moodLabels.get(l.moodKey) ?? l.moodKey, moodColors.get(l.moodKey) ?? OTHER_COLOR)
      row.createSpan({ text: `${Math.round(l.share * 100)}% vs ${Math.round(l.baseline * 100)}% overall`, cls: 'ins-link-share' })
      row.createSpan({ text: entriesText(l.entries), cls: 'ins-link-n' })
    }
  }

  private chip(parent: HTMLElement, label: string, color: string) {
    const chip = parent.createSpan('ins-chip')
    chip.createSpan({ cls: 'ins-legend-dot' }).setCssProps({ 'background-color': color })
    chip.createSpan({ text: label })
  }

  private renderMoodLegend(parent: HTMLElement, moods: MoodSeries[]) {
    const legend = parent.createDiv('ins-legend')
    for (const m of moods) this.chip(legend, m.label, m.color)
  }

  /** Groups with fixed keys (weekdays, seasons) in their natural order, labelled. */
  private orderGroups(groups: MoodBreakdown[], order: string[], labelFor: (key: string) => string): MoodBreakdown[] {
    const byKey = new Map(groups.map(g => [g.key, g]))
    return order.flatMap(key => {
      const g = byKey.get(key)
      return g ? [{ ...g, label: labelFor(key) }] : []
    })
  }

  private trendMonths(entries: JournalEntry[], all: JournalEntry[]) {
    const now = yearMonthOf(new Date())
    let count = this.rangeMonths()
    if (count === null) {
      const first = all.length ? yearMonthOf(all[all.length - 1].date) : now
      const [fy, fm] = first.split('-').map(Number)
      const [ny, nm] = now.split('-').map(Number)
      count = Math.min(MAX_TREND_MONTHS, Math.max(1, (ny - fy) * 12 + (nm - fm) + 1))
    }
    const byMonth = new Map(breakdownByGroup(entries, e => [{ key: yearMonthOf(e.date), label: '' }]).map(g => [g.key, g]))
    return getMonthRangeEndingAt(now, count).map(ym => ({
      label: formatMonth(ym),
      tooltip: formatMonth(ym, true),
      moods: byMonth.get(ym)?.moods ?? new Map<string, number>(),
      entries: byMonth.get(ym)?.entries ?? 0,
    }))
  }

  /** Opens Obsidian search for journal notes with this property value. */
  private searchFor(tag: string, prop: string, value: string) {
    const quote = (s: string) => /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
    const query = `tag:#${tag} [${quote(prop)}:${quote(value)}]`
    const search = (this.app as unknown as {
      internalPlugins?: { getPluginById(id: string): { instance?: { openGlobalSearch?(q: string): void } } | null }
    }).internalPlugins?.getPluginById('global-search')?.instance
    search?.openGlobalSearch?.(query)
  }
}

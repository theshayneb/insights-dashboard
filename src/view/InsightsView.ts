import { App, CachedMetadata, DropdownComponent, FuzzyMatch, FuzzySuggestModal, ItemView, Menu, Modal, TFile, WorkspaceLeaf, debounce, getAllTags, getLinkpath, setIcon } from 'obsidian'
import { Chart } from 'chart.js'
import Sortable from 'sortablejs'
import type InsightsDashboardPlugin from '../main'
import { type Dashboard, type Range, type Tab, NewDashboardModal, TextPromptModal, newDashboard, newTab } from '../settings'
import { OTHER_COLOR, drawPie, formatMonth, getMonthRangeEndingAt, getThemeColors } from './charts'
import { Series, drawShares, drawTrend, entriesText } from './journalCharts'
import {
  BUILTIN_DIMENSIONS, Breakdown, Filter, JournalEntry, JournalValue, LinkedNote, Link, Source, Tally,
  dimensionKind, groupDimensions, limitValues, matchesSource, sourceLabel,
  Column, applyFilters, breakdownByDimension, colorValues, breakdownByGroup, builtinDimension, buildEntry, countValues,
  discoverProperties, entriesSince, findLinks, layoutAfterDrop, layoutColumns, moveCard, orderValues,
  overallBreakdown, streaks, valuesOf, weekdayName, yearMonthOf,
} from '../journal'

export const INSIGHTS_VIEW_TYPE = 'insights-dashboard'

const RANGES: { id: Range; label: string; months: number | null }[] = [
  { id: '3m', label: '3 months', months: 3 },
  { id: '6m', label: '6 months', months: 6 },
  { id: '12m', label: '12 months', months: 12 },
  { id: 'all', label: 'All', months: null },
]

const MAX_TREND_MONTHS = 36  // longer spans are charted by year
const MAX_GROUPS = 10      // rows per breakdown chart
const RECENT_LIMIT = 30
const MAX_SERIES = 10     // tracked values with their own color; the rest are "Other"
const TOP_LIST_AT = 9     // a property with this many values gets a ranked list instead of a pie
const TOP_LIST_ROWS = 15

/** Summary tiles; each can be hidden on its own. */
const TILES = [
  { id: 'tile:entries', name: 'Notes' },
  { id: 'tile:current-streak', name: 'Current streak' },
  { id: 'tile:longest-streak', name: 'Longest streak' },
  { id: 'tile:most-common', name: 'Most common value' },
]

/** First letter upper-case, for titles built from property names. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function dateText(date: Date): string {
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

/** Everything one render needs, worked out once. */
interface Model {
  all: JournalEntry[]
  entries: JournalEntry[]              // in range and matching the filters
  dims: { id: string; name: string; notes: number }[] // every property found, then the built-ins
  tracked: string
  trackedName: string
  compare: string[]                    // compared dimensions that exist
  series: Series[]                     // the tracked values, in order, with colors ("Other" last if needed)
  trackedTally: Tally[]
  trackedOf: (e: JournalEntry) => JournalValue[]  // tracked values, rare ones counted as "Other"
}

/**
 * A dashboard of how the properties of a set of notes (and the notes they link to) relate. What it tracks, compares and
 * shows is chosen on the dashboard and saved in the plugin settings.
 */
export class InsightsView extends ItemView {
  private charts: Chart[] = []
  private sortables: Sortable[] = []
  private insCustomizing = false
  private insShownDashboard = ''  // to start at the top when another dashboard is picked
  private readonly insScheduleRender = debounce(() => this.render(), 1000, true)

  constructor(leaf: WorkspaceLeaf, private readonly plugin: InsightsDashboardPlugin) {
    super(leaf)
  }

  getViewType() { return INSIGHTS_VIEW_TYPE }
  getDisplayText() { return 'Insights dashboard' }
  getIcon() { return 'smile' }

  private get settings() { return this.plugin.settings }

  /** The tab shown on the dashboard. */
  private get tab(): Tab {
    const dash = this.dash
    return dash.tabs.find(t => t.id === dash.activeTab) ?? dash.tabs[0]
  }

  /** The dashboard shown: the active one in the settings. */
  private get dash(): Dashboard {
    const s = this.plugin.settings
    return s.dashboards.find(d => d.id === s.activeDashboard) ?? s.dashboards[0]
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
    this.sortables.forEach(s => s.destroy())
    this.sortables = []
  }

  /** Saves a dashboard choice; saving redraws every open dashboard. */
  private update(change: () => void) {
    change()
    void this.plugin.saveSettings()
  }

  private rangeMonths(): number | null {
    return RANGES.find(r => r.id === this.dash.range)?.months ?? null
  }

  private since(): Date | null {
    const months = this.rangeMonths()
    if (months === null) return null
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  }

  private buildModel(): Model {
    const s = this.settings
    const dash = this.dash
    const tab = this.tab
    const dateProperty = (s.dateProperty ?? '').trim() || 'date'
    const all = readEntries(this.app, dash.source, dateProperty)
    const props = discoverProperties(all, [...(s.ignoredProperties ?? []), dateProperty.toLowerCase()])
    const dims = [
      ...props.map(p => ({ id: p.id, name: p.name, notes: p.entries })),
      ...BUILTIN_DIMENSIONS.map(d => ({ id: d.id, name: d.name, notes: all.length })),
    ]
    const exists = (id: string) => dims.some(d => d.id === id)
    // A tracked property that no note has (yet) falls back to the most used one, without saving
    const tracked = exists(tab.tracked) ? tab.tracked : (props[0]?.id ?? '@weekday')
    const entries = applyFilters(entriesSince(all, this.since()), tab.filters ?? [])

    const fullTally = countValues(entries, e => valuesOf(e, tracked))
    const { order, colors } = this.colorsFor(tracked, fullTally)
    // Many values (dozens of teas or songs): the top ones keep a color, the rest are "Other"
    const kept = limitValues(order, fullTally, dash.valueColors?.[tracked] ?? {}, MAX_SERIES)
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
      trackedName: this.dimName(dims, tracked),
      compare: (tab.compare ?? this.autoCompare(props.map(p => p.id), tracked)).filter(id => id !== tracked && exists(id)),
      series,
      trackedTally,
      trackedOf,
    }
  }

  /** For a new dashboard: its most used properties, then the most used linked ones. */
  private autoCompare(propIds: string[], tracked: string): string[] {
    const others = propIds.filter(id => id !== tracked)
    return [
      ...others.filter(id => dimensionKind(id) === 'property').slice(0, 3),
      ...others.filter(id => dimensionKind(id) === 'linked').slice(0, 2),
    ]
  }

  /** A dimension's values in display order, with the chosen colors (Settings' valueColors) or palette ones. */
  private colorsFor(dim: string, tally: Tally[]): { order: string[]; colors: Map<string, string> } {
    return colorValues(orderValues(tally, dim), this.dash.valueColors?.[dim] ?? {}, getThemeColors().palette)
  }

  private dimName(dims: { id: string; name: string; notes: number }[], id: string): string {
    return dims.find(d => d.id === id)?.name ?? builtinDimension(id)?.name ?? id
  }

  render(): void {
    const { contentEl } = this
    const scrollTop = this.insShownDashboard === this.dash.id ? contentEl.scrollTop : 0
    this.insShownDashboard = this.dash.id
    this.clearCharts()
    contentEl.empty()
    contentEl.addClass('ins-dashboard')
    contentEl.toggleClass('is-customizing', this.insCustomizing)

    const m = this.buildModel()
    this.renderHeader(contentEl, m)

    if (m.all.length === 0) {
      const card = contentEl.createDiv('ins-empty').createDiv('ins-card')
      card.createEl('p', {
        text: `No notes found for ${sourceLabel(this.dash.source)}. Pick another dashboard above, or add one.`,
        cls: 'ins-no-data',
      })
      return
    }

    this.renderTabs(contentEl, m)
    this.renderToolbar(contentEl, m)
    this.renderFilters(contentEl, m)
    if (this.insCustomizing) {
      this.renderHiddenTray(contentEl, m)
      this.renderColorTray(contentEl, m)
    }

    if (m.entries.length === 0) {
      contentEl.createDiv('ins-empty').createDiv('ins-card').createEl('p', {
        text: 'No notes match. Try a longer range or remove a filter.',
        cls: 'ins-no-data',
      })
      return
    }

    const grid = contentEl.createDiv('ins-grid')
    const left = grid.createDiv('ins-grid-left')
    const right = grid.createDiv('ins-grid-right')

    // ── Top row: summary tiles + recent entries (hideable, not movable) ──────
    const topRow = left.createDiv('ins-left-top')
    this.renderSummary(topRow, m)
    this.renderRecent(topRow, m)
    if (!topRow.hasChildNodes()) topRow.remove()

    // ── Movable cards ─────────────────────────────────────────────────────────
    // ── Movable cards: either column, saved order ────────────────────────────
    const cards = [
      ...this.leftCards(m).map(c => ({ ...c, column: 'left' as Column })),
      ...this.rightCards(m).map(c => ({ ...c, column: 'right' as Column })),
    ]
    const layout = layoutColumns(cards, this.tab.cardColumns ?? {}, this.tab.cardOrder ?? [])
    this.renderColumn(left, 'left', layout, cards)
    this.renderColumn(right, 'right', layout, cards)
    if (this.insCustomizing) this.enableDragging(left, right)

    contentEl.scrollTop = scrollTop
  }

  // ─── Header, toolbar, filters ───────────────────────────────────────────────

  private renderHeader(parent: HTMLElement, m: Model) {
    const root = parent.createDiv('ins-header')
    const start = root.createDiv('ins-header-count')
    start.createSpan({ text: 'Dashboard', cls: 'ins-toolbar-label' })
    const picker = new DropdownComponent(start)
    for (const d of this.settings.dashboards) picker.addOption(d.id, sourceLabel(d.source))
    picker.setValue(this.dash.id)
    picker.onChange((id) => this.update(() => { this.settings.activeDashboard = id }))
    const add = start.createEl('button', { cls: 'ins-link-btn', attr: { 'aria-label': 'A dashboard for the notes with another tag, in a folder, or all notes' } })
    setIcon(add.createSpan(), 'plus')
    add.createSpan({ text: 'New dashboard' })
    add.addEventListener('click', () => {
      new NewDashboardModal(this.app, (source) => this.update(() => {
        const dash = newDashboard(source)
        this.settings.dashboards.push(dash)
        this.settings.activeDashboard = dash.id
      })).open()
    })
    start.createSpan({ text: `· ${entriesText(m.entries.length)}` })
    const tabs = root.createDiv('ins-header-tabs')
    for (const range of RANGES) {
      const active = range.id === this.dash.range
      const btn = tabs.createEl('button', { text: range.label, cls: 'ins-header-tab' + (active ? ' is-active' : '') })
      if (!active) btn.addEventListener('click', () => this.update(() => { this.dash.range = range.id }))
    }
    const end = root.createDiv('ins-header-end')
    const customize = end.createEl('button', {
      cls: 'ins-customize-btn' + (this.insCustomizing ? ' is-active' : ''),
      attr: { 'aria-label': 'Choose which cards to show and their order' },
    })
    setIcon(customize.createSpan(), this.insCustomizing ? 'check' : 'layout-dashboard')
    customize.createSpan({ text: this.insCustomizing ? 'Done' : 'Customize' })
    customize.addEventListener('click', () => { this.insCustomizing = !this.insCustomizing; this.render() })
  }

  /** The dashboard's questions, as tabs; the active one has a menu to rename, duplicate or remove it. */
  private renderTabs(parent: HTMLElement, m: Model) {
    const bar = parent.createDiv('ins-tabs')
    const dash = this.dash
    for (const tab of dash.tabs) {
      const active = tab.id === this.tab.id
      const name = tab.name || sentence(this.dimName(m.dims, tab.tracked || m.tracked))
      const btn = bar.createEl('button', { cls: 'ins-tab' + (active ? ' is-active' : '') })
      btn.createSpan({ text: name })
      if (!active) {
        btn.addEventListener('click', () => this.update(() => { dash.activeTab = tab.id }))
        continue
      }
      const more = btn.createSpan({ cls: 'ins-tab-more', attr: { 'aria-label': 'Tab options' } })
      setIcon(more, 'chevron-down')
      btn.addEventListener('click', (ev) => {
        const menu = new Menu()
        menu.addItem(i => i.setTitle('Rename').setIcon('pencil').onClick(() => {
          new TextPromptModal(this.app, 'Tab name', name, (value) => this.update(() => { tab.name = value })).open()
        }))
        menu.addItem(i => i.setTitle('Duplicate').setIcon('copy').onClick(() => this.update(() => {
          const copy: Tab = { ...structuredClone(tab), id: newTab().id, name: tab.name ? `${tab.name} (copy)` : '' }
          dash.tabs.splice(dash.tabs.indexOf(tab) + 1, 0, copy)
          dash.activeTab = copy.id
        })))
        if (dash.tabs.length > 1) {
          menu.addItem(i => i.setTitle('Remove').setIcon('trash').onClick(() => this.update(() => {
            const index = dash.tabs.indexOf(tab)
            dash.tabs.splice(index, 1)
            dash.activeTab = dash.tabs[Math.max(0, index - 1)].id
          })))
        }
        menu.showAtMouseEvent(ev)
      })
    }
    const add = bar.createEl('button', { cls: 'ins-tab ins-tab-add', attr: { 'aria-label': 'New tab' } })
    setIcon(add, 'plus')
    add.addEventListener('click', () => {
      // A new question: pick what it tracks; comparisons are added on the tab
      new DimensionPicker(this.app, m.dims, 'What should the new tab track?', (dim) => this.update(() => {
        const tab = newTab(dim.id, [])
        dash.tabs.push(tab)
        dash.activeTab = tab.id
      })).open()
    })
  }

  /** Track (what the bars are split by), compare with (the groups), % or counts. */
  private renderToolbar(parent: HTMLElement, m: Model) {
    const bar = parent.createDiv('ins-toolbar')

    const trackGroup = bar.createDiv('ins-toolbar-group')
    trackGroup.createSpan({ text: 'Track', cls: 'ins-toolbar-label' })
    const track = trackGroup.createEl('button', { cls: 'ins-picker-btn' })
    track.createSpan({ text: m.trackedName })
    setIcon(track.createSpan(), 'chevron-down')
    track.addEventListener('click', () => {
      new DimensionPicker(this.app, m.dims.filter(d => d.id !== m.tracked), 'Track…', (dim) => this.update(() => {
        // The old tracked dimension is a natural thing to compare with
        this.tab.compare = [m.tracked, ...m.compare.filter(id => id !== dim.id)]
        this.tab.tracked = dim.id
      })).open()
    })

    const compareGroup = bar.createDiv('ins-toolbar-group ins-compare')
    compareGroup.createSpan({ text: 'Compare with', cls: 'ins-toolbar-label' })
    for (const id of m.compare) {
      const chip = compareGroup.createSpan('ins-filter-chip ins-compare-chip' + (dimensionKind(id) === 'date' ? ' is-builtin' : ''))
      chip.createSpan({ text: this.dimName(m.dims, id) })
      const remove = chip.createEl('button', { cls: 'ins-filter-remove', attr: { 'aria-label': 'Stop comparing' } })
      setIcon(remove, 'x')
      remove.addEventListener('click', () => this.update(() => { this.tab.compare = m.compare.filter(x => x !== id) }))
    }
    const add = compareGroup.createEl('button', { cls: 'ins-link-btn' })
    setIcon(add.createSpan(), 'plus')
    add.createSpan({ text: 'Add' })
    add.addEventListener('click', () => {
      const options = m.dims.filter(d => d.id !== m.tracked && !m.compare.includes(d.id))
      new DimensionPicker(this.app, options, 'Compare with…', (dim) => this.update(() => {
        this.tab.compare = [...m.compare, dim.id]
      })).open()
    })

    const modeGroup = bar.createDiv('ins-toolbar-group')
    modeGroup.createSpan({ text: 'Bars', cls: 'ins-toolbar-label' })
    const seg = modeGroup.createDiv('ins-segmented')
    for (const [mode, label] of [['percent', '%'], ['count', 'Count']] as const) {
      const active = this.dash.valueMode === mode
      const btn = seg.createEl('button', { text: label, cls: active ? 'is-active' : '' })
      if (!active) btn.addEventListener('click', () => this.update(() => { this.dash.valueMode = mode }))
    }
  }

  private renderFilters(parent: HTMLElement, m: Model) {
    const bar = parent.createDiv('ins-filters')
    bar.createSpan({ text: 'Filters', cls: 'ins-toolbar-label' })
    const filters = this.tab.filters ?? []
    if (filters.length === 0) bar.createSpan({ text: 'Click a pie slice or bar to filter', cls: 'ins-filters-hint' })
    for (const f of filters) {
      const chip = bar.createSpan('ins-filter-chip')
      chip.createSpan({ text: `${this.dimName(m.dims, f.dim)}: `, cls: 'ins-filter-dim' })
      chip.createSpan({ text: f.label })
      const remove = chip.createEl('button', { cls: 'ins-filter-remove', attr: { 'aria-label': 'Remove filter' } })
      setIcon(remove, 'x')
      remove.addEventListener('click', () => this.update(() => {
        this.tab.filters = this.tab.filters.filter(x => x !== f)
      }))
    }

    const add = bar.createEl('button', { cls: 'ins-link-btn' })
    setIcon(add.createSpan(), 'plus')
    add.createSpan({ text: 'Add filter' })
    add.addEventListener('click', (ev) => this.openFilterMenu(ev, m))

    if (filters.length > 0) {
      const searchable = filters.some(f => dimensionKind(f.dim) === 'property')
      if (searchable) {
        const search = bar.createEl('button', { text: 'Search these notes', cls: 'ins-link-btn' })
        search.addEventListener('click', () => this.searchFiltered(m))
      }
      const clear = bar.createEl('button', { text: 'Clear', cls: 'ins-link-btn' })
      clear.addEventListener('click', () => this.update(() => { this.tab.filters = [] }))
    }
  }

  /** Two steps: pick a property (searchable), then one of its values (with note counts). */
  private openFilterMenu(_ev: MouseEvent, m: Model) {
    const inRange = entriesSince(m.all, this.since())
    new DimensionPicker(this.app, m.dims, 'Filter by…', (d) => {
      const values = countValues(applyFilters(inRange, this.tab.filters.filter(f => f.dim !== d.id)), e => valuesOf(e, d.id))
      const items = orderValues(values, d.id).map(key => values.find(x => x.key === key)!)
      new ValuePicker(this.app, items, `${d.name}…`, (v) => this.addFilter(d.id, v.key, v.label)).open()
    }).open()
  }

  /** One filter per dimension: a new value replaces the old one. */
  private addFilter(dim: string, value: string, label: string) {
    this.update(() => {
      this.tab.filters = [...this.tab.filters.filter(f => f.dim !== dim), { dim, value, label } satisfies Filter]
    })
  }

  // ─── Cards ──────────────────────────────────────────────────────────────────

  private leftCards(m: Model): { id: string; name: string; half?: boolean; draw: (card: HTMLElement) => void }[] {
    const tracked = m.trackedName.toLowerCase()
    const cards = [
      { id: 'links', name: `What goes with your ${tracked}`, draw: (c: HTMLElement) => this.drawLinks(c, m) },
      { id: 'trend', name: sentence(`${tracked} over time`), draw: (c: HTMLElement) => this.drawTrendCard(c, m) },
      ...m.compare.map(dim => ({
        id: `split:${dim}`,
        // Date breakdowns are a few columns: half width, so two sit side by side
        half: dimensionKind(dim) === 'date',
        name: sentence(`${tracked} by ${this.dimName(m.dims, dim).toLowerCase()}`),
        draw: (c: HTMLElement) => this.drawSplit(c, m, dim),
      })),
    ]
    return cards
  }

  private rightCards(m: Model): { id: string; name: string; half?: boolean; draw: (card: HTMLElement) => void }[] {
    return [m.tracked, ...m.compare.filter(d => dimensionKind(d) !== 'date')].map(dim => ({
      id: `pie:${dim}`,
      name: this.dimName(m.dims, dim),
      draw: (c: HTMLElement) => this.drawPieCard(c, m, dim),
    }))
  }

  private renderColumn(
    parent: HTMLElement,
    column: Column,
    layout: Record<Column, string[]>,
    cards: { id: string; name: string; half?: boolean; draw: (card: HTMLElement) => void }[],
  ) {
    const ids = layout[column]
    const visible = ids.filter(id => !this.isHidden(id))
    for (const id of visible) {
      const card = cards.find(c => c.id === id)!
      const el = this.card(parent, card.name, id, card.half ? 'ins-card-half' : undefined)
      if (this.insCustomizing) {
        const title = el.querySelector<HTMLElement>('.ins-card-title')
        if (title) {
          const handle = createDiv({ cls: 'ins-drag-handle', attr: { 'aria-label': 'Drag to move' } })
          setIcon(handle, 'grip-vertical')
          title.prepend(handle)
          const controls = title.createDiv('ins-card-controls')
          const other: Column = column === 'left' ? 'right' : 'left'
          this.iconButton(controls, 'arrow-up', 'Move up', visible.indexOf(id) === 0,
            () => this.update(() => { this.tab.cardOrder = moveCard(ids, visible, id, -1, this.tab.cardOrder) }))
          this.iconButton(controls, 'arrow-down', 'Move down', visible.indexOf(id) === visible.length - 1,
            () => this.update(() => { this.tab.cardOrder = moveCard(ids, visible, id, 1, this.tab.cardOrder) }))
          this.iconButton(controls, column === 'left' ? 'arrow-right-to-line' : 'arrow-left-to-line',
            `Move to the ${other} column`, false,
            () => this.update(() => {
              this.tab.cardColumns = { ...this.tab.cardColumns, [id]: other }
              // No saved position: it goes to the bottom of the other column
              this.tab.cardOrder = this.tab.cardOrder.filter(x => x !== id)
            }))
          this.hideButton(controls, id)
        }
      }
      card.draw(el)
    }
  }

  /** Customize mode: drag cards by their handle, within or between the columns. */
  private enableDragging(left: HTMLElement, right: HTMLElement) {
    const options: Sortable.Options = {
      group: 'ins-cards',
      handle: '.ins-drag-handle',
      draggable: '.ins-card[data-card]',
      animation: 150,
      ghostClass: 'ins-drag-ghost',
      chosenClass: 'ins-drag-chosen',
      onEnd: () => {
        const idsIn = (col: HTMLElement) => [...col.children]
          .map(el => (el as HTMLElement).dataset['card'])
          .filter((id): id is string => !!id)
        const { columns, order } = layoutAfterDrop(idsIn(left), idsIn(right),
          this.tab.cardColumns ?? {}, this.tab.cardOrder ?? [])
        this.update(() => {
          this.tab.cardColumns = columns
          this.tab.cardOrder = order
        })
      },
    }
    this.sortables.push(Sortable.create(left, options), Sortable.create(right, options))
  }

  private isHidden(id: string): boolean {
    return (this.tab.hiddenCards ?? []).includes(id)
  }

  private card(parent: HTMLElement, title: string | undefined, id: string, cls?: string): HTMLElement {
    const card = parent.createDiv('ins-card' + (cls ? ` ${cls}` : ''))
    card.dataset['card'] = id
    if (title) card.createDiv('ins-card-title').createSpan({ text: title })
    return card
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, disabled: boolean, onClick: () => void) {
    const btn = parent.createEl('button', { cls: 'ins-icon-btn clickable-icon', attr: { 'aria-label': label } })
    setIcon(btn, icon)
    btn.disabled = disabled
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
  }

  private hideButton(parent: HTMLElement, id: string) {
    this.iconButton(parent, 'eye-off', 'Hide', false,
      () => this.update(() => { this.tab.hiddenCards = [...this.tab.hiddenCards, id] }))
  }

  /** In customize mode: the hidden cards and tiles, click to show again. */
  private renderHiddenTray(parent: HTMLElement, m: Model) {
    const tray = parent.createDiv('ins-hidden-tray')
    tray.createSpan({ text: 'Hidden', cls: 'ins-toolbar-label' })
    const names = new Map<string, string>([
      ...TILES.map(t => [t.id, t.name] as [string, string]),
      ['recent', 'Recent notes'],
      ...[...this.leftCards(m), ...this.rightCards(m)].map(c => [c.id, c.name] as [string, string]),
    ])
    const hidden = (this.tab.hiddenCards ?? []).filter(id => names.has(id))
    if (hidden.length === 0) {
      tray.createSpan({ text: 'Nothing hidden. Use the eye on a card or tile to hide it, and the arrows to move cards.', cls: 'ins-filters-hint' })
      return
    }
    for (const id of hidden) {
      const chip = tray.createEl('button', { cls: 'ins-toggle', attr: { 'aria-label': 'Show again' } })
      setIcon(chip.createSpan(), 'eye')
      chip.createSpan({ text: names.get(id) ?? id })
      chip.addEventListener('click', () => this.update(() => {
        this.tab.hiddenCards = this.tab.hiddenCards.filter(x => x !== id)
      }))
    }
  }

  /** In customize mode: a color picker for each value of the tracked dimension. */
  private renderColorTray(parent: HTMLElement, m: Model) {
    if (m.series.length === 0) return
    const tray = parent.createDiv('ins-hidden-tray ins-color-tray')
    tray.createSpan({ text: `${m.trackedName} colors`, cls: 'ins-toolbar-label' })
    const save = (change: (colors: Record<string, string>) => void) => this.update(() => {
      // Keep the values shown in their current order, so a newly colored one doesn't jump to the front
      const current = { ...(this.dash.valueColors?.[m.tracked] ?? {}) }
      change(current)
      const ordered: Record<string, string> = {}
      for (const s of m.series) if (current[s.key]) ordered[s.key] = current[s.key]
      for (const [k, c] of Object.entries(current)) if (!(k in ordered)) ordered[k] = c
      this.dash.valueColors = { ...this.dash.valueColors, [m.tracked]: ordered }
    })
    for (const s of m.series) {
      const item = tray.createEl('label', { cls: 'ins-color-item' })
      const input = item.createEl('input', { type: 'color', cls: 'ins-color-input' })
      input.value = s.color
      item.createSpan({ text: s.label })
      input.addEventListener('change', () => save(colors => { colors[s.key] = input.value }))
    }
    if (Object.keys(this.dash.valueColors?.[m.tracked] ?? {}).length > 0) {
      const reset = tray.createEl('button', { text: 'Reset colors', cls: 'ins-link-btn' })
      reset.addEventListener('click', () => this.update(() => {
        const next = { ...this.dash.valueColors }
        delete next[m.tracked]
        this.dash.valueColors = next
      }))
    }
  }

  private renderSummary(parent: HTMLElement, m: Model) {
    const tiles = TILES.filter(t => !this.isHidden(t.id))
    if (tiles.length === 0) return
    const card = this.card(parent, undefined, 'summary', 'ins-summary')
    const stats = card.createDiv('ins-stats')
    const { entries } = m
    const { current, longest } = streaks(entries, new Date())
    const dayCount = (n: number) => n === 1 ? '1 day' : `${n} days`

    for (const tile of tiles) {
      const el = stats.createDiv('ins-stat')
      const head = el.createDiv('ins-stat-label')
      const value = (label: string, text: string, sub?: string) => {
        head.createSpan({ text: label })
        if (this.insCustomizing) this.hideButton(head.createDiv('ins-card-controls'), tile.id)
        const valueEl = el.createDiv({ text, cls: 'ins-stat-value' })
        if (sub) el.createDiv({ text: sub, cls: 'ins-stat-sub' })
        return valueEl
      }
      if (tile.id === 'tile:entries') {
        const days = new Set(entries.map(e => dateText(e.date))).size
        const since = this.since() ?? (m.all.length ? m.all[m.all.length - 1].date : new Date())
        const spanDays = Math.max(1, Math.round((Date.now() - since.getTime()) / 86_400_000) + 1)
        value('Notes', String(entries.length), `${Math.min(100, Math.round((days / spanDays) * 100))}% of days`)
      } else if (tile.id === 'tile:current-streak') {
        value('Current streak', dayCount(current))
      } else if (tile.id === 'tile:longest-streak') {
        value('Longest streak', dayCount(longest))
      } else {
        const withValue = entries.filter(e => valuesOf(e, m.tracked).length > 0).length
        const fullTop = countValues(entries, e => valuesOf(e, m.tracked))[0]
        const top = fullTop
        const valueEl = value(`Most common ${m.trackedName.toLowerCase()}`, top?.label ?? '–',
          top ? `${top.count} / ${entriesText(withValue)}` : undefined)
        if (top) valueEl.setCssProps({ color: m.series.find(s => s.key === top.key)?.color ?? '' })
      }
    }
  }

  /** Newest entries; click to open the note in a new tab. */
  private renderRecent(parent: HTMLElement, m: Model) {
    if (this.isHidden('recent')) return
    const card = this.card(parent, undefined, 'recent', 'ins-recent')
    const head = card.createDiv('ins-card-title ins-recent-title')
    head.createSpan({ text: 'Recent notes' })
    const end = head.createDiv('ins-card-controls')
    end.createSpan({ text: String(m.entries.length), cls: 'ins-recent-count' })
    if (this.insCustomizing) this.hideButton(end, 'recent')

    const colorOf = new Map(m.series.map(s => [s.key, s.color]))
    const list = card.createDiv('ins-recent-list')
    for (const e of m.entries.slice(0, RECENT_LIMIT)) {
      const row = list.createDiv('ins-row')
      row.setAttribute('role', 'link')
      row.tabIndex = 0
      const top = row.createDiv('ins-row-top')
      const date = dateText(e.date)
      top.createSpan({ text: `${date} · ${weekdayName(e.date)}`, cls: 'ins-row-date' })
      for (const v of valuesOf(e, m.tracked)) this.chip(top, v.label, colorOf.get(v.key) ?? OTHER_COLOR)
      if (!e.title.includes(date)) row.createDiv({ text: e.title, cls: 'ins-row-title' })
      const details = m.compare.filter(d => dimensionKind(d) !== 'date').flatMap(d => valuesOf(e, d).map(v => v.label))
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

  private drawLinks(card: HTMLElement, m: Model) {
    const tracked = m.trackedName.toLowerCase()
    card.createDiv({
      text: `Groups where one ${tracked} value shows up clearly more often than usual (3 or more notes). Click one to filter by it.`,
      cls: 'ins-hint',
    })
    const overall = overallBreakdown(m.entries, m.trackedOf, 'All notes')
    const links: Link[] = findLinks(m.compare.map(dim => ({
      id: dim,
      name: this.dimName(m.dims, dim),
      groups: breakdownByDimension(m.entries, dim, m.trackedOf),
    })), overall)
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
      row.addEventListener('click', () => this.addFilter(l.dimensionId, l.groupKey, l.group))
    }
  }

  private drawTrendCard(card: HTMLElement, m: Model) {
    card.addClass('ins-trend-card')
    if (m.series.length === 0) {
      card.createEl('p', { text: `No notes in this period have a ${m.trackedName} value.`, cls: 'ins-no-data' })
      return
    }
    this.legend(card, m.series)
    const now = yearMonthOf(new Date())
    let count = this.rangeMonths()
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
          { onColumnClick: (i) => this.addFilter('@year', byYear[i].key, byYear[i].label) }))
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

  private drawSplit(card: HTMLElement, m: Model, dim: string) {
    const groups: Breakdown[] = breakdownByDimension(m.entries, dim, m.trackedOf)
    if (groups.length === 0 || m.series.length === 0) {
      card.createEl('p', { text: 'No data in this period', cls: 'ins-no-data' })
      return
    }
    this.legend(card, m.series)
    const mode = this.dash.valueMode ?? 'percent'
    // Date groups are few and in order: upright columns, like the month chart
    if (builtinDimension(dim)) {
      // In % mode an "All" column first gives the usual mix to compare with
      const columns = mode === 'percent' ? [overallBreakdown(m.entries, m.trackedOf, 'All'), ...groups] : groups
      const chart = drawTrend(card.createDiv('ins-chart-wrap ins-columns-wrap'),
        columns.map(g => ({ label: g.label, tooltip: g.label === 'All' ? 'All notes' : g.label, mix: g.mix, entries: g.entries })),
        m.series,
        { mode, onColumnClick: (i) => { if (columns[i].key !== '__all__') this.addFilter(dim, columns[i].key, columns[i].label) } })
      this.charts.push(chart)
      return
    }
    const rows = [overallBreakdown(m.entries, m.trackedOf, 'All notes'), ...groups.slice(0, MAX_GROUPS)]
    this.charts.push(drawShares(card, rows, m.series, mode, (i) => {
      if (i > 0) this.addFilter(dim, rows[i].key, rows[i].label)
    }))
    if (groups.length > MAX_GROUPS) {
      card.createDiv({ text: `Showing the ${MAX_GROUPS} biggest of ${groups.length} groups`, cls: 'ins-hint ins-more' })
    }
  }

  private drawPieCard(card: HTMLElement, m: Model, dim: string) {
    const tally = countValues(m.entries, e => valuesOf(e, dim))
    if (tally.length === 0) {
      card.createEl('p', { text: 'No data in this period', cls: 'ins-no-data' })
      return
    }
    if (tally.length >= TOP_LIST_AT) {
      this.drawTopList(card, tally, dim, dim === m.tracked ? new Map(m.series.map(s => [s.key, s.color])) : undefined)
      return
    }
    const labels = new Map(tally.map(v => [v.key, v.label]))
    const { order, colors } = dim === m.tracked
      ? { order: m.series.map(s => s.key), colors: new Map(m.series.map(s => [s.key, s.color])) }
      : this.colorsFor(dim, tally)
    const counts = new Map(order.map(key => [key, tally.find(v => v.key === key)?.count ?? 0]))
    this.charts.push(drawPie(card, counts,
      (key) => { if (key) this.addFilter(dim, key, labels.get(key) ?? key) },
      (key) => labels.get(key) ?? key,
      (key) => colors.get(key)))
  }

  /** Values ranked by how many notes have them (e.g. most frequent songs); click one to filter by it. */
  private drawTopList(card: HTMLElement, tally: Tally[], dim: string, colors?: Map<string, string>) {
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
      row.addEventListener('click', () => this.addFilter(dim, v.key, v.label))
    }
    if (tally.length > TOP_LIST_ROWS) {
      card.createDiv({ text: `Top ${TOP_LIST_ROWS} of ${tally.length}`, cls: 'ins-hint ins-more' })
    }
  }

  private chip(parent: HTMLElement, label: string, color: string | undefined) {
    const chip = parent.createSpan('ins-chip')
    chip.createSpan({ cls: 'ins-legend-dot' }).setCssProps({ 'background-color': color ?? 'var(--text-faint)' })
    chip.createSpan({ text: label })
  }

  private legend(parent: HTMLElement, series: Series[]) {
    const legend = parent.createDiv('ins-legend')
    for (const s of series) this.chip(legend, s.label, s.color)
  }

  /** Opens Obsidian search for the dashboard's notes matching the property filters (others can't be searched). */
  private searchFiltered(m: Model) {
    const quote = (s: string) => /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
    const src = this.dash.source
    const parts = src.kind === 'tag' ? [`tag:#${src.value}`] : src.kind === 'folder' ? [`path:${quote(src.value.replace(/\/+$/, '') + '/')}`] : []
    for (const f of this.tab.filters) {
      if (dimensionKind(f.dim) !== 'property') continue
      parts.push(`[${quote(this.dimName(m.dims, f.dim))}:${quote(f.label)}]`)
    }
    const search = (this.app as unknown as {
      internalPlugins?: { getPluginById(id: string): { instance?: { openGlobalSearch?(q: string): void } } | null }
    }).internalPlugins?.getPluginById('global-search')?.instance
    search?.openGlobalSearch?.(parts.join(' '))
  }
}

type PickerDim = { id: string; name: string; notes: number }

/** Sections opened in the picker, remembered while Obsidian runs. */
const openPickerSections = new Set<string>(['own'])

/**
 * Picks a dimension (a vault can have hundreds): a search box over collapsible,
 * alphabetical sections (properties, linked notes by tag, one per link
 * property, dates), each item with how many notes have it.
 */
class DimensionPicker extends Modal {
  constructor(app: App, private readonly dims: PickerDim[], private readonly title: string, private readonly onPick: (dim: PickerDim) => void) {
    super(app)
  }

  onOpen() {
    this.setTitle(this.title)
    this.modalEl.addClass('ins-picker-modal')
    const search = this.contentEl.createEl('input', { type: 'search', cls: 'ins-picker-search', attr: { placeholder: 'Search' } })
    const list = this.contentEl.createDiv('ins-picker-sections')
    const sections = groupDimensions(this.dims)

    const draw = () => {
      list.empty()
      const query = search.value.trim().toLowerCase()
      let first: PickerDim | undefined
      for (const section of sections) {
        const items = query ? section.items.filter(d => d.name.toLowerCase().includes(query)) : section.items
        if (items.length === 0) continue
        first ??= items[0]
        const open = query !== '' || openPickerSections.has(section.key)
        const sectionEl = list.createDiv('ins-picker-section' + (open ? ' is-open' : ''))
        const head = sectionEl.createEl('button', { cls: 'ins-picker-section-head', attr: { 'aria-expanded': String(open) } })
        setIcon(head.createSpan('ins-picker-chevron'), open ? 'chevron-down' : 'chevron-right')
        head.createSpan({ text: section.title, cls: 'ins-picker-section-title' })
        head.createSpan({ text: String(items.length), cls: 'ins-picker-meta' })
        head.addEventListener('click', () => {
          if (openPickerSections.has(section.key)) openPickerSections.delete(section.key)
          else openPickerSections.add(section.key)
          draw()
        })
        if (!open) continue
        for (const d of items) {
          const row = sectionEl.createEl('button', { cls: 'ins-picker-item' })
          // In "Through SOTD", "SOTD → Artist" reads as just "Artist"
          row.createSpan({ text: section.key.startsWith('through:') ? d.name.split(' → ').slice(1).join(' → ') : d.name })
          row.createSpan({
            text: dimensionKind(d.id) === 'date' ? '' : d.notes === 1 ? '1 note' : `${d.notes} notes`,
            cls: 'ins-picker-meta',
          })
          row.addEventListener('click', () => { this.close(); this.onPick(d) })
        }
      }
      if (!first) list.createDiv({ text: 'Nothing matches', cls: 'ins-filters-hint ins-picker-empty' })
      this.insFirst = first
    }

    search.addEventListener('input', draw)
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.insFirst) { e.preventDefault(); const d = this.insFirst; this.close(); this.onPick(d) }
    })
    draw()
    window.setTimeout(() => search.focus(), 0)
  }

  private insFirst: PickerDim | undefined

  onClose() {
    this.contentEl.empty()
  }
}

/** Searchable list of a dimension's values, with how many notes have each. */
class ValuePicker extends FuzzySuggestModal<Tally> {
  constructor(app: App, private readonly values: Tally[], placeholder: string, private readonly onPick: (value: Tally) => void) {
    super(app)
    this.setPlaceholder(placeholder)
    this.limit = 300
  }

  getItems(): Tally[] {
    return this.values
  }

  getItemText(v: Tally): string {
    return v.label
  }

  renderSuggestion(match: FuzzyMatch<Tally>, el: HTMLElement) {
    super.renderSuggestion(match, el)
    el.addClass('ins-picker-item')
    el.createSpan({ text: String(match.item.count), cls: 'ins-picker-meta' })
  }

  onChooseItem(v: Tally) {
    this.onPick(v)
  }
}

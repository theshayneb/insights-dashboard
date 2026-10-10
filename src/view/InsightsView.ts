import { App, CachedMetadata, DropdownComponent, ItemView, Menu, WorkspaceLeaf, debounce, getAllTags, setIcon } from 'obsidian'
import { Chart } from 'chart.js'
import Sortable from 'sortablejs'
import type InsightsDashboardPlugin from '../main'
import type { Range } from '../settings'
import { assignColors, drawPie, formatMonth, getMonthRangeEndingAt, getThemeColors } from './charts'
import { Series, drawShares, drawTrend, entriesText } from './journalCharts'
import {
  BUILTIN_DIMENSIONS, Breakdown, Filter, JournalEntry, Link, Tally,
  Column, applyFilters, breakdownByDimension, breakdownByGroup, builtinDimension, buildEntry, countValues,
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

const MAX_TREND_MONTHS = 24
const MAX_GROUPS = 10      // rows per breakdown chart
const RECENT_LIMIT = 30

/** Summary tiles; each can be hidden on its own. */
const TILES = [
  { id: 'tile:entries', name: 'Entries' },
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

/** Tag comparison key: case-insensitive, no "#", and "-" / "_" count as the same. */
function tagKey(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase().replace(/-/g, '_')
}

/** Notes tagged `tag` (or a nested tag under it), as journal entries, newest first. */
export function readJournalEntries(app: App, tag: string, dateProperty: string): JournalEntry[] {
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
      dateProperty,
    ))
  }
  return entries.sort((a, b) => b.date.getTime() - a.date.getTime() || a.path.localeCompare(b.path))
}

/** Everything one render needs, worked out once. */
interface Model {
  all: JournalEntry[]
  entries: JournalEntry[]              // in range and matching the filters
  dims: { id: string; name: string }[] // every property found, then the built-ins
  tracked: string
  trackedName: string
  compare: string[]                    // compared dimensions that exist
  series: Series[]                     // the tracked values, in order, with colors
  trackedTally: Tally[]
}

/**
 * A dashboard of how journal properties relate. What it tracks, compares and
 * shows is chosen on the dashboard and saved in the plugin settings.
 */
export class InsightsView extends ItemView {
  private charts: Chart[] = []
  private sortables: Sortable[] = []
  private insCustomizing = false
  private readonly insScheduleRender = debounce(() => this.render(), 1000, true)

  constructor(leaf: WorkspaceLeaf, private readonly plugin: InsightsDashboardPlugin) {
    super(leaf)
  }

  getViewType() { return INSIGHTS_VIEW_TYPE }
  getDisplayText() { return 'Insights dashboard' }
  getIcon() { return 'smile' }

  private get settings() { return this.plugin.settings }

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
    return RANGES.find(r => r.id === this.settings.range)?.months ?? null
  }

  private since(): Date | null {
    const months = this.rangeMonths()
    if (months === null) return null
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  }

  private buildModel(): Model {
    const s = this.settings
    const dateProperty = (s.dateProperty ?? '').trim() || 'date'
    const all = readJournalEntries(this.app, (s.tag ?? '').trim(), dateProperty)
    const props = discoverProperties(all, [...(s.ignoredProperties ?? []), dateProperty.toLowerCase()])
    const dims = [
      ...props.map(p => ({ id: p.id, name: p.name })),
      ...BUILTIN_DIMENSIONS.map(d => ({ id: d.id, name: d.name })),
    ]
    const exists = (id: string) => dims.some(d => d.id === id)
    // A tracked property that no note has (yet) falls back to the most used one, without saving
    const tracked = exists(s.tracked) ? s.tracked : (props[0]?.id ?? '@weekday')
    const entries = applyFilters(entriesSince(all, this.since()), s.filters ?? [])

    const trackedTally = countValues(entries, e => valuesOf(e, tracked))
    const order = orderValues(trackedTally, tracked)
    const labels = new Map(trackedTally.map(v => [v.key, v.label]))
    // Colors follow the display order, so numeric values (1–5) keep the same colors
    const colors = assignColors(order, getThemeColors().palette)
    return {
      all,
      entries,
      dims,
      tracked,
      trackedName: this.dimName(dims, tracked),
      compare: (s.compare ?? []).filter(id => id !== tracked && exists(id)),
      series: order.map(key => ({ key, label: labels.get(key) ?? key, color: colors.get(key)! })),
      trackedTally,
    }
  }

  private dimName(dims: { id: string; name: string }[], id: string): string {
    return dims.find(d => d.id === id)?.name ?? builtinDimension(id)?.name ?? id
  }

  render(): void {
    const { contentEl } = this
    const scrollTop = contentEl.scrollTop
    this.clearCharts()
    contentEl.empty()
    contentEl.addClass('ins-dashboard')
    contentEl.toggleClass('is-customizing', this.insCustomizing)

    const m = this.buildModel()
    this.renderHeader(contentEl, m)

    if (m.all.length === 0) {
      const card = contentEl.createDiv('ins-empty').createDiv('ins-card')
      card.createEl('p', {
        text: `No notes tagged #${this.settings.tag || 'journal_entry'} yet. The tag can be changed in the plugin settings.`,
        cls: 'ins-no-data',
      })
      return
    }

    this.renderToolbar(contentEl, m)
    this.renderFilters(contentEl, m)
    if (this.insCustomizing) this.renderHiddenTray(contentEl, m)

    if (m.entries.length === 0) {
      contentEl.createDiv('ins-empty').createDiv('ins-card').createEl('p', {
        text: 'No entries match. Try a longer range or remove a filter.',
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
    const layout = layoutColumns(cards, this.settings.cardColumns ?? {}, this.settings.cardOrder ?? [])
    this.renderColumn(left, 'left', layout, cards)
    this.renderColumn(right, 'right', layout, cards)
    if (this.insCustomizing) this.enableDragging(left, right)

    contentEl.scrollTop = scrollTop
  }

  // ─── Header, toolbar, filters ───────────────────────────────────────────────

  private renderHeader(parent: HTMLElement, m: Model) {
    const root = parent.createDiv('ins-header')
    root.createDiv({ text: `#${this.settings.tag} · ${entriesText(m.entries.length)}`, cls: 'ins-header-count' })
    const tabs = root.createDiv('ins-header-tabs')
    for (const range of RANGES) {
      const active = range.id === this.settings.range
      const btn = tabs.createEl('button', { text: range.label, cls: 'ins-header-tab' + (active ? ' is-active' : '') })
      if (!active) btn.addEventListener('click', () => this.update(() => { this.settings.range = range.id }))
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

  /** Track (what the bars are split by), compare with (the groups), % or counts. */
  private renderToolbar(parent: HTMLElement, m: Model) {
    const bar = parent.createDiv('ins-toolbar')

    const trackGroup = bar.createDiv('ins-toolbar-group')
    trackGroup.createSpan({ text: 'Track', cls: 'ins-toolbar-label' })
    const dropdown = new DropdownComponent(trackGroup)
    for (const d of m.dims) dropdown.addOption(d.id, d.name)
    dropdown.setValue(m.tracked)
    dropdown.onChange((id) => this.update(() => {
      this.settings.tracked = id
      // The old tracked dimension is a natural thing to compare with
      const old = m.tracked
      if (!this.settings.compare.includes(old)) this.settings.compare = [old, ...this.settings.compare]
    }))

    const compareGroup = bar.createDiv('ins-toolbar-group ins-compare')
    compareGroup.createSpan({ text: 'Compare with', cls: 'ins-toolbar-label' })
    for (const d of m.dims) {
      if (d.id === m.tracked) continue
      const on = this.settings.compare.includes(d.id)
      const chip = compareGroup.createEl('button', {
        text: d.name,
        cls: 'ins-toggle' + (on ? ' is-active' : '') + (d.id.startsWith('@') ? ' is-builtin' : ''),
        attr: { 'aria-pressed': String(on) },
      })
      chip.addEventListener('click', () => this.update(() => {
        this.settings.compare = on
          ? this.settings.compare.filter(id => id !== d.id)
          : [...this.settings.compare, d.id]
      }))
    }

    const modeGroup = bar.createDiv('ins-toolbar-group')
    modeGroup.createSpan({ text: 'Bars', cls: 'ins-toolbar-label' })
    const seg = modeGroup.createDiv('ins-segmented')
    for (const [mode, label] of [['percent', '%'], ['count', 'Count']] as const) {
      const active = this.settings.valueMode === mode
      const btn = seg.createEl('button', { text: label, cls: active ? 'is-active' : '' })
      if (!active) btn.addEventListener('click', () => this.update(() => { this.settings.valueMode = mode }))
    }
  }

  private renderFilters(parent: HTMLElement, m: Model) {
    const bar = parent.createDiv('ins-filters')
    bar.createSpan({ text: 'Filters', cls: 'ins-toolbar-label' })
    const filters = this.settings.filters ?? []
    if (filters.length === 0) bar.createSpan({ text: 'Click a pie slice or bar to filter', cls: 'ins-filters-hint' })
    for (const f of filters) {
      const chip = bar.createSpan('ins-filter-chip')
      chip.createSpan({ text: `${this.dimName(m.dims, f.dim)}: `, cls: 'ins-filter-dim' })
      chip.createSpan({ text: f.label })
      const remove = chip.createEl('button', { cls: 'ins-filter-remove', attr: { 'aria-label': 'Remove filter' } })
      setIcon(remove, 'x')
      remove.addEventListener('click', () => this.update(() => {
        this.settings.filters = this.settings.filters.filter(x => x !== f)
      }))
    }

    const add = bar.createEl('button', { cls: 'ins-link-btn' })
    setIcon(add.createSpan(), 'plus')
    add.createSpan({ text: 'Add filter' })
    add.addEventListener('click', (ev) => this.openFilterMenu(ev, m))

    if (filters.length > 0) {
      const searchable = filters.some(f => !f.dim.startsWith('@'))
      if (searchable) {
        const search = bar.createEl('button', { text: 'Search these notes', cls: 'ins-link-btn' })
        search.addEventListener('click', () => this.searchFiltered(m))
      }
      const clear = bar.createEl('button', { text: 'Clear', cls: 'ins-link-btn' })
      clear.addEventListener('click', () => this.update(() => { this.settings.filters = [] }))
    }
  }

  /** Two steps: pick a property, then one of its values (with entry counts). */
  private openFilterMenu(ev: MouseEvent, m: Model) {
    const pos = { x: ev.clientX, y: ev.clientY }
    const inRange = entriesSince(m.all, this.since())
    const menu = new Menu()
    for (const d of m.dims) {
      menu.addItem(item => item.setTitle(d.name).onClick(() => {
        const values = countValues(applyFilters(inRange, this.settings.filters.filter(f => f.dim !== d.id)), e => valuesOf(e, d.id))
        const order = orderValues(values, d.id)
        const valueMenu = new Menu()
        for (const key of order) {
          const v = values.find(x => x.key === key)!
          valueMenu.addItem(i => i.setTitle(`${v.label} (${v.count})`).onClick(() => this.addFilter(d.id, v.key, v.label)))
        }
        if (order.length === 0) valueMenu.addItem(i => i.setTitle('No values').setDisabled(true))
        valueMenu.showAtPosition(pos)
      }))
    }
    menu.showAtPosition(pos)
  }

  /** One filter per dimension: a new value replaces the old one. */
  private addFilter(dim: string, value: string, label: string) {
    this.update(() => {
      this.settings.filters = [...this.settings.filters.filter(f => f.dim !== dim), { dim, value, label } satisfies Filter]
    })
  }

  // ─── Cards ──────────────────────────────────────────────────────────────────

  private leftCards(m: Model): { id: string; name: string; draw: (card: HTMLElement) => void }[] {
    const tracked = m.trackedName.toLowerCase()
    const cards = [
      { id: 'links', name: `What goes with your ${tracked}`, draw: (c: HTMLElement) => this.drawLinks(c, m) },
      { id: 'trend', name: sentence(`${tracked} by month`), draw: (c: HTMLElement) => this.drawTrendCard(c, m) },
      ...m.compare.map(dim => ({
        id: `split:${dim}`,
        name: sentence(`${tracked} by ${this.dimName(m.dims, dim).toLowerCase()}`),
        draw: (c: HTMLElement) => this.drawSplit(c, m, dim),
      })),
    ]
    return cards
  }

  private rightCards(m: Model): { id: string; name: string; draw: (card: HTMLElement) => void }[] {
    return [m.tracked, ...m.compare.filter(d => !d.startsWith('@'))].map(dim => ({
      id: `pie:${dim}`,
      name: this.dimName(m.dims, dim),
      draw: (c: HTMLElement) => this.drawPieCard(c, m, dim),
    }))
  }

  private renderColumn(
    parent: HTMLElement,
    column: Column,
    layout: Record<Column, string[]>,
    cards: { id: string; name: string; draw: (card: HTMLElement) => void }[],
  ) {
    const ids = layout[column]
    const visible = ids.filter(id => !this.isHidden(id))
    for (const id of visible) {
      const card = cards.find(c => c.id === id)!
      const el = this.card(parent, card.name, id)
      if (this.insCustomizing) {
        const title = el.querySelector<HTMLElement>('.ins-card-title')
        if (title) {
          const handle = createDiv({ cls: 'ins-drag-handle', attr: { 'aria-label': 'Drag to move' } })
          setIcon(handle, 'grip-vertical')
          title.prepend(handle)
          const controls = title.createDiv('ins-card-controls')
          const other: Column = column === 'left' ? 'right' : 'left'
          this.iconButton(controls, 'arrow-up', 'Move up', visible.indexOf(id) === 0,
            () => this.update(() => { this.settings.cardOrder = moveCard(ids, visible, id, -1, this.settings.cardOrder) }))
          this.iconButton(controls, 'arrow-down', 'Move down', visible.indexOf(id) === visible.length - 1,
            () => this.update(() => { this.settings.cardOrder = moveCard(ids, visible, id, 1, this.settings.cardOrder) }))
          this.iconButton(controls, column === 'left' ? 'arrow-right-to-line' : 'arrow-left-to-line',
            `Move to the ${other} column`, false,
            () => this.update(() => {
              this.settings.cardColumns = { ...this.settings.cardColumns, [id]: other }
              // No saved position: it goes to the bottom of the other column
              this.settings.cardOrder = this.settings.cardOrder.filter(x => x !== id)
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
          this.settings.cardColumns ?? {}, this.settings.cardOrder ?? [])
        this.update(() => {
          this.settings.cardColumns = columns
          this.settings.cardOrder = order
        })
      },
    }
    this.sortables.push(Sortable.create(left, options), Sortable.create(right, options))
  }

  private isHidden(id: string): boolean {
    return (this.settings.hiddenCards ?? []).includes(id)
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
      () => this.update(() => { this.settings.hiddenCards = [...this.settings.hiddenCards, id] }))
  }

  /** In customize mode: the hidden cards and tiles, click to show again. */
  private renderHiddenTray(parent: HTMLElement, m: Model) {
    const tray = parent.createDiv('ins-hidden-tray')
    tray.createSpan({ text: 'Hidden', cls: 'ins-toolbar-label' })
    const names = new Map<string, string>([
      ...TILES.map(t => [t.id, t.name] as [string, string]),
      ['recent', 'Recent entries'],
      ...[...this.leftCards(m), ...this.rightCards(m)].map(c => [c.id, c.name] as [string, string]),
    ])
    const hidden = (this.settings.hiddenCards ?? []).filter(id => names.has(id))
    if (hidden.length === 0) {
      tray.createSpan({ text: 'Nothing hidden. Use the eye on a card or tile to hide it, and the arrows to move cards.', cls: 'ins-filters-hint' })
      return
    }
    for (const id of hidden) {
      const chip = tray.createEl('button', { cls: 'ins-toggle', attr: { 'aria-label': 'Show again' } })
      setIcon(chip.createSpan(), 'eye')
      chip.createSpan({ text: names.get(id) ?? id })
      chip.addEventListener('click', () => this.update(() => {
        this.settings.hiddenCards = this.settings.hiddenCards.filter(x => x !== id)
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
        value('Entries', String(entries.length), `${Math.min(100, Math.round((days / spanDays) * 100))}% of days`)
      } else if (tile.id === 'tile:current-streak') {
        value('Current streak', dayCount(current))
      } else if (tile.id === 'tile:longest-streak') {
        value('Longest streak', dayCount(longest))
      } else {
        const top = m.trackedTally[0]
        const withValue = entries.filter(e => valuesOf(e, m.tracked).length > 0).length
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
    head.createSpan({ text: 'Recent entries' })
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
      for (const v of valuesOf(e, m.tracked)) this.chip(top, v.label, colorOf.get(v.key))
      if (!e.title.includes(date)) row.createDiv({ text: e.title, cls: 'ins-row-title' })
      const details = m.compare.filter(d => !d.startsWith('@')).flatMap(d => valuesOf(e, d).map(v => v.label))
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
      text: `Groups where one ${tracked} value shows up clearly more often than usual (3 or more entries). Click one to filter by it.`,
      cls: 'ins-hint',
    })
    const overall = overallBreakdown(m.entries, m.tracked, 'All entries')
    const links: Link[] = findLinks(m.compare.map(dim => ({
      id: dim,
      name: this.dimName(m.dims, dim),
      groups: breakdownByDimension(m.entries, dim, m.tracked),
    })), overall)
    if (links.length === 0) {
      card.createEl('p', { text: 'Nothing stands out yet. Compare with more properties, or check back after a few more entries.', cls: 'ins-no-data' })
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
      card.createEl('p', { text: `No entries in this period have a ${m.trackedName} value.`, cls: 'ins-no-data' })
      return
    }
    this.legend(card, m.series)
    const now = yearMonthOf(new Date())
    let count = this.rangeMonths()
    if (count === null) {
      const first = m.all.length ? yearMonthOf(m.all[m.all.length - 1].date) : now
      const [fy, fm] = first.split('-').map(Number)
      const [ny, nm] = now.split('-').map(Number)
      count = Math.min(MAX_TREND_MONTHS, Math.max(1, (ny - fy) * 12 + (nm - fm) + 1))
    }
    const byMonth = new Map(breakdownByGroup(m.entries,
      e => [{ key: yearMonthOf(e.date), label: '' }], e => valuesOf(e, m.tracked)).map(g => [g.key, g]))
    const months = getMonthRangeEndingAt(now, count).map(ym => ({
      label: formatMonth(ym),
      tooltip: formatMonth(ym, true),
      mix: byMonth.get(ym)?.mix ?? new Map<string, number>(),
      entries: byMonth.get(ym)?.entries ?? 0,
    }))
    this.charts.push(drawTrend(card.createDiv('ins-chart-wrap'), months, m.series))
  }

  private drawSplit(card: HTMLElement, m: Model, dim: string) {
    const groups: Breakdown[] = breakdownByDimension(m.entries, dim, m.tracked)
    if (groups.length === 0 || m.series.length === 0) {
      card.createEl('p', { text: 'No data in this period', cls: 'ins-no-data' })
      return
    }
    this.legend(card, m.series)
    const mode = this.settings.valueMode ?? 'percent'
    // Date groups are few and in order: upright columns, like the month chart
    if (builtinDimension(dim)) {
      // In % mode an "All" column first gives the usual mix to compare with
      const columns = mode === 'percent' ? [overallBreakdown(m.entries, m.tracked, 'All'), ...groups] : groups
      const chart = drawTrend(card.createDiv('ins-chart-wrap ins-columns-wrap'),
        columns.map(g => ({ label: g.label, tooltip: g.label === 'All' ? 'All entries' : g.label, mix: g.mix, entries: g.entries })),
        m.series,
        { mode, onColumnClick: (i) => { if (columns[i].key !== '__all__') this.addFilter(dim, columns[i].key, columns[i].label) } })
      this.charts.push(chart)
      return
    }
    const rows = [overallBreakdown(m.entries, m.tracked, 'All entries'), ...groups.slice(0, MAX_GROUPS)]
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
    const labels = new Map(tally.map(v => [v.key, v.label]))
    const isTracked = dim === m.tracked
    const order = isTracked ? m.series.map(s => s.key) : orderValues(tally, dim)
    const counts = new Map(order.map(key => [key, tally.find(v => v.key === key)?.count ?? 0]))
    const colorOf = new Map(m.series.map(s => [s.key, s.color]))
    this.charts.push(drawPie(card, counts,
      (key) => { if (key) this.addFilter(dim, key, labels.get(key) ?? key) },
      (key) => labels.get(key) ?? key,
      isTracked ? (key) => colorOf.get(key) : undefined))
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

  /** Opens Obsidian search for the tagged notes matching the property filters. */
  private searchFiltered(m: Model) {
    const quote = (s: string) => /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
    const parts = [`tag:#${this.settings.tag}`]
    for (const f of this.settings.filters) {
      if (f.dim.startsWith('@')) continue
      parts.push(`[${quote(this.dimName(m.dims, f.dim))}:${quote(f.label)}]`)
    }
    const search = (this.app as unknown as {
      internalPlugins?: { getPluginById(id: string): { instance?: { openGlobalSearch?(q: string): void } } | null }
    }).internalPlugins?.getPluginById('global-search')?.instance
    search?.openGlobalSearch?.(parts.join(' '))
  }
}

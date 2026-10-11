import { App, MarkdownRenderChild, debounce } from 'obsidian'
import type { InsightsSettings } from '../settings'
import { EmbedSpec, notesText, parseEmbed, resolveDimension } from '../embed'
import { sourceLabel } from '../journal'
import { CardDrawer, RANGES, buildModel, dimName, rangeMonths, sentence } from './cards'
import { entriesText } from './journalCharts'

export const EMBED_BLOCK = 'insights'

/** An `insights` block: one dashboard card, drawn live from the notes it names. */
export class EmbedBlock extends MarkdownRenderChild {
  private insDrawer: CardDrawer | null = null
  private readonly insRefresh = debounce(() => this.insRender(), 2000, true)

  constructor(
    containerEl: HTMLElement,
    private readonly app: App,
    private readonly source: string,
    private readonly settings: () => InsightsSettings,
  ) {
    super(containerEl)
  }

  onload() {
    this.insRender()
    // Redraw when notes change (debounced: typing elsewhere shouldn't redraw constantly)
    this.registerEvent(this.app.metadataCache.on('changed', () => this.insRefresh()))
    this.registerEvent(this.app.vault.on('delete', () => this.insRefresh()))
    this.registerEvent(this.app.vault.on('rename', () => this.insRefresh()))
    this.registerEvent(this.app.workspace.on('css-change', () => this.insRender()))
  }

  onunload() {
    this.insRefresh.cancel()
    this.insDrawer?.charts.forEach(c => c.destroy())
  }

  private insRender() {
    this.insDrawer?.charts.forEach(c => c.destroy())
    this.insDrawer = null
    const el = this.containerEl
    el.empty()
    const spec = parseEmbed(this.source)
    const card = el.createDiv('ins-card ins-embed')
    if (spec.errors.length) {
      this.insProblem(card, spec.errors)
      return
    }
    this.insDraw(card, spec)
  }

  private insDraw(card: HTMLElement, spec: EmbedSpec) {
    const settings = this.settings()
    const source = spec.notes!
    // Colors chosen on a dashboard for the same notes apply here too
    const dash = settings.dashboards.find(d => notesText(d.source) === notesText(source))
    const valueColors = dash?.valueColors ?? {}
    const tracked = spec.show === 'count' ? spec.of : spec.track
    const m = buildModel(this.app, {
      source,
      dateProperty: settings.dateProperty,
      ignoredProperties: settings.ignoredProperties,
      tracked,
      compare: spec.show === 'links' ? spec.compare : [],
      filters: spec.filters.map(f => ({ dim: f.dim, value: f.value, label: f.value })),
      range: spec.range,
      valueColors,
      byName: true,
    })
    const of = spec.of ? resolveDimension(m.dims, spec.of)?.id ?? '' : ''
    const problems = [...m.unresolved.map(n => `No property "${n}" in ${sourceLabel(source)}`)]
    if (spec.show === 'breakdown' && !of) problems.push(`No property "${spec.of}" in ${sourceLabel(source)}`)
    if (spec.show !== 'count' && !spec.track) problems.push(`"show: ${spec.show}" needs "track: …"`)
    if (m.all.length === 0) problems.push(`No notes found for ${sourceLabel(source)}`)
    if (problems.length) {
      this.insProblem(card, problems)
      return
    }

    const trackedName = m.trackedName.toLowerCase()
    const title = spec.title || (
      spec.show === 'count' ? m.trackedName
        : spec.show === 'breakdown' ? sentence(`${trackedName} by ${dimName(m.dims, of).toLowerCase()}`)
          : spec.show === 'trend' ? sentence(`${trackedName} over time`)
            : `What goes with your ${trackedName}`)
    card.createDiv('ins-card-title').createSpan({ text: title })

    const drawer = new CardDrawer({ valueMode: spec.bars, rangeMonths: rangeMonths(spec.range), valueColors })
    this.insDrawer = drawer
    if (spec.show === 'count') drawer.drawPieCard(card, m, m.tracked, spec.min)
    else if (spec.show === 'breakdown') {
      if (of.startsWith('@')) card.addClass('ins-embed-columns')
      drawer.drawSplit(card, m, of, spec.min)
    } else if (spec.show === 'trend') drawer.drawTrendCard(card, m)
    else drawer.drawLinks(card, m, spec.min)

    // Where the numbers come from
    const range = RANGES.find(r => r.id === spec.range)?.label ?? ''
    const filters = spec.filters.map(f => `${f.dim} = ${f.value}`)
    if (spec.min > 1 && spec.show !== 'trend') filters.push(`at least ${spec.min} notes each`)
    card.createDiv({
      text: [sourceLabel(source), range === 'All' ? 'all time' : `last ${range}`, entriesText(m.entries.length), ...filters].join(' · '),
      cls: 'ins-embed-source',
    })
  }

  private insProblem(card: HTMLElement, problems: string[]) {
    card.addClass('ins-embed-problem')
    card.createDiv({ text: 'Insights embed', cls: 'ins-card-title' })
    const list = card.createEl('ul')
    for (const p of problems) list.createEl('li', { text: p })
    card.createDiv({ text: 'Tip: use "Copy as embed" on a dashboard card to get a working block.', cls: 'ins-hint' })
  }
}

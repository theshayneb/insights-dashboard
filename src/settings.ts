import { App, Modal, Notice, PluginSettingTab, Setting, getAllTags } from 'obsidian'
import type InsightsDashboardPlugin from './main'
import { type Column, type Filter, type Source, sourceLabel } from './journal'

export type Range = '3m' | '6m' | '12m' | 'all'
export type ValueMode = 'percent' | 'count'

/** One question on a dashboard, as a tab: what it tracks and compares, its filters and card layout. */
export interface Tab {
  id: string
  name: string                 // '' = named after what it tracks
  tracked: string              // dimension id charted against the others (e.g. "mood"); '' = most used
  compare: string[] | null     // dimension ids it is compared with; null = picked automatically
  filters: Filter[]
  hiddenCards: string[]
  cardOrder: string[]
  cardColumns: Record<string, Column>  // cards moved to the other column
}

/** One dashboard: which notes it reads, its tabs, and choices shared by its tabs. */
export interface Dashboard {
  id: string
  source: Source
  tabs: Tab[]
  activeTab: string            // id
  range: Range
  valueMode: ValueMode         // breakdown bars as % of each group or as note counts
  valueColors: Record<string, Record<string, string>>  // dimension id → value key → color; chosen values come first
}

const TAB_FIELDS = ['tracked', 'compare', 'filters', 'hiddenCards', 'cardOrder', 'cardColumns'] as const

export function newTab(tracked = '', compare: string[] | null = null): Tab {
  return {
    id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    name: '',
    tracked,
    compare,
    filters: [],
    // Streaks mostly make sense for journals
    hiddenCards: ['tile:current-streak', 'tile:longest-streak'],
    cardOrder: [],
    cardColumns: {},
  }
}

export interface InsightsSettings {
  dateProperty: string         // frontmatter date; falls back to a date in the file name
  ignoredProperties: string[]  // properties never offered on a dashboard (lower case)
  dashboards: Dashboard[]
  activeDashboard: string      // id
  pennyWalletFolder: string    // PennyWallet's month files; '' = PennyWallet Mod's own setting
}

const JOURNAL_TAB: Tab = {
  id: 'mood',
  name: '',
  tracked: 'mood',
  compare: ['activities', 'weather', '@weekday', '@season'],
  filters: [],
  hiddenCards: [],
  cardOrder: [],
  cardColumns: {},
}

const JOURNAL_DASHBOARD: Dashboard = {
  id: 'journal',
  source: { kind: 'tag', value: 'journal_entry' },
  tabs: [JOURNAL_TAB],
  activeTab: 'mood',
  range: '12m',
  valueMode: 'percent',
  valueColors: {
    mood: { great: '#2EAD6B', good: '#F2CB3A', okay: '#F0901E', bad: '#F08A8A' },
  },
}

export const DEFAULT_SETTINGS: InsightsSettings = {
  dateProperty: 'date',
  ignoredProperties: ['tags', 'aliases', 'cssclasses'],
  dashboards: [JOURNAL_DASHBOARD],
  activeDashboard: 'journal',
  pennyWalletFolder: '',
}

/** A new dashboard, with one tab that tracks its most used property and compares with what's picked automatically. */
export function newDashboard(source: Source): Dashboard {
  const tab = newTab()
  return {
    id: `d${Date.now().toString(36)}`,
    source,
    tabs: [tab],
    activeTab: tab.id,
    range: 'all',
    valueMode: 'percent',
    valueColors: {},
  }
}

/** A saved dashboard, filled in; 0.0.5–0.0.6 dashboards had one question's fields on themselves. */
function readDashboard(raw: Record<string, unknown>): Dashboard {
  const dash = { ...JOURNAL_DASHBOARD, ...raw } as Dashboard
  if (!Array.isArray(raw['tabs'])) {
    const tab: Tab = { ...JOURNAL_TAB, id: 'main' }
    for (const key of TAB_FIELDS) if (key in raw) (tab as unknown as Record<string, unknown>)[key] = raw[key]
    dash.tabs = [tab]
    for (const key of TAB_FIELDS) delete (dash as unknown as Record<string, unknown>)[key]
  } else {
    dash.tabs = (raw['tabs'] as Partial<Tab>[]).map(t => ({ ...JOURNAL_TAB, ...t }))
  }
  if (dash.tabs.length === 0) dash.tabs = [newTab()]
  if (!dash.tabs.some(t => t.id === dash.activeTab)) dash.activeTab = dash.tabs[0].id
  return dash
}

/**
 * Settings from data.json, with defaults for anything missing. Older versions
 * had one journal dashboard in the top level (0.0.2–0.0.4) or mood settings (0.0.1).
 */
export function migrateSettings(data: Record<string, unknown> | null): InsightsSettings {
  const d = data ?? {}
  const settings: InsightsSettings = {
    dateProperty: typeof d['dateProperty'] === 'string' ? d['dateProperty'] : DEFAULT_SETTINGS.dateProperty,
    ignoredProperties: Array.isArray(d['ignoredProperties']) ? d['ignoredProperties'] as string[] : DEFAULT_SETTINGS.ignoredProperties,
    dashboards: Array.isArray(d['dashboards']) ? (d['dashboards'] as Record<string, unknown>[]).map(readDashboard) : [],
    activeDashboard: typeof d['activeDashboard'] === 'string' ? d['activeDashboard'] : '',
    pennyWalletFolder: typeof d['pennyWalletFolder'] === 'string' ? d['pennyWalletFolder'] : '',
  }
  if (!Array.isArray(d['dashboards'])) {
    // 0.0.1–0.0.4: one journal dashboard in the top level
    const raw: Record<string, unknown> = {}
    for (const key of [...TAB_FIELDS, 'range', 'valueMode', 'valueColors']) if (key in d) raw[key] = d[key]
    if (typeof d['tag'] === 'string') raw['source'] = { kind: 'tag', value: d['tag'] }
    if (typeof d['moodProperty'] === 'string' && !('tracked' in d)) {
      raw['tracked'] = d['moodProperty'].toLowerCase()
      const factors = Array.isArray(d['factorProperties']) ? d['factorProperties'] as string[] : []
      raw['compare'] = [...factors.map(f => f.toLowerCase()), '@weekday', '@season']
    }
    settings.dashboards = [readDashboard(raw)]
  }
  if (settings.dashboards.length === 0) settings.dashboards = [readDashboard({})]
  if (!settings.dashboards.some(x => x.id === settings.activeDashboard)) settings.activeDashboard = settings.dashboards[0].id
  return settings
}

/** Asks for a line of text, e.g. a tab name. */
export class TextPromptModal extends Modal {
  constructor(app: App, private readonly title: string, private readonly value: string, private readonly onDone: (value: string) => void) {
    super(app)
  }

  onOpen() {
    this.setTitle(this.title)
    let value = this.value
    const done = () => { this.close(); this.onDone(value.trim()) }
    new Setting(this.contentEl).addText(text => {
      text.setValue(value).onChange(v => { value = v })
      text.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done() } })
      window.setTimeout(() => text.inputEl.select(), 0)
    })
    new Setting(this.contentEl).addButton(btn => btn.setButtonText('Save').setCta().onClick(done))
  }

  onClose() {
    this.contentEl.empty()
  }
}

/** Asks where a new dashboard's notes come from: a tag, a folder or all notes. */
export class NewDashboardModal extends Modal {
  constructor(app: App, private readonly onDone: (source: Source) => void) {
    super(app)
  }

  onOpen() {
    const { contentEl } = this
    this.setTitle('New dashboard')
    let kind: Source['kind'] = 'tag'
    let value = ''
    const valueSetting = new Setting(contentEl)

    const listId = `ins-suggest-${Date.now()}`
    const datalist = contentEl.createEl('datalist', { attr: { id: listId } })
    const fillSuggestions = () => {
      datalist.empty()
      const options = kind === 'tag' ? this.vaultTags() : kind === 'folder' ? this.vaultFolders() : []
      for (const o of options) datalist.createEl('option', { attr: { value: o } })
    }

    new Setting(contentEl)
      .setName('Notes')
      .setDesc('Which notes the dashboard reads. For outfits: with the tag "outfit", then track their rating and compare with their wardrobe items.')
      .addDropdown(dd => dd
        .addOption('tag', 'With a tag')
        .addOption('folder', 'In a folder')
        .addOption('all', 'All notes')
        .setValue(kind)
        .onChange((v) => {
          kind = v as Source['kind']
          valueSetting.settingEl.toggle(kind !== 'all')
          valueSetting.setName(kind === 'tag' ? 'Tag' : 'Folder')
          fillSuggestions()
        }))
    contentEl.appendChild(valueSetting.settingEl)  // keep it under the "Notes" choice
    valueSetting.setName('Tag').addText(text => {
      text.onChange(v => { value = v.trim().replace(/^#/, '') })
      text.inputEl.setAttribute('list', listId)
    })
    fillSuggestions()

    new Setting(contentEl).addButton(btn => btn.setButtonText('Create').setCta().onClick(() => {
      if (kind !== 'all' && !value) {
        new Notice(kind === 'tag' ? 'Type the tag first.' : 'Type the folder first.')
        return
      }
      this.close()
      this.onDone({ kind, value: kind === 'all' ? '' : value })
    }))
  }

  private vaultTags(): string[] {
    const counts = new Map<string, number>()
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file)
      for (const t of cache ? getAllTags(cache) ?? [] : []) {
        const tag = t.replace(/^#/, '')
        if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }

  private vaultFolders(): string[] {
    const folders = new Set<string>()
    for (const file of this.app.vault.getMarkdownFiles()) {
      const parts = file.path.split('/').slice(0, -1)
      for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'))
    }
    return [...folders].sort()
  }

  onClose() {
    this.contentEl.empty()
  }
}

export class InsightsSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: InsightsDashboardPlugin) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    const settings = this.plugin.settings

    containerEl.createEl('p', {
      text: 'What each dashboard tracks, compares and shows is chosen on the dashboard itself.',
      cls: 'setting-item-description',
    })

    new Setting(containerEl).setName('Dashboards').setHeading()
    for (const dash of settings.dashboards) {
      new Setting(containerEl)
        .setName(sourceLabel(dash.source))
        .setDesc(`${dash.tabs.length === 1 ? '1 tab' : `${dash.tabs.length} tabs`}`)
        .addButton(btn => btn.setButtonText('Reset layout').setTooltip('In every tab: show every card again in its default column and order, and clear the filters.').onClick(() => {
          for (const tab of dash.tabs) {
            tab.hiddenCards = []
            tab.cardOrder = []
            tab.cardColumns = {}
            tab.filters = []
          }
          void this.plugin.saveSettings()
        }))
        .addExtraButton(btn => btn.setIcon('trash').setTooltip('Remove this dashboard').setDisabled(settings.dashboards.length === 1).onClick(() => {
          settings.dashboards = settings.dashboards.filter(x => x !== dash)
          if (settings.activeDashboard === dash.id) settings.activeDashboard = settings.dashboards[0].id
          void this.plugin.saveSettings().then(() => this.display())
        }))
    }
    new Setting(containerEl).addButton(btn => btn.setButtonText('New dashboard').onClick(() => {
      new NewDashboardModal(this.app, (source) => {
        const dash = newDashboard(source)
        settings.dashboards.push(dash)
        settings.activeDashboard = dash.id
        void this.plugin.saveSettings().then(() => this.display())
      }).open()
    }))

    new Setting(containerEl).setName('All dashboards').setHeading()

    // Text settings that save when the field loses focus and redraw open dashboards
    const text = (name: string, desc: string, value: string, placeholder: string, apply: (value: string) => string) => {
      new Setting(containerEl).setName(name).setDesc(desc).addText(input => {
        input.setPlaceholder(placeholder).setValue(value)
        input.inputEl.addEventListener('change', () => {
          input.setValue(apply(input.getValue()))
          void this.plugin.saveSettings()
        })
      })
    }

    text('Date property', 'Where a note’s date comes from. Without it, a date in the file name (like 2026-10-10) is used, then the file creation date.',
      settings.dateProperty, 'date', (value) => {
        settings.dateProperty = value.trim()
        return settings.dateProperty
      })
    text('PennyWallet folder', 'Where PennyWallet keeps its month files, for the purchases block. Leave empty to use PennyWallet Mod\u2019s own setting.',
      settings.pennyWalletFolder ?? '', 'PennyWallet', (value) => {
        settings.pennyWalletFolder = value.trim().replace(/^\/+|\/+$/g, '')
        return settings.pennyWalletFolder
      })
    text('Ignored properties', 'Properties never offered on a dashboard, separated by commas (also when they come from linked notes). The date property is always left out.',
      settings.ignoredProperties.join(', '), 'tags, aliases, cssclasses', (value) => {
        settings.ignoredProperties = [...new Set(value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))]
        return settings.ignoredProperties.join(', ')
      })
  }
}

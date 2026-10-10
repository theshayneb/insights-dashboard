import { App, PluginSettingTab, Setting } from 'obsidian'
import type InsightsDashboardPlugin from './main'
import type { Column, Filter } from './journal'

export type Range = '3m' | '6m' | '12m' | 'all'
export type ValueMode = 'percent' | 'count'

export interface InsightsSettings {
  tag: string                  // notes with this tag are read
  dateProperty: string         // frontmatter date; falls back to a date in the file name
  ignoredProperties: string[]  // properties never offered on the dashboard (lower case)

  // Dashboard choices, changed on the dashboard itself
  tracked: string              // dimension id charted against the others (e.g. "mood")
  compare: string[]            // dimension ids it is compared with
  filters: Filter[]
  range: Range
  valueMode: ValueMode         // breakdown bars as % of each group or as entry counts
  hiddenCards: string[]
  cardOrder: string[]
  cardColumns: Record<string, Column>  // cards moved to the other column
  valueColors: Record<string, Record<string, string>>  // dimension id → value key → color; chosen values come first
}

export const DEFAULT_SETTINGS: InsightsSettings = {
  tag: 'journal_entry',
  dateProperty: 'date',
  ignoredProperties: ['tags', 'aliases', 'cssclasses'],
  tracked: 'mood',
  compare: ['activities', 'weather', '@weekday', '@season'],
  filters: [],
  range: '12m',
  valueMode: 'percent',
  hiddenCards: [],
  cardOrder: [],
  cardColumns: {},
  valueColors: {
    mood: { great: '#2EAD6B', good: '#F2CB3A', okay: '#F0901E', bad: '#F08A8A' },
  },
}

/** Settings from data.json, with defaults for anything missing; 0.0.1's mood settings carry over. */
export function migrateSettings(data: Record<string, unknown> | null): InsightsSettings {
  const settings: InsightsSettings = { ...DEFAULT_SETTINGS, ...(data as Partial<InsightsSettings> | null) }
  if (data && typeof data['moodProperty'] === 'string' && !('tracked' in data)) {
    settings.tracked = data['moodProperty'].toLowerCase()
    const factors = Array.isArray(data['factorProperties']) ? data['factorProperties'] as string[] : []
    settings.compare = [...factors.map(f => f.toLowerCase()), '@weekday', '@season']
  }
  delete (settings as unknown as Record<string, unknown>)['moodProperty']
  delete (settings as unknown as Record<string, unknown>)['factorProperties']
  return settings
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
      text: 'What the dashboard tracks, compares and shows is chosen on the dashboard itself.',
      cls: 'setting-item-description',
    })

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

    text('Journal tag', 'The dashboard reads the notes with this tag (in their properties or text).',
      settings.tag, 'journal_entry', (value) => {
        settings.tag = value.trim().replace(/^#/, '')
        return settings.tag
      })
    text('Date property', 'Where the entry date comes from. Without it, a date in the file name (like 2026-10-10) is used, then the file creation date.',
      settings.dateProperty, 'date', (value) => {
        settings.dateProperty = value.trim()
        return settings.dateProperty
      })
    text('Ignored properties', 'Properties never offered on the dashboard, separated by commas. The date property is always left out.',
      settings.ignoredProperties.join(', '), 'tags, aliases, cssclasses', (value) => {
        settings.ignoredProperties = [...new Set(value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))]
        return settings.ignoredProperties.join(', ')
      })

    new Setting(containerEl)
      .setName('Reset dashboard layout')
      .setDesc('Show every card again in its default column and order, and clear the filters.')
      .addButton(btn => btn.setButtonText('Reset').onClick(() => {
        settings.hiddenCards = []
        settings.cardOrder = []
        settings.cardColumns = {}
        settings.filters = []
        void this.plugin.saveSettings()
      }))
  }
}

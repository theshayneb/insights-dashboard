import { App, PluginSettingTab, Setting } from 'obsidian'
import type InsightsDashboardPlugin from './main'

export interface InsightsSettings {
  tag: string                 // notes with this tag are read
  moodProperty: string        // frontmatter property charted as the mood
  factorProperties: string[]  // properties compared with the mood
  dateProperty: string        // frontmatter date; falls back to a date in the file name
}

export const DEFAULT_SETTINGS: InsightsSettings = {
  tag: 'journal_entry',
  moodProperty: 'Mood',
  factorProperties: ['Activities', 'Weather'],
  dateProperty: 'date',
}

export class InsightsSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: InsightsDashboardPlugin) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    const settings = this.plugin.settings

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
    text('Mood property', 'The property charted as your mood. If every value is a number (e.g. 1–5), they are shown low to high.',
      settings.moodProperty, 'Mood', (value) => {
        settings.moodProperty = value.trim()
        return settings.moodProperty
      })
    text('Compare with', 'Properties to compare with your mood, separated by commas. Day of week and season are always compared.',
      settings.factorProperties.join(', '), 'Activities, Weather', (value) => {
        settings.factorProperties = [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))]
        return settings.factorProperties.join(', ')
      })
    text('Date property', 'Where the entry date comes from. Without it, a date in the file name (like 2026-10-10) is used, then the file creation date.',
      settings.dateProperty, 'date', (value) => {
        settings.dateProperty = value.trim()
        return settings.dateProperty
      })
  }
}

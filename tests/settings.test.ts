import { describe, it, expect, vi } from 'vitest'

vi.mock('obsidian', () => ({ App: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, getAllTags: () => [] }))
const { migrateSettings } = await import('../src/settings')

describe('migrateSettings', () => {
  it('turns 0.0.2–0.0.4 settings into the journal dashboard', () => {
    const s = migrateSettings({
      tag: 'journal_entry', dateProperty: 'day', tracked: 'mood', compare: ['weather'], range: 'all',
      hiddenCards: ['tile:current-streak'], valueColors: { mood: { great: '#00ff00' } },
    })
    expect(s.dateProperty).toBe('day')
    expect(s.dashboards).toHaveLength(1)
    expect(s.dashboards[0]).toMatchObject({
      source: { kind: 'tag', value: 'journal_entry' }, range: 'all', valueColors: { mood: { great: '#00ff00' } },
    })
    expect(s.dashboards[0].tabs).toHaveLength(1)
    expect(s.dashboards[0].tabs[0]).toMatchObject({ tracked: 'mood', compare: ['weather'], hiddenCards: ['tile:current-streak'] })
    expect(s.dashboards[0].activeTab).toBe(s.dashboards[0].tabs[0].id)
    expect(s.activeDashboard).toBe(s.dashboards[0].id)
  })

  it('carries over 0.0.1 mood settings', () => {
    const s = migrateSettings({ tag: 'journal_entry', moodProperty: 'Feeling', factorProperties: ['Weather'] })
    expect(s.dashboards[0].tabs[0].tracked).toBe('feeling')
    expect(s.dashboards[0].tabs[0].compare).toEqual(['weather', '@weekday', '@season'])
  })

  it('keeps saved dashboards and starts fresh with the journal one', () => {
    expect(migrateSettings(null).dashboards[0].source).toEqual({ kind: 'tag', value: 'journal_entry' })
    const s = migrateSettings({ dashboards: [{ id: 'x', source: { kind: 'folder', value: 'Outfits' } }], activeDashboard: 'x' })
    expect(s.dashboards[0]).toMatchObject({ id: 'x', source: { kind: 'folder', value: 'Outfits' } })
    expect(s.activeDashboard).toBe('x')
  })

  it('moves a 0.0.5–0.0.6 dashboard\'s question into its first tab', () => {
    const s = migrateSettings({ dashboards: [{ id: 'o', source: { kind: 'tag', value: 'outfit' }, tracked: 'rating', compare: ['@linked:wardrobe_item'], filters: [], hiddenCards: [], cardOrder: ['trend'], cardColumns: {}, range: 'all', valueMode: 'count', valueColors: {} }], activeDashboard: 'o' })
    const d = s.dashboards[0]
    expect(d).toMatchObject({ id: 'o', range: 'all', valueMode: 'count' })
    expect(d.tabs).toEqual([expect.objectContaining({ tracked: 'rating', compare: ['@linked:wardrobe_item'], cardOrder: ['trend'] })])
    expect('tracked' in d).toBe(false)
    expect(d.activeTab).toBe(d.tabs[0].id)
  })
})

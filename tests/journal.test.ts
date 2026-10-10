import { describe, it, expect } from 'vitest'
import {
  JournalEntry, breakdownByGroup, buildEntry, countValues, entriesSince, entryDate, findMoodLinks,
  getProperty, normalizeValues, orderMoods, overallBreakdown, seasonOf, streaks,
} from '../src/journal'

const settings = { moodProperty: 'Mood', factorProperties: ['Activities', 'Weather'], dateProperty: 'date' }

function entry(date: string, fm: Record<string, unknown>): JournalEntry {
  return buildEntry({ path: `${date}.md`, basename: date, ctime: 0 }, fm, settings)
}

describe('getProperty', () => {
  it('finds properties ignoring case', () => {
    expect(getProperty({ mood: 'happy' }, 'Mood')).toBe('happy')
    expect(getProperty({ Mood: 'happy' }, 'Mood')).toBe('happy')
    expect(getProperty(undefined, 'Mood')).toBeUndefined()
  })
})

describe('normalizeValues', () => {
  it('handles lists, text, numbers and empties', () => {
    expect(normalizeValues(['Gym', 'reading'])).toEqual([{ key: 'gym', label: 'Gym' }, { key: 'reading', label: 'reading' }])
    expect(normalizeValues('Sunny, warm')).toEqual([{ key: 'sunny', label: 'Sunny' }, { key: 'warm', label: 'warm' }])
    expect(normalizeValues(4)).toEqual([{ key: '4', label: '4' }])
    expect(normalizeValues(null)).toEqual([])
    expect(normalizeValues('')).toEqual([])
  })

  it('unwraps links and tags and drops repeats', () => {
    expect(normalizeValues(['[[Moods/Happy]]', '[[sad|Blue]]', '#calm', 'happy'])).toEqual([
      { key: 'happy', label: 'Happy' },
      { key: 'blue', label: 'Blue' },
      { key: 'calm', label: 'calm' },
    ])
    expect(normalizeValues('[[a, b|Both]], c').map(v => v.label)).toEqual(['Both', 'c'])
  })
})

describe('entryDate', () => {
  it('prefers the date property, then the file name, then ctime', () => {
    expect(entryDate('2026-03-04', 'x', 0)).toEqual(new Date(2026, 2, 4))
    expect(entryDate('2026-03-04T22:10', 'x', 0)).toEqual(new Date(2026, 2, 4))
    expect(entryDate(undefined, 'Journal 2025-12-31', 0)).toEqual(new Date(2025, 11, 31))
    expect(entryDate('2026-02-30', 'none', new Date(2024, 0, 2, 15).getTime())).toEqual(new Date(2024, 0, 2))
  })
})

describe('seasonOf', () => {
  it('uses meteorological seasons', () => {
    expect(seasonOf(new Date(2026, 2, 1))).toBe('spring')
    expect(seasonOf(new Date(2026, 7, 31))).toBe('summer')
    expect(seasonOf(new Date(2026, 10, 30))).toBe('autumn')
    expect(seasonOf(new Date(2026, 0, 15))).toBe('winter')
  })
})

describe('tallies', () => {
  const entries = [
    entry('2026-01-01', { Mood: 'Happy', Weather: 'Sunny', Activities: ['Gym'] }),
    entry('2026-01-02', { Mood: 'happy', Weather: 'Sunny', Activities: ['Gym', 'Reading'] }),
    entry('2026-01-03', { Mood: 'Sad', Weather: 'Rainy' }),
    entry('2026-01-05', { Mood: ['Sad', 'Tired'], Weather: 'Rainy' }),
    entry('2026-01-06', { Weather: 'Rainy' }),
  ]

  it('counts values, most common first', () => {
    expect(countValues(entries, e => e.mood).map(m => [m.label, m.count])).toEqual([['Happy', 2], ['Sad', 2], ['Tired', 1]])
    expect(countValues(entries, e => e.factors['Weather']).map(m => [m.label, m.count])).toEqual([['Rainy', 3], ['Sunny', 2]])
  })

  it('orders numeric moods low to high', () => {
    expect(orderMoods([{ key: '5', label: '5', count: 9 }, { key: '2', label: '2', count: 1 }])).toEqual(['2', '5'])
    expect(orderMoods([{ key: 'b', label: 'b', count: 9 }, { key: 'a', label: 'a', count: 1 }])).toEqual(['b', 'a'])
  })

  it('splits entries with several moods and skips entries with none', () => {
    const rainy = breakdownByGroup(entries, e => e.factors['Weather']).find(g => g.key === 'rainy')!
    expect(rainy.entries).toBe(2)
    expect(rainy.moods.get('sad')).toBe(1.5)
    expect(rainy.moods.get('tired')).toBe(0.5)
    expect(overallBreakdown(entries, 'All').entries).toBe(4)
  })

  it('finds groups with a clearly higher share of a mood', () => {
    const many = [
      ...entries,
      entry('2026-01-07', { Mood: 'Sad', Weather: 'Rainy' }),
      entry('2026-01-08', { Mood: 'Happy', Weather: 'Sunny' }),
      entry('2026-01-09', { Mood: 'Happy', Weather: 'Cloudy' }),
    ]
    const links = findMoodLinks(
      [{ name: 'Weather', groups: breakdownByGroup(many, e => e.factors['Weather']) }],
      overallBreakdown(many, 'All'),
    )
    expect(links.map(l => `${l.group}→${l.moodKey}`)).toEqual(['Rainy→sad', 'Sunny→happy'])
    expect(links[1].share).toBe(1)
    expect(links[0].baseline).toBeCloseTo(2.5 / 7)
  })

  it('filters by date and computes streaks', () => {
    expect(entriesSince(entries, new Date(2026, 0, 5))).toHaveLength(2)
    expect(streaks(entries, new Date(2026, 0, 7))).toEqual({ current: 2, longest: 3 })
    expect(streaks(entries, new Date(2026, 0, 9))).toEqual({ current: 0, longest: 3 })
  })
})

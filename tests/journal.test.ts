import { describe, it, expect } from 'vitest'
import {
  JournalEntry, LinkedNote, limitValues, applyFilters, colorValues, dimensionKind, matchesSource, sourceLabel, breakdownByDimension, breakdownByGroup, buildEntry, countValues,
  discoverProperties, entriesSince, entryDate, findLinks, getProperty, layoutAfterDrop, layoutColumns, moveCard, normalizeValues,
  orderCards, orderValues, overallBreakdown, seasonOf, streaks, valuesOf,
} from '../src/journal'

function entry(date: string, fm: Record<string, unknown>): JournalEntry {
  return buildEntry({ path: `${date}.md`, basename: date, ctime: 0 }, { date, ...fm }, 'date')
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
    expect(normalizeValues({ nested: 1 })).toEqual([])
  })

  it('unwraps links and tags and drops repeats', () => {
    expect(normalizeValues(['[[Moods/Happy]]', '[[sad|Blue]]', '#calm', 'happy'])).toEqual([
      { key: 'happy', label: 'Happy', link: 'Moods/Happy' },
      { key: 'blue', label: 'Blue', link: 'sad' },
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

describe('dimensions', () => {
  it('uses meteorological seasons', () => {
    expect(seasonOf(new Date(2026, 2, 1))).toBe('spring')
    expect(seasonOf(new Date(2026, 7, 31))).toBe('summer')
    expect(seasonOf(new Date(2026, 10, 30))).toBe('autumn')
    expect(seasonOf(new Date(2026, 0, 15))).toBe('winter')
  })

  it('reads properties ignoring case, and built-in date dimensions', () => {
    const e = entry('2026-10-10', { Mood: 'Happy', weather: 'Sunny' })  // a Saturday
    expect(valuesOf(e, 'mood')).toEqual([{ key: 'happy', label: 'Happy' }])
    expect(valuesOf(e, 'weather')).toEqual([{ key: 'sunny', label: 'Sunny' }])
    expect(valuesOf(e, '@weekday')).toEqual([{ key: '6', label: 'Sat' }])
    expect(valuesOf(e, '@season')).toEqual([{ key: 'autumn', label: 'Autumn' }])
    expect(valuesOf(e, '@month')).toEqual([{ key: '9', label: 'Oct' }])
    expect(valuesOf(e, '@year')).toEqual([{ key: '2026', label: '2026' }])
    expect(valuesOf(e, 'missing')).toEqual([])
  })

  it('discovers properties, most used first, without ignored ones', () => {
    const entries = [
      entry('2026-01-01', { Mood: 'Happy', Weather: 'Sunny', tags: ['journal_entry'] }),
      entry('2026-01-02', { mood: 'Sad', Energy: 3, tags: ['journal_entry'] }),
    ]
    expect(discoverProperties(entries, ['tags', 'date'])).toEqual([
      { id: 'mood', name: 'Mood', entries: 2 },
      { id: 'energy', name: 'Energy', entries: 1 },
      { id: 'weather', name: 'Weather', entries: 1 },
    ])
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
    expect(countValues(entries, e => valuesOf(e, 'mood')).map(m => [m.label, m.count])).toEqual([['Happy', 2], ['Sad', 2], ['Tired', 1]])
    expect(countValues(entries, e => valuesOf(e, 'weather')).map(m => [m.label, m.count])).toEqual([['Rainy', 3], ['Sunny', 2]])
  })

  it('orders values: numbers low to high, built-ins naturally, else most common first', () => {
    expect(orderValues([{ key: '5', label: '5', count: 9 }, { key: '2', label: '2', count: 1 }])).toEqual(['2', '5'])
    expect(orderValues([{ key: 'b', label: 'b', count: 9 }, { key: 'a', label: 'a', count: 1 }])).toEqual(['b', 'a'])
    expect(orderValues([{ key: '0', label: 'Sun', count: 9 }, { key: '1', label: 'Mon', count: 1 }], '@weekday')).toEqual(['1', '0'])
  })

  it('splits entries with several tracked values and skips entries with none', () => {
    const rainy = breakdownByGroup(entries, e => valuesOf(e, 'weather'), e => valuesOf(e, 'mood')).find(g => g.key === 'rainy')!
    expect(rainy.entries).toBe(2)
    expect(rainy.mix.get('sad')).toBe(1.5)
    expect(rainy.mix.get('tired')).toBe(0.5)
    expect(overallBreakdown(entries, 'mood', 'All').entries).toBe(4)
  })

  it('can track any property against any other', () => {
    const byMood = breakdownByDimension(entries, 'mood', 'weather')
    expect(byMood.map(g => [g.label, g.entries])).toEqual([['Happy', 2], ['Sad', 2], ['Tired', 1]])
    expect(byMood[0].mix.get('sunny')).toBe(2)
    const byWeekday = breakdownByDimension(entries, '@weekday', 'mood')
    expect(byWeekday.map(g => g.label)).toEqual(['Mon', 'Thu', 'Fri', 'Sat'])
  })

  it('filters entries by every filter', () => {
    expect(applyFilters(entries, [{ dim: 'weather', value: 'rainy', label: 'Rainy' }])).toHaveLength(3)
    expect(applyFilters(entries, [
      { dim: 'weather', value: 'rainy', label: 'Rainy' },
      { dim: 'mood', value: 'tired', label: 'Tired' },
    ]).map(e => e.path)).toEqual(['2026-01-05.md'])
    expect(applyFilters(entries, [{ dim: '@weekday', value: '1', label: 'Mon' }]).map(e => e.path)).toEqual(['2026-01-05.md'])
  })

  it('finds groups with a clearly higher share of a value', () => {
    const many = [
      ...entries,
      entry('2026-01-07', { Mood: 'Sad', Weather: 'Rainy' }),
      entry('2026-01-08', { Mood: 'Happy', Weather: 'Sunny' }),
      entry('2026-01-09', { Mood: 'Happy', Weather: 'Cloudy' }),
    ]
    const links = findLinks(
      [{ id: 'weather', name: 'Weather', groups: breakdownByDimension(many, 'weather', 'mood') }],
      overallBreakdown(many, 'mood', 'All'),
    )
    expect(links.map(l => `${l.group}→${l.valueKey}`)).toEqual(['Rainy→sad', 'Sunny→happy'])
    expect(links[1].share).toBe(1)
    expect(links[0].baseline).toBeCloseTo(2.5 / 7)
    expect(links[0].groupKey).toBe('rainy')
  })

  it('filters by date and computes streaks', () => {
    expect(entriesSince(entries, new Date(2026, 0, 5))).toHaveLength(2)
    expect(streaks(entries, new Date(2026, 0, 7))).toEqual({ current: 2, longest: 3 })
    expect(streaks(entries, new Date(2026, 0, 9))).toEqual({ current: 0, longest: 3 })
  })
})

describe('card order', () => {
  it('sorts by the saved order, new cards last', () => {
    expect(orderCards(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'a', 'b', 'd'])
  })

  it('moves a card past its visible neighbour', () => {
    // b is hidden, so moving c up swaps it with a
    expect(moveCard(['a', 'b', 'c'], ['a', 'c'], 'c', -1, ['x'])).toEqual(['c', 'b', 'a', 'x'])
    expect(moveCard(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 1, [])).toEqual(['b', 'a', 'c'])
    expect(moveCard(['a', 'b'], ['a', 'b'], 'a', -1, ['s'])).toEqual(['s'])  // already first
  })

  it('puts cards in their saved column, in the saved order', () => {
    const cards = [
      { id: 'links', column: 'left' as const }, { id: 'trend', column: 'left' as const },
      { id: 'pie:mood', column: 'right' as const }, { id: 'pie:weather', column: 'right' as const },
    ]
    expect(layoutColumns(cards, {}, [])).toEqual({ left: ['links', 'trend'], right: ['pie:mood', 'pie:weather'] })
    expect(layoutColumns(cards, { 'pie:weather': 'left', links: 'right' }, ['pie:weather', 'trend'])).toEqual({
      left: ['pie:weather', 'trend'],
      right: ['links', 'pie:mood'],
    })
  })

  it('saves columns and order after a drop, keeping hidden cards', () => {
    expect(layoutAfterDrop(['trend', 'pie:mood'], ['links'], { x: 'right' }, ['links', 'x', 'trend'])).toEqual({
      columns: { x: 'right', trend: 'left', 'pie:mood': 'left', links: 'right' },
      order: ['trend', 'pie:mood', 'links', 'x'],
    })
  })
})

describe('colorValues', () => {
  it('puts chosen colors first, in chosen order, and gives the rest unused palette colors', () => {
    const { order, colors } = colorValues(['okay', 'meh', 'great', 'bad'],
      { great: '#00ff00', good: '#ffff00', okay: '#ff9900', bad: '#ff8888' }, ['#ff9900', '#0000ff'])
    expect(order).toEqual(['great', 'okay', 'bad', 'meh'])
    expect(colors.get('okay')).toBe('#ff9900')
    expect(colors.get('meh')).toBe('#0000ff')  // the palette's orange is taken by "okay"
  })
})

describe('links into other notes', () => {
  const notes: Record<string, LinkedNote> = {
    'Blue Song': { name: 'Blue Song', frontmatter: { Artist: '[[Joni]]', tags: ['song'] }, tags: ['song'] },
    'Red cardigan': { name: 'Red cardigan', frontmatter: { Color: 'Red' }, tags: ['wardrobe_item'] },
    'Jeans': { name: 'Jeans', frontmatter: {}, tags: ['wardrobe_item', 'denim'] },
  }
  const links = (outgoing: string[]) => ({ resolve: (l: string) => notes[l] ?? null, outgoing })

  it('reads the linked notes\' properties through a link property', () => {
    const e = buildEntry({ path: 'j.md', basename: 'j', ctime: 0 }, { SOTD: '[[Blue Song]]' }, 'date', links(['Blue Song']))
    expect(valuesOf(e, 'sotd')).toEqual([{ key: 'blue song', label: 'Blue Song', link: 'Blue Song' }])
    expect(valuesOf(e, 'sotd>artist').map(v => v.label)).toEqual(['Joni'])
    expect(e.propNames['sotd>artist']).toBe('SOTD → Artist')
    expect(valuesOf(e, '@linked:song').map(v => v.label)).toEqual(['Blue Song'])
    // "sotd>tags" is left out when "tags" is ignored
    expect(discoverProperties([e], ['tags']).map(p => p.id)).toEqual(['sotd', '@linked:song', 'sotd>artist'])
  })

  it('groups linked notes (from properties or text) by their tags', () => {
    const e = buildEntry({ path: 'o.md', basename: 'o', ctime: 0 }, { Rating: '🩷' }, 'date',
      links(['Red cardigan', 'Jeans', 'Jeans', 'Missing note']))
    expect(valuesOf(e, '@linked:wardrobe_item').map(v => v.label)).toEqual(['Red cardigan', 'Jeans'])
    expect(valuesOf(e, '@linked:denim').map(v => v.label)).toEqual(['Jeans'])
    expect(e.propNames['@linked:wardrobe_item']).toBe('Linked #wardrobe_item')
    expect(dimensionKind('@linked:denim')).toBe('linked')
    expect(dimensionKind('sotd>artist')).toBe('linked')
    expect(dimensionKind('rating')).toBe('property')
    expect(dimensionKind('@weekday')).toBe('date')
  })
})

describe('sources', () => {
  it('matches notes by tag (nested too), folder or all', () => {
    const note = { path: 'Journal/2026/a.md', tags: ['#journal-entry/daily'] }
    expect(matchesSource({ kind: 'tag', value: 'journal_entry' }, note)).toBe(true)
    expect(matchesSource({ kind: 'tag', value: 'outfit' }, note)).toBe(false)
    expect(matchesSource({ kind: 'folder', value: 'Journal/' }, note)).toBe(true)
    expect(matchesSource({ kind: 'folder', value: 'Jour' }, note)).toBe(false)
    expect(matchesSource({ kind: 'all', value: '' }, note)).toBe(true)
    expect(sourceLabel({ kind: 'folder', value: 'Journal' })).toBe('Journal/')
    expect(sourceLabel({ kind: 'tag', value: 'outfit' })).toBe('#outfit')
  })
})

describe('limitValues', () => {
  it('keeps chosen-color values and the most common ones', () => {
    const tally = [{ key: 'a', label: 'a', count: 1 }, { key: 'b', label: 'b', count: 9 }, { key: 'c', label: 'c', count: 5 }, { key: 'd', label: 'd', count: 7 }]
    expect([...limitValues(['a', 'b', 'c', 'd'], tally, { a: '#000000' }, 3)]).toEqual(['a', 'b', 'd'])
    expect([...limitValues(['a', 'b'], tally, {}, 3)]).toEqual(['a', 'b'])
  })
})

describe('colorValues with emoji', () => {
  it('matches chosen colors by their words, in the chosen order', () => {
    const { order, colors } = colorValues(['😊 good', '😐 okay', '😄 great', '☹️ bad'],
      { great: '#00ff00', good: '#ffff00', okay: '#ff9900', bad: '#ff8888' }, ['#123456'])
    expect(order).toEqual(['😄 great', '😊 good', '😐 okay', '☹️ bad'])
    expect(colors.get('😐 okay')).toBe('#ff9900')
  })
})

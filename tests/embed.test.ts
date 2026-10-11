import { describe, it, expect } from 'vitest'
import { parseEmbed, parseNotes, resolveDimension, writeEmbed } from '../src/embed'

describe('parseEmbed', () => {
  it('reads every option', () => {
    const spec = parseEmbed([
      'notes: #journal_entry', 'show: breakdown', 'of: Related -> #song', 'track: Mood',
      'filter: Weather = Rainy', 'filter: Day of week = Mon', 'range: 12 months', 'bars: count', 'min: 3', 'title: Songs and moods',
    ].join('\n'))
    expect(spec).toMatchObject({
      notes: { kind: 'tag', value: 'journal_entry' }, show: 'breakdown', of: 'Related -> #song', track: 'Mood',
      filters: [{ dim: 'Weather', value: 'Rainy' }, { dim: 'Day of week', value: 'Mon' }],
      range: '12m', bars: 'count', min: 3, title: 'Songs and moods', errors: [],
    })
  })

  it('explains what is missing or wrong', () => {
    expect(parseEmbed('show: count').errors).toEqual(['Say which notes, e.g. "notes: #journal_entry"', '"show: count" needs "of: …"'])
    expect(parseEmbed('notes: all\nshow: pie\ncolour: red\nhello').errors).toEqual([
      '"show" is one of: count, breakdown, trend, links', 'Unknown option "colour"', 'Not understood: "hello"',
      '"show: count" needs "of: …"',
    ])
  })

  it('reads tags, folders and all', () => {
    expect(parseNotes('#outfit')).toEqual({ kind: 'tag', value: 'outfit' })
    expect(parseNotes('Journal/2026/')).toEqual({ kind: 'folder', value: 'Journal/2026' })
    expect(parseNotes('ALL')).toEqual({ kind: 'all', value: '' })
  })

  it('round-trips what the dashboard writes', () => {
    const text = writeEmbed({
      notes: { kind: 'tag', value: 'journal_entry' }, show: 'links', of: '', track: 'Mood', compare: ['Weather', 'Linked #tea'],
      filters: [], range: '12m', bars: 'percent', min: 4, title: '',
    })
    expect(text).toBe('notes: #journal_entry\nshow: links\ntrack: Mood\ncompare: Weather, Linked #tea\nrange: 12 months\nmin: 4')
    expect(parseEmbed(text)).toMatchObject({ show: 'links', track: 'Mood', compare: ['Weather', 'Linked #tea'], range: '12m', min: 4, errors: [] })
    expect(parseEmbed('notes: all\nshow: trend\ntrack: Mood\nmin: lots').errors).toEqual(['"min" is a whole number, e.g. "min: 3"'])
  })
})

describe('resolveDimension', () => {
  const dims = [{ id: 'related#song', name: 'Related → #song' }, { id: '@weekday', name: 'Day of week' }, { id: 'mood', name: 'Mood' }]
  it('matches names in any case, with -> for →, or ids', () => {
    expect(resolveDimension(dims, 'related -> #song')?.id).toBe('related#song')
    expect(resolveDimension(dims, 'day of week')?.id).toBe('@weekday')
    expect(resolveDimension(dims, '@weekday')?.id).toBe('@weekday')
    expect(resolveDimension(dims, 'Energy')).toBeUndefined()
  })
})

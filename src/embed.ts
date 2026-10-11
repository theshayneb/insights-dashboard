// The `insights` code block: one dashboard card in any note. Its text is
// "key: value" lines, written by the dashboard's "Copy as embed" and editable by
// hand. No Obsidian imports, so it is unit-testable.
//
//   notes: #journal_entry        (a tag, a folder ending in "/", or "all")
//   show: count                  (count, breakdown, trend or links)
//   of: Related → #song          (count: what to count; breakdown: the groups)
//   track: Mood                  (breakdown, trend, links: what the bars are split by)
//   compare: Weather, Season     (links: what to look in)
//   filter: Weather = Rainy      (one per line)
//   range: 12 months             (3 months, 6 months, 12 months or all)
//   bars: count                  (% or count)
//   title: My songs

import type { Source } from './journal'

export type EmbedShow = 'count' | 'breakdown' | 'trend' | 'links'
export type EmbedRange = '3m' | '6m' | '12m' | 'all'

export interface EmbedSpec {
  notes: Source | null
  show: EmbedShow
  of: string            // dimension name or id ('' = none)
  track: string
  compare: string[]
  filters: { dim: string; value: string }[]
  range: EmbedRange
  bars: 'percent' | 'count'
  title: string
  errors: string[]
}

const SHOWS: EmbedShow[] = ['count', 'breakdown', 'trend', 'links']
const RANGE_TEXT: Record<EmbedRange, string> = { '3m': '3 months', '6m': '6 months', '12m': '12 months', all: 'all' }

export function parseNotes(text: string): Source | null {
  const t = text.trim()
  if (!t) return null
  if (t.toLowerCase() === 'all') return { kind: 'all', value: '' }
  if (t.startsWith('#')) return { kind: 'tag', value: t.slice(1) }
  if (t.endsWith('/')) return { kind: 'folder', value: t.replace(/\/+$/, '') }
  return { kind: 'tag', value: t }
}

export function notesText(source: Source): string {
  return source.kind === 'all' ? 'all' : source.kind === 'folder' ? `${source.value.replace(/\/+$/, '')}/` : `#${source.value}`
}

export function parseEmbed(text: string): EmbedSpec {
  const spec: EmbedSpec = {
    notes: null, show: 'count', of: '', track: '', compare: [], filters: [],
    range: 'all', bars: 'percent', title: '', errors: [],
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/)
    if (!m) {
      if (line.trim()) spec.errors.push(`Not understood: "${line.trim()}"`)
      continue
    }
    const key = m[1].toLowerCase()
    const value = m[2]
    if (key === 'notes') spec.notes = parseNotes(value)
    else if (key === 'show') {
      const show = value.toLowerCase().replace(/^most often$/, 'count') as EmbedShow
      if (SHOWS.includes(show)) spec.show = show
      else spec.errors.push(`"show" is one of: ${SHOWS.join(', ')}`)
    } else if (key === 'of') spec.of = value
    else if (key === 'track') spec.track = value
    else if (key === 'compare') spec.compare = value.split(',').map(s => s.trim()).filter(Boolean)
    else if (key === 'filter') {
      const f = value.match(/^(.+?)\s*=\s*(.+)$/)
      if (f) spec.filters.push({ dim: f[1], value: f[2] })
      else spec.errors.push('Write filters as "filter: Property = value"')
    } else if (key === 'range') {
      const r = (Object.entries(RANGE_TEXT).find(([, t]) => t === value.toLowerCase())?.[0] ?? value.toLowerCase()) as EmbedRange
      if (r in RANGE_TEXT) spec.range = r
      else spec.errors.push('"range" is 3 months, 6 months, 12 months or all')
    } else if (key === 'bars') spec.bars = value.trim() === 'count' ? 'count' : 'percent'
    else if (key === 'title') spec.title = value
    else spec.errors.push(`Unknown option "${m[1]}"`)
  }
  if (!spec.notes) spec.errors.push('Say which notes, e.g. "notes: #journal_entry"')
  if ((spec.show === 'count' || spec.show === 'breakdown') && !spec.of) spec.errors.push(`"show: ${spec.show}" needs "of: …"`)
  return spec
}

/** The block's text for a spec (the reverse of parseEmbed; defaults left out). */
export function writeEmbed(spec: Omit<EmbedSpec, 'errors'>): string {
  const lines = [`notes: ${spec.notes ? notesText(spec.notes) : ''}`, `show: ${spec.show}`]
  if (spec.of) lines.push(`of: ${spec.of}`)
  if (spec.track && spec.show !== 'count') lines.push(`track: ${spec.track}`)
  if (spec.compare.length && spec.show === 'links') lines.push(`compare: ${spec.compare.join(', ')}`)
  for (const f of spec.filters) lines.push(`filter: ${f.dim} = ${f.value}`)
  if (spec.range !== 'all') lines.push(`range: ${RANGE_TEXT[spec.range]}`)
  if (spec.bars === 'count' && spec.show === 'breakdown') lines.push('bars: count')
  if (spec.title) lines.push(`title: ${spec.title}`)
  return lines.join('\n')
}

/**
 * The dimension a name in the block means: its name (any case, "->" for "→")
 * or its id. Returns undefined when nothing matches.
 */
export function resolveDimension<T extends { id: string; name: string }>(dims: T[], text: string): T | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s*(->|→)\s*/g, ' → ').replace(/\s+/g, ' ')
  const want = norm(text)
  return dims.find(d => norm(d.name) === want) ?? dims.find(d => d.id === text.trim().toLowerCase())
}

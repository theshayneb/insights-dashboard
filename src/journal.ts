// Journal insights: pure helpers that turn journal notes' frontmatter into
// mood tallies and breakdowns. No Obsidian imports, so it is unit-testable.

export interface JournalSettings {
  moodProperty: string
  factorProperties: string[]
  dateProperty: string
}

/** One property value as shown to the user, plus its comparison key. */
export interface JournalValue {
  key: string    // lower-cased, for counting ("Sunny" and "sunny" are one value)
  label: string  // as written in the first note that used it
}

export interface JournalEntry {
  path: string
  title: string
  date: Date  // local midnight
  mood: JournalValue[]
  factors: Record<string, JournalValue[]>  // keyed by property name from the settings
}

/** A group of entries (a weekday, a season, a property value) and its mood mix. */
export interface MoodBreakdown {
  key: string
  label: string
  entries: number                 // entries in the group that have a mood
  moods: Map<string, number>      // mood key → entries (split evenly when a note has several moods)
}

export interface MoodLink {
  dimension: string    // e.g. "Weather" or "Day of week"
  group: string        // e.g. "Rainy"
  moodKey: string
  share: number        // 0..1, share of the group's entries with that mood
  baseline: number     // 0..1, share of all entries with that mood
  entries: number      // entries in the group
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

// ─── Reading frontmatter ──────────────────────────────────────────────────────

/** Frontmatter value by property name, ignoring case ("mood" finds "Mood"). */
export function getProperty(frontmatter: Record<string, unknown> | undefined, name: string): unknown {
  if (!frontmatter || !name) return undefined
  if (name in frontmatter) return frontmatter[name]
  const lower = name.toLowerCase()
  const key = Object.keys(frontmatter).find(k => k.toLowerCase() === lower)
  return key === undefined ? undefined : frontmatter[key]
}

/**
 * A property value as a list of values: lists stay lists, text is split on commas,
 * `[[links]]` show their alias or file name, and a leading `#` is dropped.
 * Repeats (ignoring case) are removed.
 */
export function normalizeValues(raw: unknown): JournalValue[] {
  const out: JournalValue[] = []
  const seen = new Set<string>()
  const add = (text: string) => {
    let label = text.trim()
    const link = label.match(/^\[\[([^\]|]*)(?:\|([^\]]*))?\]\]$/)
    if (link) label = (link[2] ?? link[1].split('/').pop() ?? '').split('#')[0].trim()
    label = label.replace(/^#/, '').trim()
    if (!label) return
    const key = label.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ key, label })
  }
  const visit = (value: unknown) => {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (typeof value === 'number' || typeof value === 'boolean') { add(String(value)); return }
    if (typeof value === 'string') {
      // Don't split inside [[link|alias]]
      for (const part of value.split(/,(?![^[]*\]\])/)) add(part)
    }
  }
  visit(raw)
  return out
}

function localDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m - 1, d)
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null
}

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/

/**
 * The entry's date: the date property (YYYY-MM-DD, with or without a time), else a
 * YYYY-MM-DD in the file name, else the file's creation time.
 */
export function entryDate(dateValue: unknown, basename: string, ctime: number): Date {
  const fromText = (text: string) => {
    const m = text.match(ISO_DATE)
    return m ? localDate(Number(m[1]), Number(m[2]), Number(m[3])) : null
  }
  const first = Array.isArray(dateValue) ? (dateValue as unknown[])[0] : dateValue
  const date = (typeof first === 'string' ? fromText(first) : null) ?? fromText(basename)
  if (date) return date
  const c = new Date(ctime)
  return new Date(c.getFullYear(), c.getMonth(), c.getDate())
}

export function buildEntry(
  file: { path: string; basename: string; ctime: number },
  frontmatter: Record<string, unknown> | undefined,
  settings: JournalSettings,
): JournalEntry {
  const factors: Record<string, JournalValue[]> = {}
  for (const prop of settings.factorProperties) factors[prop] = normalizeValues(getProperty(frontmatter, prop))
  return {
    path: file.path,
    title: file.basename,
    date: entryDate(getProperty(frontmatter, settings.dateProperty), file.basename, file.ctime),
    mood: normalizeValues(getProperty(frontmatter, settings.moodProperty)),
    factors,
  }
}

// ─── Dates ────────────────────────────────────────────────────────────────────

/** Meteorological seasons, northern hemisphere (Mar–May is spring). */
export function seasonOf(date: Date): Season {
  const m = date.getMonth()
  if (m >= 2 && m <= 4) return 'spring'
  if (m >= 5 && m <= 7) return 'summer'
  if (m >= 8 && m <= 10) return 'autumn'
  return 'winter'
}

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']

/** Weekdays as Date.getDay() numbers, Monday first. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]

export function yearMonthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Entries on or after `since` (all of them when `since` is null). */
export function entriesSince(entries: JournalEntry[], since: Date | null): JournalEntry[] {
  return since ? entries.filter(e => e.date >= since) : entries
}

// ─── Tallies ──────────────────────────────────────────────────────────────────

/** How many entries have each value, most common first (ties by label). */
export function countValues(entries: JournalEntry[], valuesOf: (e: JournalEntry) => JournalValue[]): (JournalValue & { count: number })[] {
  const counts = new Map<string, JournalValue & { count: number }>()
  for (const e of entries) {
    for (const v of valuesOf(e)) {
      const item = counts.get(v.key)
      if (item) item.count++
      else counts.set(v.key, { ...v, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * Mood keys in display order: low to high when every mood is a number (e.g. 1–5),
 * otherwise most common first.
 */
export function orderMoods(tally: (JournalValue & { count: number })[]): string[] {
  const numeric = tally.length > 0 && tally.every(m => m.key.trim() !== '' && Number.isFinite(Number(m.key)))
  if (numeric) return [...tally].sort((a, b) => Number(a.key) - Number(b.key)).map(m => m.key)
  return tally.map(m => m.key)
}

/**
 * Mood mix per group. `groupsOf` lists the groups an entry belongs to (an entry
 * with two activities counts in both). Entries without a mood are skipped; an
 * entry with several moods counts as an equal fraction of each.
 */
export function breakdownByGroup(
  entries: JournalEntry[],
  groupsOf: (e: JournalEntry) => JournalValue[],
): MoodBreakdown[] {
  const groups = new Map<string, MoodBreakdown>()
  for (const e of entries) {
    if (e.mood.length === 0) continue
    const weight = 1 / e.mood.length
    for (const g of groupsOf(e)) {
      let group = groups.get(g.key)
      if (!group) {
        group = { key: g.key, label: g.label, entries: 0, moods: new Map() }
        groups.set(g.key, group)
      }
      group.entries++
      for (const m of e.mood) group.moods.set(m.key, (group.moods.get(m.key) ?? 0) + weight)
    }
  }
  return [...groups.values()]
}

/** Every entry with a mood, as one group (the baseline the others are compared with). */
export function overallBreakdown(entries: JournalEntry[], label: string): MoodBreakdown {
  return breakdownByGroup(entries, () => [{ key: '__all__', label }])[0]
    ?? { key: '__all__', label, entries: 0, moods: new Map() }
}

/**
 * Groups whose share of a mood is clearly above the overall share, biggest
 * difference first. Groups with fewer than `minEntries` entries are ignored, and
 * so are differences under `minDiff` (0..1).
 */
export function findMoodLinks(
  dimensions: { name: string; groups: MoodBreakdown[] }[],
  overall: MoodBreakdown,
  { minEntries = 3, minDiff = 0.15, limit = 6 } = {},
): MoodLink[] {
  if (overall.entries === 0) return []
  const links: MoodLink[] = []
  for (const dim of dimensions) {
    for (const g of dim.groups) {
      if (g.entries < minEntries || g.entries >= overall.entries) continue
      for (const [moodKey, count] of g.moods) {
        const share = count / g.entries
        const baseline = (overall.moods.get(moodKey) ?? 0) / overall.entries
        if (share - baseline >= minDiff && count >= 2) {
          links.push({ dimension: dim.name, group: g.label, moodKey, share, baseline, entries: g.entries })
        }
      }
    }
  }
  // Bigger groups are more convincing: weight the difference by the group size
  const score = (l: MoodLink) => (l.share - l.baseline) * Math.sqrt(l.entries)
  return links.sort((a, b) => score(b) - score(a)).slice(0, limit)
}

/** Longest run of consecutive days with an entry, and the run ending today (or yesterday). */
export function streaks(entries: JournalEntry[], today: Date): { current: number; longest: number } {
  const dayNumber = (d: Date) => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000)
  const days = [...new Set(entries.map(e => dayNumber(e.date)))].sort((a, b) => a - b)
  let longest = 0, run = 0
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  const t = dayNumber(today)
  const daySet = new Set(days)
  let start = daySet.has(t) ? t : daySet.has(t - 1) ? t - 1 : null
  let current = 0
  while (start !== null && daySet.has(start)) { current++; start-- }
  return { current, longest }
}

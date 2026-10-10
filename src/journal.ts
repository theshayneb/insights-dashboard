// Pure helpers that turn journal notes' frontmatter into tallies and
// breakdowns. No Obsidian imports, so it is unit-testable.
//
// A "dimension" is anything an entry can be grouped by: a frontmatter property
// (id = the property name in lower case) or a built-in date dimension
// (id starting with "@", e.g. "@weekday").

/** One value as shown to the user, plus its comparison key. */
export interface JournalValue {
  key: string    // lower-cased, for counting ("Sunny" and "sunny" are one value)
  label: string  // as written in the first note that used it
  link?: string  // for [[links]]: the link target, to follow into the linked note
}

/** A note an entry links to, as far as the dashboard needs it. */
export interface LinkedNote {
  name: string                                // file name without extension
  frontmatter: Record<string, unknown> | undefined
  tags: string[]                              // without "#"
}

/** Lets buildEntry follow links: resolve a link target, and the note's outgoing links (properties and text). */
export interface LinkContext {
  resolve: (link: string) => LinkedNote | null
  outgoing: string[]
}

/** Where a dashboard's notes come from. */
export interface Source {
  kind: 'tag' | 'folder' | 'all'
  value: string  // tag without "#", or folder path; unused for 'all'
}

export interface JournalEntry {
  path: string
  title: string
  date: Date  // local midnight
  props: Record<string, JournalValue[]>  // keyed by property name in lower case
  propNames: Record<string, string>      // lower case → as written in this note
}

/** A group of entries (a weekday, a property value, …) and its mix of the tracked values. */
export interface Breakdown {
  key: string
  label: string
  entries: number            // entries in the group that have a tracked value
  mix: Map<string, number>   // tracked value key → entries (split evenly when a note has several)
}

export interface Link {
  dimension: string    // e.g. "Weather" or "Day of week"
  dimensionId: string
  groupKey: string
  group: string        // e.g. "Rainy"
  valueKey: string     // the tracked value that stands out
  share: number        // 0..1, share of the group's entries with that value
  baseline: number     // 0..1, share of all entries with that value
  entries: number      // entries in the group
}

export interface Filter {
  dim: string       // dimension id
  value: string     // value key
  label: string     // value label, for display
}

export interface DiscoveredProperty {
  id: string        // lower case
  name: string      // as written in most notes
  entries: number   // entries that have a value for it
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

// ─── Built-in date dimensions ─────────────────────────────────────────────────

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SEASON_NAMES: Record<Season, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' }

/** Meteorological seasons, northern hemisphere (Mar–May is spring). */
export function seasonOf(date: Date): Season {
  const m = date.getMonth()
  if (m >= 2 && m <= 4) return 'spring'
  if (m >= 5 && m <= 7) return 'summer'
  if (m >= 8 && m <= 10) return 'autumn'
  return 'winter'
}

export interface BuiltinDimension {
  id: string
  name: string
  valueOf: (date: Date) => JournalValue
  order: string[]  // value keys in their natural order
}

export const BUILTIN_DIMENSIONS: BuiltinDimension[] = [
  {
    id: '@weekday', name: 'Day of week',
    valueOf: (d) => ({ key: String(d.getDay()), label: WEEKDAY_NAMES[d.getDay()] }),
    order: ['1', '2', '3', '4', '5', '6', '0'],  // Monday first
  },
  {
    id: '@season', name: 'Season',
    valueOf: (d) => ({ key: seasonOf(d), label: SEASON_NAMES[seasonOf(d)] }),
    order: ['spring', 'summer', 'autumn', 'winter'],
  },
  {
    id: '@year', name: 'Year',
    valueOf: (d) => ({ key: String(d.getFullYear()), label: String(d.getFullYear()) }),
    order: Array.from({ length: 101 }, (_, i) => String(1970 + i)),
  },
  {
    id: '@month', name: 'Month of year',
    valueOf: (d) => ({ key: String(d.getMonth()), label: MONTH_NAMES[d.getMonth()] }),
    order: MONTH_NAMES.map((_, i) => String(i)),
  },
]

export function builtinDimension(id: string): BuiltinDimension | undefined {
  return BUILTIN_DIMENSIONS.find(d => d.id === id)
}

export function weekdayName(date: Date): string {
  return WEEKDAY_NAMES[date.getDay()]
}

/** An entry's values for a dimension (property or built-in). */
export function valuesOf(entry: JournalEntry, dim: string): JournalValue[] {
  const builtin = builtinDimension(dim)
  if (builtin) return [builtin.valueOf(entry.date)]
  return entry.props[dim] ?? []
}

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
 * Repeats (ignoring case) are removed. Objects (nested properties) are skipped.
 */
export function normalizeValues(raw: unknown): JournalValue[] {
  const out: JournalValue[] = []
  const seen = new Set<string>()
  const add = (text: string) => {
    let label = text.trim()
    const link = label.match(/^\[\[([^\]|]*)(?:\|([^\]]*))?\]\]$/)
    const target = link ? link[1].split('#')[0].trim() : undefined
    if (link) label = (link[2] ?? link[1].split('/').pop() ?? '').split('#')[0].trim()
    label = label.replace(/^#/, '').trim()
    if (!label) return
    const key = label.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(target ? { key, label, link: target } : { key, label })
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

/** Tag comparison key: case-insensitive, no "#", and "-" / "_" count as the same. */
export function tagKey(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase().replace(/-/g, '_')
}

/** Whether a note (its path and tags) belongs to a dashboard's source. Nested tags count. */
export function matchesSource(source: Source, note: { path: string; tags: string[] }): boolean {
  if (source.kind === 'all') return true
  if (source.kind === 'folder') {
    const folder = source.value.trim().replace(/^\/+|\/+$/g, '')
    return folder === '' || note.path.startsWith(folder + '/')
  }
  const key = tagKey(source.value)
  return !!key && note.tags.some(t => { const k = tagKey(t); return k === key || k.startsWith(key + '/') })
}

export function sourceLabel(source: Source): string {
  if (source.kind === 'all') return 'All notes'
  if (source.kind === 'folder') return `${source.value.replace(/\/+$/, '') || '/'}/`
  return `#${source.value}`
}

function addValues(props: Record<string, JournalValue[]>, id: string, values: JournalValue[]) {
  const list = props[id] ?? (props[id] = [])
  for (const v of values) if (!list.some(x => x.key === v.key)) list.push(v)
}

/**
 * An entry from a note's frontmatter. With `links`, it also gets:
 * - for a property linking to notes (e.g. SOTD: [[Song]]), the linked notes'
 *   properties, as "sotd>artist" ("SOTD → Artist");
 * - for every tag on notes it links to (in properties or text), the linked
 *   notes with that tag, as "@linked:wardrobe_item" ("Linked #wardrobe_item").
 */
export function buildEntry(
  file: { path: string; basename: string; ctime: number },
  frontmatter: Record<string, unknown> | undefined,
  dateProperty: string,
  links?: LinkContext,
): JournalEntry {
  const props: Record<string, JournalValue[]> = {}
  const propNames: Record<string, string> = {}
  for (const [name, raw] of Object.entries(frontmatter ?? {})) {
    const id = name.toLowerCase()
    if (id === 'position') continue  // Obsidian's own bookkeeping
    const values = normalizeValues(raw)
    if (values.length === 0) continue
    props[id] = values
    propNames[id] = name

    if (!links) continue
    for (const v of values) {
      if (!v.link) continue
      const note = links.resolve(v.link)
      if (!note) continue
      for (const [subName, subRaw] of Object.entries(note.frontmatter ?? {})) {
        const sub = subName.toLowerCase()
        if (sub === 'position') continue
        const subValues = normalizeValues(subRaw)
        if (subValues.length === 0) continue
        addValues(props, `${id}>${sub}`, subValues)
        propNames[`${id}>${sub}`] = `${name} → ${subName}`
      }
    }
  }

  if (links) {
    const seen = new Set<string>()
    for (const link of links.outgoing) {
      const note = links.resolve(link)
      if (!note || seen.has(note.name.toLowerCase())) continue
      seen.add(note.name.toLowerCase())
      for (const tag of note.tags) {
        const id = `@linked:${tagKey(tag)}`
        addValues(props, id, [{ key: note.name.toLowerCase(), label: note.name }])
        propNames[id] = `Linked #${tag.replace(/^#/, '')}`
      }
    }
  }

  return {
    path: file.path,
    title: file.basename,
    date: entryDate(getProperty(frontmatter, dateProperty), file.basename, file.ctime),
    props,
    propNames,
  }
}

/** What kind of dimension an id is: a note's own property, something from linked notes, or a date. */
export function dimensionKind(id: string): 'property' | 'linked' | 'date' {
  if (builtinDimension(id)) return 'date'
  if (id.startsWith('@linked:') || id.includes('>')) return 'linked'
  return 'property'
}

/**
 * Properties used in the entries, most used first. `ignore` (lower case) leaves
 * out bookkeeping properties such as tags or the date.
 */
export function discoverProperties(entries: JournalEntry[], ignore: string[]): DiscoveredProperty[] {
  // A note's own properties first, then those from linked notes; most used first within each
  const ignored = new Set(ignore.map(s => s.trim().toLowerCase()))
  const found = new Map<string, { entries: number; names: Map<string, number> }>()
  for (const e of entries) {
    for (const id of Object.keys(e.props)) {
      // "sotd>tags" is ignored when "tags" is
      if (ignored.has(id) || ignored.has(id.split('>').pop() ?? '')) continue
      let item = found.get(id)
      if (!item) { item = { entries: 0, names: new Map() }; found.set(id, item) }
      item.entries++
      const name = e.propNames[id] ?? id
      item.names.set(name, (item.names.get(name) ?? 0) + 1)
    }
  }
  return [...found].map(([id, item]) => ({
    id,
    name: [...item.names].sort((a, b) => b[1] - a[1])[0][0],
    entries: item.entries,
  })).sort((a, b) => (dimensionKind(a.id) === 'linked' ? 1 : 0) - (dimensionKind(b.id) === 'linked' ? 1 : 0)
    || b.entries - a.entries || a.name.localeCompare(b.name))
}

// ─── Dates and filters ────────────────────────────────────────────────────────

export function yearMonthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Entries on or after `since` (all of them when `since` is null). */
export function entriesSince(entries: JournalEntry[], since: Date | null): JournalEntry[] {
  return since ? entries.filter(e => e.date >= since) : entries
}

/** Entries matching every filter (an entry with several values matches if any is the filter's). */
export function applyFilters(entries: JournalEntry[], filters: Filter[]): JournalEntry[] {
  if (filters.length === 0) return entries
  return entries.filter(e => filters.every(f => valuesOf(e, f.dim).some(v => v.key === f.value)))
}

// ─── Tallies ──────────────────────────────────────────────────────────────────

export type Tally = JournalValue & { count: number }

/** How many entries have each value, most common first (ties by label). */
export function countValues(entries: JournalEntry[], valuesOfEntry: (e: JournalEntry) => JournalValue[]): Tally[] {
  const counts = new Map<string, Tally>()
  for (const e of entries) {
    for (const v of valuesOfEntry(e)) {
      const item = counts.get(v.key)
      if (item) item.count++
      else counts.set(v.key, { ...v, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * Value keys in display order: a built-in dimension's natural order, low to high
 * when every value is a number (e.g. 1–5), otherwise most common first.
 */
export function orderValues(tally: Tally[], dim?: string): string[] {
  const builtin = dim ? builtinDimension(dim) : undefined
  if (builtin) {
    const present = new Set(tally.map(v => v.key))
    return builtin.order.filter(k => present.has(k))
  }
  const numeric = tally.length > 0 && tally.every(v => v.key.trim() !== '' && Number.isFinite(Number(v.key)))
  if (numeric) return [...tally].sort((a, b) => Number(a.key) - Number(b.key)).map(v => v.key)
  return tally.map(v => v.key)
}

/**
 * The tracked dimension's mix per group. `groupsOf` lists the groups an entry
 * belongs to (an entry with two activities counts in both). Entries without a
 * tracked value are skipped; an entry with several counts as an equal fraction
 * of each.
 */
export function breakdownByGroup(
  entries: JournalEntry[],
  groupsOf: (e: JournalEntry) => JournalValue[],
  trackedOf: (e: JournalEntry) => JournalValue[],
): Breakdown[] {
  const groups = new Map<string, Breakdown>()
  for (const e of entries) {
    const tracked = trackedOf(e)
    if (tracked.length === 0) continue
    const weight = 1 / tracked.length
    for (const g of groupsOf(e)) {
      let group = groups.get(g.key)
      if (!group) {
        group = { key: g.key, label: g.label, entries: 0, mix: new Map() }
        groups.set(g.key, group)
      }
      group.entries++
      for (const t of tracked) group.mix.set(t.key, (group.mix.get(t.key) ?? 0) + weight)
    }
  }
  return [...groups.values()]
}

/** Groups of a dimension, in its natural order for built-ins, else biggest first. */
export type TrackedOf = string | ((e: JournalEntry) => JournalValue[])

function trackedFn(tracked: TrackedOf): (e: JournalEntry) => JournalValue[] {
  return typeof tracked === 'string' ? (e) => valuesOf(e, tracked) : tracked
}

export function breakdownByDimension(entries: JournalEntry[], dim: string, tracked: TrackedOf): Breakdown[] {
  const groups = breakdownByGroup(entries, e => valuesOf(e, dim), trackedFn(tracked))
  const builtin = builtinDimension(dim)
  if (builtin) {
    const byKey = new Map(groups.map(g => [g.key, g]))
    return builtin.order.flatMap(k => byKey.get(k) ?? [])
  }
  return groups.sort((a, b) => b.entries - a.entries || a.label.localeCompare(b.label))
}

/** Every entry with a tracked value, as one group (the baseline the others are compared with). */
export function overallBreakdown(entries: JournalEntry[], tracked: TrackedOf, label: string): Breakdown {
  return breakdownByGroup(entries, () => [{ key: '__all__', label }], trackedFn(tracked))[0]
    ?? { key: '__all__', label, entries: 0, mix: new Map() }
}

/**
 * Groups whose share of a tracked value is clearly above the overall share,
 * most convincing first. Groups with fewer than `minEntries` entries are
 * ignored, and so are differences under `minDiff` (0..1).
 */
export function findLinks(
  dimensions: { id: string; name: string; groups: Breakdown[] }[],
  overall: Breakdown,
  { minEntries = 3, minDiff = 0.15, limit = 6 } = {},
): Link[] {
  if (overall.entries === 0) return []
  const links: Link[] = []
  for (const dim of dimensions) {
    for (const g of dim.groups) {
      if (g.entries < minEntries || g.entries >= overall.entries) continue
      for (const [valueKey, count] of g.mix) {
        const share = count / g.entries
        const baseline = (overall.mix.get(valueKey) ?? 0) / overall.entries
        if (share - baseline >= minDiff && count >= 2) {
          links.push({ dimension: dim.name, dimensionId: dim.id, groupKey: g.key, group: g.label, valueKey, share, baseline, entries: g.entries })
        }
      }
    }
  }
  // Bigger groups are more convincing: weight the difference by the group size
  const score = (l: Link) => (l.share - l.baseline) * Math.sqrt(l.entries)
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
  let day = daySet.has(t) ? t : daySet.has(t - 1) ? t - 1 : null
  let current = 0
  while (day !== null && daySet.has(day)) { current++; day-- }
  return { current, longest }
}

// ─── Card order ───────────────────────────────────────────────────────────────

/** `ids` sorted by their position in `saved`; ids not in `saved` keep their order, after the saved ones. */
export function orderCards(ids: string[], saved: string[]): string[] {
  const pos = new Map(saved.map((id, i) => [id, i]))
  return ids
    .map((id, i) => ({ id, i, p: pos.get(id) }))
    .sort((a, b) => {
      if (a.p !== undefined && b.p !== undefined) return a.p - b.p
      if (a.p !== undefined) return -1
      if (b.p !== undefined) return 1
      return a.i - b.i
    })
    .map(x => x.id)
}

/**
 * Moves `id` one place up (-1) or down (+1) among `visible` (the cards shown in
 * that column, in order), returning the new saved order: this column's cards
 * first, then the rest of `saved`.
 */
export function moveCard(column: string[], visible: string[], id: string, delta: -1 | 1, saved: string[]): string[] {
  const vi = visible.indexOf(id)
  const neighbor = visible[vi + delta]
  if (vi < 0 || neighbor === undefined) return saved
  const order = [...column]
  const a = order.indexOf(id), b = order.indexOf(neighbor)
  ;[order[a], order[b]] = [order[b], order[a]]
  return [...order, ...saved.filter(s => !order.includes(s))]
}

export type Column = 'left' | 'right'

/**
 * The cards of each column, in order: a card's saved column (or its default),
 * sorted by the saved order. Hidden cards are included; the caller skips them.
 */
export function layoutColumns(
  cards: { id: string; column: Column }[],
  savedColumns: Record<string, Column>,
  savedOrder: string[],
): Record<Column, string[]> {
  const columnOf = (c: { id: string; column: Column }) => savedColumns[c.id] ?? c.column
  return {
    left: orderCards(cards.filter(c => columnOf(c) === 'left').map(c => c.id), savedOrder),
    right: orderCards(cards.filter(c => columnOf(c) === 'right').map(c => c.id), savedOrder),
  }
}

/**
 * Saved columns and order after cards were dragged: `left` and `right` are the
 * shown cards as they now sit. Cards not shown keep their saved column and go
 * after them in the order.
 */
export function layoutAfterDrop(
  left: string[],
  right: string[],
  savedColumns: Record<string, Column>,
  savedOrder: string[],
): { columns: Record<string, Column>; order: string[] } {
  const columns = { ...savedColumns }
  for (const id of left) columns[id] = 'left'
  for (const id of right) columns[id] = 'right'
  const shown = new Set([...left, ...right])
  return { columns, order: [...left, ...right, ...savedOrder.filter(id => !shown.has(id))] }
}

// ─── Colors ───────────────────────────────────────────────────────────────────

/**
 * Colors and order for a dimension's values. Values with a chosen color come
 * first, in the order they were chosen (e.g. Great, Good, Okay, Bad); the rest
 * keep `order` and take palette colors not already chosen.
 */
export function colorValues(
  order: string[],
  chosen: Record<string, string>,
  palette: string[],
): { order: string[]; colors: Map<string, string> } {
  // Match chosen colors by their words, so "great" also colors "😄 great" or "Great!"
  const byWords = new Map(Object.keys(chosen).map(k => [colorKey(k), k]))
  const chosenFor = (k: string) => k in chosen ? k : byWords.get(colorKey(k))
  const rank = new Map(Object.keys(chosen).map((k, i) => [k, i]))
  const chosenKeys = order.filter(k => chosenFor(k) !== undefined)
    .sort((a, b) => rank.get(chosenFor(a)!)! - rank.get(chosenFor(b)!)!)
  const rest = order.filter(k => chosenFor(k) === undefined)
  const taken = new Set(Object.values(chosen).map(c => c.toLowerCase()))
  const free = palette.filter(c => !taken.has(c.toLowerCase()))
  const pool = free.length ? free : palette
  const colors = new Map<string, string>()
  for (const k of chosenKeys) colors.set(k, chosen[chosenFor(k)!])
  rest.forEach((k, i) => colors.set(k, pool[i % pool.length]))
  return { order: [...chosenKeys, ...rest], colors }
}

/** A value's words and numbers only, for matching colors: "😄 Great!" → "great". */
export function colorKey(key: string): string {
  return key.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * At most `max` tracked values keep their own color: chosen-color values and the
 * most common ones; the rest are counted together as "Other" (key "__other__").
 */
export function limitValues(order: string[], tally: Tally[], chosen: Record<string, string>, max: number): Set<string> {
  if (order.length <= max) return new Set(order)
  const count = new Map(tally.map(v => [v.key, v.count]))
  const keep = order.filter(k => k in chosen).slice(0, max)
  const rest = order.filter(k => !(k in chosen)).sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0))
  return new Set([...keep, ...rest.slice(0, max - keep.length)])
}

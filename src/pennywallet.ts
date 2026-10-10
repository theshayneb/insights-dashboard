// Reads PennyWallet (Mod) month files, YYYY-MM.md in its folder, each with a
// Markdown table of transactions, and finds the ones about a note.
// No Obsidian imports, so it is unit-testable.

export interface Purchase {
  date: Date
  type: string          // expense, income, transfer
  wallet: string
  category: string
  note: string
  tags: string[]
  amount: number        // refunds are negative
  file: string          // month file path, to open it
}

/** Options of an `insights-purchases` block, one "key: value" per line. */
export interface PurchaseQuery {
  names: string[]   // match transactions linking to or tagged with any of these
  tags: string[]    // extra tags to match
  limit: number     // rows listed
}

/** Same tag/name rules as PennyWallet, and spaces count too: "Masala Chai" = masala_chai = masala-chai. */
export function nameKey(text: string): string {
  return text.trim().replace(/^#/, '').toLowerCase().replace(/[\s_-]+/g, '')
}

/**
 * Transactions in a month file's table. Columns: Date | Type | Wallet | From |
 * To | Category | Note | Tags | Amount | CreatedAt | Budget, where older files
 * lack Tags, CreatedAt or Budget (see PennyWallet's parseRow).
 */
export function parseMonthFile(content: string, yearMonth: string, file: string): Purchase[] {
  const [year] = yearMonth.split('-').map(Number)
  const out: Purchase[] = []
  let inTable = false
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!inTable && (t.startsWith('| Date') || t.startsWith('| 日期'))) { inTable = true; continue }
    if (!inTable) continue
    if (t.startsWith('|---')) continue
    if (!t.startsWith('|')) { if (t === '') break; continue }

    // An escaped \| (Obsidian's way of writing [[link\|alias]] in a table) isn't a column break
    const cols = t.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')).filter((_, i, a) => i > 0 && i < a.length - 1)
    if (cols.length < 8 || cols.length > 11) continue
    const [date, type, wallet, fromWallet, , category, note] = cols
    let tags = '-', amount = cols[7]
    if (cols.length >= 10 || (cols.length === 9 && !/^-?\d+(\.\d+)?$/.test(cols[7]))) {
      tags = cols[7]
      amount = cols[8]
    }
    const value = parseFloat(amount)
    const md = date.match(/^(\d{1,2})\/(\d{1,2})$/)
    if (isNaN(value) || !md) continue
    out.push({
      date: new Date(year, Number(md[1]) - 1, Number(md[2])),
      type: type === 'payment' || type === 'repayment' ? 'transfer' : type,
      wallet: wallet !== '-' ? wallet : fromWallet !== '-' ? fromWallet : '',
      category: category === '-' ? '' : category,
      note: note === '-' ? '' : note,
      tags: tags === '-' ? [] : tags.split(',').map(s => s.trim()).filter(Boolean),
      amount: value,
      file,
    })
  }
  return out
}

/** Link targets in a transaction note: [[Name]], [[Folder/Name|alias]], [[Name#heading]] → "Name". */
export function linkedNames(note: string): string[] {
  return [...note.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(m => m[1].split('/').pop()!.trim())
}

/** Transactions linking to or tagged with the query's names (or tagged with its tags), newest first. */
export function findPurchases(all: Purchase[], query: PurchaseQuery): Purchase[] {
  const names = new Set(query.names.map(nameKey).filter(Boolean))
  const tags = new Set([...names, ...query.tags.map(nameKey).filter(Boolean)])
  return all
    .filter(p => linkedNames(p.note).some(n => names.has(nameKey(n))) || p.tags.some(t => tags.has(nameKey(t))))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
}

/** Reads the block's options; `defaults` are this note's name and aliases. */
export function parseQuery(source: string, defaults: string[]): PurchaseQuery {
  const query: PurchaseQuery = { names: [...defaults], tags: [], limit: 20 }
  for (const line of source.split('\n')) {
    const m = line.match(/^\s*(\w+)\s*:\s*(.*)$/)
    if (!m) continue
    const values = m[2].split(',').map(s => s.trim().replace(/^\[\[|\]\]$/g, '')).filter(Boolean)
    const key = m[1].toLowerCase()
    if (key === 'name' || key === 'names' || key === 'link') query.names = values
    else if (key === 'tag' || key === 'tags') query.tags = values
    else if (key === 'limit' && Number(m[2]) > 0) query.limit = Math.floor(Number(m[2]))
  }
  return query
}

export interface PurchaseSummary {
  count: number
  total: number           // expenses minus refunds
  last: Date | null
  first: Date | null
  everyDays: number | null  // typical days between purchases (median), with 3 or more
}

export function summarize(purchases: Purchase[]): PurchaseSummary {
  const spent = purchases.filter(p => p.type === 'expense')
  const days = [...new Set(spent.map(p => p.date.getTime()))].sort((a, b) => a - b)
  const gaps = days.slice(1).map((d, i) => Math.round((d - days[i]) / 86_400_000)).sort((a, b) => a - b)
  return {
    count: purchases.length,
    total: spent.reduce((sum, p) => sum + p.amount, 0),
    last: purchases.length ? purchases[0].date : null,
    first: purchases.length ? purchases[purchases.length - 1].date : null,
    everyDays: gaps.length >= 2 ? gaps[Math.floor(gaps.length / 2)] : null,
  }
}

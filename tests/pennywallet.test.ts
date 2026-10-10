import { describe, it, expect } from 'vitest'
import { findPurchases, linkedNames, nameKey, parseMonthFile, parseQuery, summarize } from '../src/pennywallet'

const month = `---
income: 0
---
## 2026-03

| Date | Type | Wallet | From | To | Category | Note | Tags | Amount | CreatedAt | Budget |
|------|------|--------|------|----|----------|------|------|--------|-----------|--------|
| 03/02 | expense | Visa | - | - | food | [[Masala Chai]] 2 tins | - | 24.5 | 2026-03-02T10:00 | Treats |
| 03/09 | expense | Cash | - | - | food | Tea shop | masala_chai,gift | 12 | - |
| 03/15 | expense | Visa | - | - | food | refund [[Teas/Masala Chai\\|chai]] | - | -5 | - |
| 03/20 | expense | Visa | - | - | food | [[Sencha]] | - | 18 | - |
| 03/21 | transfer | - | Bank | Cash | - | Withdrawal | - | 100 | - |

Some text after the table
`

describe('parseMonthFile', () => {
  it('reads every row with its year, tags and amount', () => {
    const rows = parseMonthFile(month, '2026-03', 'PennyWallet/2026-03.md')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({ date: new Date(2026, 2, 2), wallet: 'Visa', category: 'food', note: '[[Masala Chai]] 2 tins', tags: [], amount: 24.5 })
    expect(rows[1].tags).toEqual(['masala_chai', 'gift'])
    expect(rows[4]).toMatchObject({ type: 'transfer', wallet: 'Bank' })
  })

  it('reads old rows without tags or createdAt', () => {
    const old = '| Date | Type | Wallet | From | To | Category | Note | Amount |\n|---|\n| 04/03 | expense | Cash | - | - | food | [[Sencha]] | 9 |\n'
    expect(parseMonthFile(old, '2020-04', 'x')[0]).toMatchObject({ date: new Date(2020, 3, 3), amount: 9, tags: [] })
  })
})

describe('finding purchases', () => {
  const rows = parseMonthFile(month, '2026-03', 'f')

  it('matches links (with folders, aliases) and tags, ignoring case, spaces, - and _', () => {
    expect(linkedNames('[[Teas/Masala Chai|chai]] and [[Sencha#notes]]')).toEqual(['Masala Chai', 'Sencha'])
    expect(nameKey('Masala Chai')).toBe(nameKey('#masala-chai'))
    const found = findPurchases(rows, { names: ['Masala Chai'], tags: [], limit: 20 })
    expect(found.map(p => p.amount)).toEqual([-5, 12, 24.5])  // newest first
  })

  it('reads block options', () => {
    expect(parseQuery('', ['Masala Chai'])).toEqual({ names: ['Masala Chai'], tags: [], limit: 20 })
    expect(parseQuery('name: [[Chai]], Masala\ntag: tea\nlimit: 5', ['x'])).toEqual({ names: ['Chai', 'Masala'], tags: ['tea'], limit: 5 })
  })

  it('summarizes spending and how often you buy', () => {
    const s = summarize(findPurchases(rows, { names: ['Masala Chai'], tags: [], limit: 20 }))
    expect(s).toMatchObject({ count: 3, total: 31.5, last: new Date(2026, 2, 15), first: new Date(2026, 2, 2), everyDays: 7 })
  })
})

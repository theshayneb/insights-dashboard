import { App, MarkdownPostProcessorContext, MarkdownRenderChild, TFile, debounce } from 'obsidian'
import { Purchase, findPurchases, parseMonthFile, parseQuery, summarize } from '../pennywallet'

export const PURCHASES_BLOCK = 'insights-purchases'

/** PennyWallet's folder: the setting, else PennyWallet Mod's own setting, else its default. */
export function pennyWalletFolder(app: App, setting: string): string {
  if (setting.trim()) return setting.trim().replace(/^\/+|\/+$/g, '')
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins ?? {}
  for (const id of ['penny-wallet-mod', 'penny-wallet']) {
    const folder = (plugins[id] as { walletFile?: { getConfig?(): { folderName?: string } } } | undefined)
      ?.walletFile?.getConfig?.().folderName
    if (folder) return folder
  }
  return 'PennyWallet'
}

function formatAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysAgo(d: Date): string {
  const today = new Date()
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - d.getTime()) / 86_400_000)
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

/**
 * An `insights-purchases` block: the PennyWallet transactions that link to this
 * note (or are tagged with its name), with totals and how often they happen.
 */
export class PurchasesBlock extends MarkdownRenderChild {
  private readonly insRefresh = debounce(() => { void this.insRender() }, 800, true)

  constructor(
    containerEl: HTMLElement,
    private readonly app: App,
    private readonly source: string,
    private readonly ctx: MarkdownPostProcessorContext,
    private readonly folderSetting: () => string,
  ) {
    super(containerEl)
  }

  onload() {
    void this.insRender()
    // Redraw when a PennyWallet month file changes
    const inFolder = (path: string) => path.startsWith(pennyWalletFolder(this.app, this.folderSetting()) + '/')
    this.registerEvent(this.app.vault.on('modify', f => { if (inFolder(f.path)) this.insRefresh() }))
    this.registerEvent(this.app.vault.on('create', f => { if (inFolder(f.path)) this.insRefresh() }))
  }

  onunload() {
    this.insRefresh.cancel()
  }

  private async insRender() {
    const el = this.containerEl
    const note = this.app.vault.getFileByPath(this.ctx.sourcePath)
    const aliases = note ? (this.app.metadataCache.getFileCache(note)?.frontmatter?.aliases as unknown) : undefined
    const names = [note?.basename ?? '', ...(Array.isArray(aliases) ? aliases.map(String) : typeof aliases === 'string' ? [aliases] : [])]
    const query = parseQuery(this.source, names.filter(Boolean))

    const folder = pennyWalletFolder(this.app, this.folderSetting())
    const months = this.app.vault.getMarkdownFiles().filter(f => isMonthFile(f, folder))
    const all: Purchase[] = []
    for (const file of months) all.push(...parseMonthFile(await this.app.vault.cachedRead(file), file.basename, file.path))
    const found = findPurchases(all, query)

    el.empty()
    const card = el.createDiv('ins-card ins-purchases')
    const head = card.createDiv('ins-card-title')
    head.createSpan({ text: 'Purchases' })
    head.createSpan({ text: query.names.concat(query.tags.map(t => `#${t}`)).join(', '), cls: 'ins-purchases-for' })

    if (months.length === 0) {
      card.createEl('p', { text: `No PennyWallet month files in "${folder}/". The folder can be set in the Insights Dashboard settings.`, cls: 'ins-no-data' })
      return
    }
    if (found.length === 0) {
      card.createEl('p', { text: `No transactions link to [[${query.names[0] ?? ''}]] or are tagged with its name yet.`, cls: 'ins-no-data' })
      return
    }

    const s = summarize(found)
    const stats = card.createDiv('ins-stats ins-purchases-stats')
    const stat = (label: string, value: string, sub?: string) => {
      const box = stats.createDiv('ins-stat')
      box.createDiv({ text: label, cls: 'ins-stat-label' })
      box.createDiv({ text: value, cls: 'ins-stat-value' })
      if (sub) box.createDiv({ text: sub, cls: 'ins-stat-sub' })
    }
    stat('Bought', s.count === 1 ? 'Once' : `${s.count} times`, s.first ? `since ${formatDate(s.first)}` : undefined)
    stat('Spent', formatAmount(s.total), s.count > 1 ? `about ${formatAmount(s.total / s.count)} each` : undefined)
    if (s.last) stat('Last bought', formatDate(s.last), daysAgo(s.last))
    if (s.everyDays && s.last) {
      const next = new Date(s.last.getTime() + s.everyDays * 86_400_000)
      stat('Usually every', `${s.everyDays} days`, `next around ${formatDate(next)}`)
    }

    const list = card.createDiv('ins-purchases-list')
    for (const p of found.slice(0, query.limit)) {
      const row = list.createDiv('ins-purchase-row')
      row.setAttribute('role', 'link')
      row.tabIndex = 0
      row.createSpan({ text: formatDate(p.date), cls: 'ins-purchase-date' })
      row.createSpan({ text: p.note.replace(/\[\[([^\]|]*\/)?([^\]|#]+)[^\]]*\]\]/g, '$2') || p.category, cls: 'ins-purchase-note' })
      row.createSpan({ text: p.wallet, cls: 'ins-purchase-wallet' })
      row.createSpan({ text: formatAmount(p.amount), cls: 'ins-purchase-amount' + (p.amount < 0 ? ' is-refund' : '') })
      const open = () => { void this.app.workspace.openLinkText(p.file, this.ctx.sourcePath, 'tab') }
      row.addEventListener('click', open)
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open() })
    }
    if (found.length > query.limit) {
      card.createDiv({ text: `and ${found.length - query.limit} more (add "limit: ${found.length}" to the block to list all)`, cls: 'ins-hint ins-more' })
    }
  }
}

/** A PennyWallet month file: YYYY-MM.md directly in its folder. */
export function isMonthFile(file: TFile, folder: string): boolean {
  return file.path.startsWith(folder + '/') && /^\d{4}-\d{2}$/.test(file.basename)
}

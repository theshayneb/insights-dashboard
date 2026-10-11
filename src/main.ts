import { Editor, Plugin, WorkspaceLeaf } from 'obsidian'
import { DEFAULT_SETTINGS, InsightsSettings, InsightsSettingTab, migrateSettings } from './settings'
import { InsightsView, INSIGHTS_VIEW_TYPE } from './view/InsightsView'
import { PURCHASES_BLOCK, PurchasesBlock } from './view/PurchasesBlock'
import { EMBED_BLOCK, EmbedBlock } from './view/EmbedBlock'

export default class InsightsDashboardPlugin extends Plugin {
  settings: InsightsSettings = { ...DEFAULT_SETTINGS }

  async onload() {
    await this.loadSettings()

    this.registerView(INSIGHTS_VIEW_TYPE, (leaf) => new InsightsView(leaf, this))
    this.addRibbonIcon('smile', 'Open insights dashboard', () => { void this.openDashboard() })
    this.addCommand({ id: 'open', name: 'Open dashboard', callback: () => { void this.openDashboard() } })
    this.addSettingTab(new InsightsSettingTab(this.app, this))

    // ```insights-purchases``` in a note: the PennyWallet transactions about it
    this.registerMarkdownCodeBlockProcessor(PURCHASES_BLOCK, (source, el, ctx) => {
      ctx.addChild(new PurchasesBlock(el, this.app, source, ctx, () => this.settings.pennyWalletFolder ?? ''))
    })
    // ```insights``` in a note: one dashboard card ("Copy as embed" on a card writes it)
    this.registerMarkdownCodeBlockProcessor(EMBED_BLOCK, (source, el, ctx) => {
      ctx.addChild(new EmbedBlock(el, this.app, source, () => this.settings))
    })
    this.addCommand({
      id: 'insert-purchases',
      name: 'Insert purchases block',
      editorCallback: (editor: Editor) => editor.replaceSelection(`\`\`\`${PURCHASES_BLOCK}\n\`\`\`\n`),
    })
  }

  // Called by Obsidian when data.json changes on disk, e.g. synced from another device.
  async onExternalSettingsChange() {
    await this.loadSettings()
    this.refreshViews()
  }

  async loadSettings() {
    this.settings = migrateSettings((await this.loadData()) as Record<string, unknown> | null)
  }

  async saveSettings() {
    await this.saveData(this.settings)
    this.refreshViews()
  }

  private refreshViews() {
    this.app.workspace.getLeavesOfType(INSIGHTS_VIEW_TYPE).forEach((leaf: WorkspaceLeaf) => {
      if (leaf.view instanceof InsightsView) leaf.view.render()
    })
  }

  private async openDashboard() {
    const leaf = this.app.workspace.getLeavesOfType(INSIGHTS_VIEW_TYPE)[0] ?? this.app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: INSIGHTS_VIEW_TYPE, active: true })
    void this.app.workspace.revealLeaf(leaf)
  }
}

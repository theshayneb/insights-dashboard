import { Plugin, WorkspaceLeaf } from 'obsidian'
import { DEFAULT_SETTINGS, InsightsSettings, InsightsSettingTab } from './settings'
import { InsightsView, INSIGHTS_VIEW_TYPE } from './view/InsightsView'

export default class InsightsDashboardPlugin extends Plugin {
  settings: InsightsSettings = { ...DEFAULT_SETTINGS }

  async onload() {
    await this.loadSettings()

    this.registerView(INSIGHTS_VIEW_TYPE, (leaf) => new InsightsView(leaf, this))
    this.addRibbonIcon('smile', 'Open insights dashboard', () => { void this.openDashboard() })
    this.addCommand({ id: 'open', name: 'Open dashboard', callback: () => { void this.openDashboard() } })
    this.addSettingTab(new InsightsSettingTab(this.app, this))
  }

  // Called by Obsidian when data.json changes on disk, e.g. synced from another device.
  async onExternalSettingsChange() {
    await this.loadSettings()
    this.refreshViews()
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<InsightsSettings> | null) }
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

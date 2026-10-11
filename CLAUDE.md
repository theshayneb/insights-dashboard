# Insights Dashboard: notes for Claude Code

An Obsidian plugin (installed with BRAT) with dashboards of how notes' frontmatter properties relate, including properties of linked notes and linked notes grouped by tag (e.g. mood vs. weather, season vs. linked #tea, outfit rating vs. linked #wardrobe_item). Each dashboard reads the notes with a tag, in a folder, or all notes. The owner wants insights into their whole vault (about ten years of notes). The owner is the only user. Its look follows the Overview of the owner's PennyWallet Mod plugin, but it is a separate plugin: don't add it back to PennyWallet Mod.

## Workflow

- Push finished, checked work straight to `main`. No pull requests, no asking first.
- Every change that ships gets a new patch version (0.0.x), released automatically:
  1. Bump the version in `manifest.json`, `package.json` and `package-lock.json` (the top-level `version` and `packages[""].version`), and add it to the top of `versions.json` mapped to `manifest.json`'s `minAppVersion`.
  2. Add a `## [x.y.z] - YYYY-MM-DD` entry at the top of `CHANGELOG.md` (the release notes; the release fails without it).
  3. Commit and push to `main`. `.github/workflows/release.yml` runs the checks, builds, and publishes the release with its tag `x.y.z` (no `v` prefix) and `main.js`, `manifest.json`, `styles.css` attached. Don't push tags yourself. Check that the run passed.
  4. Tell the owner the version number. Don't give them git commands; they use the GitHub web interface.
- Never reuse a version number that was already tagged or released.

## Checks before pushing

```
npm run lint        # eslint (Obsidian rules) + tsc
npm run lint:css
npm test
npm run build
```

## Things to know

- Settings live in the plugin's `data.json` (synced by Obsidian Sync).
- `src/journal.ts` is pure (no Obsidian imports) and unit-tested in `tests/`; the view is `src/view/InsightsView.ts`.
- Dimension ids: a property is its lower-case name (`mood`); a linked note's property is `sotd>artist`; linked notes by tag are `@linked:tea`; dates are `@weekday`, `@season`, `@year`, `@month`.
- Settings hold several dashboards (`dashboards`, `activeDashboard`), each with tabs (`tabs`, `activeTab`) holding a question's tracked/compare/filters/card layout; `migrateSettings` upgrades older data.json shapes, so keep it working for them.
- `src/pennywallet.ts` reads PennyWallet (Mod) month files (`<folder>/YYYY-MM.md`, a Markdown table per month; see PennyWallet's `parseRow` for the column variants) for the `insights-purchases` block in `src/view/PurchasesBlock.ts`.
- The owner's vault has hundreds of properties (many from linked notes): never list them all in the UI; use the picker (`DimensionPicker`: search plus collapsible alphabetical sections from `groupDimensions`).
- CSS classes use the `ins-` prefix. UI text is English and sentence case (the Obsidian lint rules require it).
- Don't give subclasses of Obsidian classes members that may clash with undocumented internals; use an `ins` prefix.

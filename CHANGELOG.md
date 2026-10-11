# Changelog

## [0.0.10] - 2026-10-11

### Added
- Cards in notes: every dashboard card has a **Copy as embed** button (top right of the card, shown on hover). Paste it into any note and the card is drawn there, live from your notes, e.g.
  ````
  ```insights
  notes: #journal_entry
  show: count
  of: Related → #song
  ```
  ````
  Options: `notes` (#tag, folder/ or all), `show` (count, breakdown, trend or links), `of`, `track`, `compare`, `filter: Property = value` (one per line), `range` (3 months, 6 months, 12 months or all), `bars: count`, `title`. Colors chosen on a dashboard for the same notes apply. A block with a mistake says what's wrong.
- Link properties split by the tag of the notes they link to: "Related → #song" counts only the Related links to notes tagged #song. Find them under "Through Related" in the picker.

### Changed
- Ranked "most often" lists use one color.

## [0.0.9] - 2026-10-11

### Changed
- A **+ New dashboard** button next to the dashboard picker (it used to be hidden at the bottom of the picker). The new-dashboard window explains the outfit example and says when the tag or folder is missing instead of doing nothing.

## [0.0.8] - 2026-10-11

### Changed
- The Track, Compare with and Add filter picker is organized into collapsible sections, each sorted alphabetically: **Properties** (the notes' own), **Linked notes by tag**, one **Through …** section per link property (e.g. "Through SOTD": Album, Artist, …), and **Dates**. Each section shows how many it holds; open sections are remembered until Obsidian restarts. Typing in the search box opens every section with a match, and Enter picks the first one.

## [0.0.7] - 2026-10-10

### Added
- Tabs: each dashboard has tabs, one per question (e.g. "Mood", "Teas", "Songs"), each with its own tracked property, comparisons, filters and card layout. **+** adds a tab (pick what it tracks); the active tab's ▾ menu renames, duplicates or removes it. Range, % / Count and colors are shared by a dashboard's tabs.

### Changed
- "Compare with" shows only what you compare with (× to remove) and **+ Add**, which opens a search box over every property, linked property and date, with how many notes have each. "Track" and "Add filter" use the same search instead of long lists.
- Day of week, Season, Month of year and Year breakdowns are half width, so two sit side by side.

### Fixed
- Chosen colors now apply to values with emoji or punctuation: "great" colors "😄 great". Your Great / Good / Okay / Bad colors and their order now show up.

## [0.0.6] - 2026-10-10

### Added
- Purchases block: put
  ````
  ```insights-purchases
  ```
  ````
  in a note (or run "Insert purchases block") to list the PennyWallet transactions whose note links to it (e.g. "[[Masala Chai]] 2 tins") or that are tagged with its name (e.g. `masala_chai`); aliases count too. It shows how many times you bought it, the total, when you last did, how often you usually do and when the next one is due, then the transactions (click one to open its month). Options, one per line: `name: Other name, …`, `tag: tea`, `limit: 50`.
- Settings → PennyWallet folder, if it isn't PennyWallet Mod's own setting.

## [0.0.5] - 2026-10-10

### Added
- Dashboards for any part of the vault: pick one at the top left, or "New dashboard…" for the notes with a tag, in a folder, or all notes. Each dashboard keeps its own choices (what it tracks and compares, filters, cards, colors). Settings → Dashboards lists them, with "Reset layout" and remove.
- Linked notes: a property that links to notes (e.g. `SOTD: [[Song]]`) brings in the linked notes' properties, such as "SOTD → Artist". Notes linked anywhere in a note (properties or text) are grouped by their tags, such as "Linked #tea" or "Linked #wardrobe_item". They're offered under "Linked" in Compare with, and can be tracked too.
- Year, as a date dimension.
- Properties with many values (songs, teas…) get a ranked "most often" list instead of a pie; click one to filter by it.
- When tracking something with more than 10 values, the most common keep their own color and the rest are counted as "Other".

### Changed
- The month chart is now "… over time"; for spans over three years it shows one column per year.
- "Entries" are now "notes" throughout.
- Your journal dashboard keeps everything from before. New dashboards hide the streak tiles and pick what to compare automatically until you change it.

## [0.0.4] - 2026-10-10

### Added
- Mood colors: Great is green, Good yellow, Okay orange and Bad light red, and they come in that order in every chart and legend.
- Customize: a color picker for each value of what you track (moods, weather, …). Values with a chosen color come first, in that order; "Reset colors" goes back to the automatic ones.

## [0.0.3] - 2026-10-10

### Added
- Customize: drag cards by their grip to reorder them, including into the other column (e.g. a pie in the wide column). Each card also has a button to move it to the other column; the ↑/↓ arrows still work. Settings → Reset dashboard layout puts every card back in its default column and order.

### Changed
- Day of week, Season and Month of year breakdowns are upright columns, like the month chart, instead of horizontal bars. In % mode an "All" column comes first to compare with; click a column to filter by it.

## [0.0.2] - 2026-10-10

### Added
- Choose on the dashboard what it shows, saved and synced:
  - **Track**: any property found in your journal notes (Mood, Energy, Weather, …) or a date dimension.
  - **Compare with**: toggle each property, plus Day of week, Season and Month of year.
  - **Bars**: % of each group or entry counts.
  - **Filters**: click a pie slice, a breakdown bar or a "What goes with…" row to narrow everything to it, or use "Add filter". Filters stack (one value per property); "Search these notes" opens them in Obsidian search.
  - **Customize**: hide any card or summary tile (e.g. the streaks), move cards up and down, and bring hidden ones back from the "Hidden" row.
- Properties are found automatically. Settings → Ignored properties leaves some out (tags, aliases and cssclasses by default); Settings → Reset dashboard layout shows everything again.

### Changed
- The mood and compare-with properties moved from Settings to the dashboard; your 0.0.1 choices carry over.

## [0.0.1] - 2026-10-10

### Added
- Insights dashboard (ribbon smiley, or the "Open dashboard" command), laid out like PennyWallet's Overview, for notes tagged `journal_entry`. It charts the Mood property against Activities, Weather, day of week and season:
  - a summary (entries, current and longest streak, most common mood) and the recent entries (click to open);
  - "What goes with your mood": groups where a mood shows up clearly more often than usual;
  - mood by month;
  - 100% bars of the mood mix per activity, weather, weekday and season, each with an "All entries" row to compare against;
  - pies of how often each value comes up (click a slice to search for those notes).
- Range: 3 months, 6 months, 12 months or all.
- Settings: the tag, the mood property, the properties to compare with (comma-separated) and the date property. Without a date property, a date in the file name or the file creation date is used.

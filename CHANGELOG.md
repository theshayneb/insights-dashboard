# Changelog

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

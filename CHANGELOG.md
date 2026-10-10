# Changelog

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

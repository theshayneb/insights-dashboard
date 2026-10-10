# Insights Dashboard

An Obsidian plugin that charts how the properties of your journal notes relate. Out of the box it reads notes tagged `#journal_entry` and compares their **Mood** with **Activities**, **Weather**, the **day of week** and the **season**:

- how often each mood comes up;
- which moods go with which weather, activities, weekdays and seasons (100% bars, compared with all entries);
- "What goes with your mood": the clearest links, e.g. *Weather: Rainy → Sad 53% vs 27% overall*;
- mood by month, streaks, and your recent entries.

## Install with BRAT

1. Install **BRAT** from Community plugins.
2. BRAT → **Add beta plugin** → `theshayneb/insights-dashboard`.
3. Enable **Insights Dashboard**, then click the smiley in the ribbon (or run "Insights Dashboard: Open dashboard").

## Your notes

```yaml
---
tags: journal_entry
date: 2026-10-10
Mood: Happy
Activities: [Gym, Reading]
Weather: Sunny
---
```

- Property names ignore case. Values can be lists or comma-separated text; `[[links]]` show their name.
- Moods can be words or numbers (1–5 is shown low to high). A note with two moods counts half to each.
- The date comes from `date`, else a date in the file name (`2026-10-10`), else the file creation date.
- Seasons are northern-hemisphere (spring is March–May).

## Make it yours, right on the dashboard

- **Track**: pick the property the charts are about (Mood, Energy, …). Every property in your journal notes is listed.
- **Compare with**: toggle which properties (and Day of week, Season, Month of year) it's compared with.
- **Bars**: % of each group, or entry counts.
- **Filters**: click a pie slice or a bar to narrow the whole dashboard to it (e.g. only rainy days); stack several; "Search these notes" opens the matching notes.
- **Customize**: hide any card or summary tile, drag cards around (into either column), restore hidden ones.

Your choices are saved (and synced with Obsidian Sync). The journal tag, the date property and properties to ignore are in **Settings → Insights Dashboard**.

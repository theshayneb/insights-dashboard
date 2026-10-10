# Insights Dashboard

An Obsidian plugin that turns the properties of your notes, and of the notes they link to, into dashboards: how often each value comes up, and what goes with what.

- **Journal:** how often you feel Great, and whether it goes with the weather, your activities, the day of week, the season, or the tea you drank.
- **Songs:** which songs are most often your SOTD, and which artists (through each song note's Artist).
- **Outfits:** of the outfits you rated 🩷, which wardrobe items are in them more often than usual.
- **Teas:** which teas you drink in which season, so you know what to order.

## Install with BRAT

1. Install **BRAT** from Community plugins.
2. BRAT → **Add beta plugin** → `theshayneb/insights-dashboard`.
3. Enable **Insights Dashboard**, then click the smiley in the ribbon (or run "Insights Dashboard: Open dashboard").

## Dashboards

Pick a dashboard at the top left, or **New dashboard…** for the notes with a tag (e.g. `#outfit`), in a folder, or all notes. Each one remembers its own choices.

On a dashboard:

- **Track**: what the charts are about (Mood, Rating, Season, …).
- **Compare with**: what it's compared with: the notes' own properties, **linked** ones, and dates (Day of week, Season, Year, Month of year).
- **Bars**: % of each group, or note counts.
- **Filters**: click a pie slice, a bar or a list row to narrow everything to it; stack several; "Search these notes" opens the matching notes.
- **Customize**: hide cards and tiles, drag cards around (into either column), and pick a color for each value.

### Linked notes

- A property that links to notes, like `SOTD: "[[Blue Song]]"`, brings in the linked notes' properties: **SOTD → Artist**.
- Notes linked anywhere in a note (properties or text) are grouped by their tags: **Linked #tea**, **Linked #wardrobe_item**.

## Purchases from PennyWallet

In any note, add

````
```insights-purchases
```
````

(or run **Insert purchases block**) to see the PennyWallet transactions about it: those whose note links to it, like `[[Masala Chai]] 2 tins`, or that are tagged with its name, like `masala_chai`. You get how many times you bought it, the total, when you last did, how often you usually do and when the next one is due, and the list (click one to open its month).

Options, one per line: `name: Chai, Masala Chai` (match these instead of the note's name), `tag: tea` (also match this tag), `limit: 50` (rows listed).

## Your notes

```yaml
---
tags: journal_entry
date: 2026-10-10
Mood: Great
Weather: Sunny
Tea: "[[Masala Chai]]"
SOTD: "[[Blue Song]]"
---
```

- Property names ignore case. Values can be lists or comma-separated text; `[[links]]` show their name.
- Numbers (1–5) are shown low to high. A note with two values counts half to each.
- A note's date comes from `date`, else a date in the file name (`2026-10-10`), else the file creation date.
- Seasons are northern-hemisphere (spring is March–May).

**Settings → Insights Dashboard** has the dashboards, the date property, and properties to ignore.

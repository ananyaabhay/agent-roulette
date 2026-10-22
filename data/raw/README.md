# Raw pick-rate tables

One `<mapId>.tsv` per map. Paste the agent table from a stats site, add the
header block, run `npm run refresh:maps`.

Both files are committed — the paste and the generated `map-meta.js` — so every
number in the app traces back to a table somebody actually looked at, and a
refresh shows up in the diff as both the source and its effect.

## Sources

- **vstats.gg** — ranked ladder, filterable by map and rank. Closest to how most
  people actually play. Use `# population: ranked ladder`.
- **vlr.gg** — professional, broken down per event per map. Use
  `# population: professional` and name the event in `# source:`.

Neither has a public API. Riot's official endpoints return matches, not
aggregates, so the paste step is permanent.

## Format

```
# patch: 13.08
# date: 2026-10-22
# sample: 634
# source: https://www.vlr.gg/event/agents/2977/vct-2026-americas-stage-2
# population: professional
# intel: Three sites, so a second Controller earns its keep.
Omen	97.9
Killjoy	88.5
Fade	62.2
```

Agent and rate separated by a tab, two spaces, or a comma. Rates are
percentages. Agents below 25% are kept out of the weights; the top four become
the "seen most often" list.

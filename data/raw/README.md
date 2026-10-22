# Raw pick-rate tables

One `<mapId>.tsv` per map. Pasted the agent table from a stats site, add the
header block, run `npm run refresh:maps`.

Both files are committed — the paste and the generated `map-meta.js` — so every
number in the app traces back to a table somebody actually looked at, and a
refresh shows up in the diff as both the source and its effect.

## Sources

- **vstats.gg** — ranked ladder, filterable by map and rank. Closest to how most
  people actually play. Use `# population: ranked ladder`.
- ** [Not using] vlr.gg** — professional, broken down per event per map. Use
  `# population: professional` and name the event in `# source:`.

Neither has a public API. Riot's official endpoints return matches, not
aggregates, so the paste step is permanent.

## Format

```
# patch: 13.08
# date: 2026-10-22
# sample: unknown
# source: https://www.vstats.gg/
# population: ranked ladder
# columns: rank, role, agent, winrate, roundwr, pickrate, kd, performance
# intel: Three sites, so a second Controller earns its keep.
1	Controller	Clove	54.69%	52.40%	50.42%	0.96	278.96
```

Agent and rate separated by a tab, two spaces, or a comma. Rates are
percentages. Agents below 25% are kept out of the weights; the top four become
the "seen most often" list.

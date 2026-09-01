# Agent Roulette

[Launch Agent Roulette](https://ananyaabhay.github.io/agent-roulette/)

Agent Roulette is a lightweight role-aware VALORANT randomiser for real groups of friends. It accounts for who is playing, which agents each saved player owns, agents already locked by outside teammates, distinct-agent rules, role coverage, map-influenced weighting, pins, and limited rerolls.

The app is a static site with no account, backend, database, API key, build step, or runtime package dependency.

## How it works

1. Open **Add player** and choose or create saved players.
2. Review each player’s owned-agent selection and add today’s stack.
3. Mark any known outside teammate picks.
4. Choose a **Roll Style**: **Total Chaos**, **Role Balanced**, or **Map Smart**.
5. Review the always-visible **Team Needs** panel, then press **Lock us in**.
6. Pin results, use a personal reroll, or spend a team redraw.
7. Use **New Match** when the next agent-select begins.

## Saved players and current stack

Saved players stay in this browser and on this device. Each profile has a stable internal ID, display name, and owned-agent list; there is no cloud account or sync. The current stack contains only the saved players participating now.

Removing someone from the current stack does not delete their saved ownership. **Delete profile** is a separate, confirmed permanent action. Duplicate display names are safe because names are not used as IDs. The five data-defined starter agents cannot be disabled.

## Roll styles

### Total Chaos

Total Chaos enforces no role targets. It still requires every assigned agent to be owned, excludes known outside picks, and prevents duplicate agents. Team Needs shows what Role Balanced would conventionally want as reference only; that advisory never affects the roll.

### Role Balanced

Role Balanced applies simple role minimums and maximums to the seats the app currently knows about. Known outside picks count toward those targets. It does not use the remembered map.

### Map Smart

Map Smart keeps every Role Balanced rule hard, then uses a local professional-play snapshot to weight the order in which legal candidates are tried. It is weighted randomness, not a global composition optimiser and not a guarantee that the most-observed agents will appear.

Confidence dampens influence toward neutral while preserving the configured agent weights:

- high confidence: 100% of configured influence;
- medium confidence: 75%;
- low confidence: 45%.

The formula is `1 + ((configuredWeight ** strength) - 1) * confidenceInfluence`. Low-confidence maps still influence the roll, but less than high-confidence maps. Confidence never changes ownership, uniqueness, or role legality.

The selected map is remembered when switching Roll Style. Map Intel and map-related Notes are shown only while Map Smart is active.

## Team Needs, Map Intel, and Notes

- **Match Status** says whether the lineup can be rolled, is blocked, or is locked in.
- **Team Needs** uses the solver’s quota calculation to show required roles, known outside coverage, and unknown outside seats. In Total Chaos it is explicitly advisory.
- **Map Intel** shows the selected map’s professional-data context, strongest observed agents, freshness, sample size, and confidence before a Map Smart roll.
- **Notes** is the single post-roll explanation. Role Balanced explains composition and filled needs; Total Chaos says role advice was not enforced; Map Smart also identifies map-favoured, role/constraint-led, and wildcard outcomes.

Unknown outside seats are never guessed. Mark a pick when the teammate locks. If that pick conflicts with the current lineup, Agent Roulette offers to rebuild a valid lineup without spending a reroll. Impossible changes are rejected rather than leaving the Match invalid.

## Match lifecycle and rerolls

- **Lock us in** creates the initial lineup for the active Match.
- A personal **Reroll** changes the requested player. The solver may rearrange other unpinned players around valid pins when necessary.
- **Redraw unpinned** requires every unpinned slot to change.
- Each player has three personal rerolls, and the team has three redraws.
- Failed or no-change attempts spend zero.
- **New Match** clears the lineup and pins and restores every reroll budget.

Changing the current stack or Roll Style during an active Match asks for confirmation, then starts a new Match and clears the current lineup. A conflicting ownership or outside-pick change can be reconciled without spending a reroll.

## Browser storage

- `localStorage` keeps saved players, owned agents, the preferred Roll Style, and the remembered map on this browser and device.
- `sessionStorage` keeps the current stack, outside picks, active lineup, pins, Match number, Roll Style, and rerolls for the current browser tab.

Refreshing the same tab restores the active Match. Closing the tab ends that temporary session. Clearing browser data, private browsing, another browser, or another device can remove or separate saved players because there is no cloud account or sync. Stored values are validated before use, and malformed state fails closed.

## Discord sharing

- **Copy result** copies safely formatted Match text.
- **Open Discord** opens the normal Discord link.

The user chooses a conversation and pastes manually. There is no OAuth, bot, login integration, backend, or automatic posting. Player names are escaped so mention-like and Markdown characters do not unexpectedly ping or format people.

## Solver overview

The production solver builds each player’s legal pool, searches the smallest pool first, randomly orders candidates, prunes branches that cannot still reach role minimums, backtracks when needed, and validates role minimums and maximums at the end. Map Smart only changes candidate ordering.

Game identity and starter flags live in `data/game-data.js`. Role quotas are data-driven and shared by the solver, Team Needs, and filled-need Notes.

## Testing

Run the complete suite with:

```sh
npm test
```

The suite covers storage migration and safety, solver invariants, independent oracle comparisons, seeded fairness simulations, map weighting, UI contracts, and Match transitions. GitHub Actions runs the same command on pushes to `main` and pull requests.

## Limitations

- Role Balanced is a coverage model, not a meta recommendation.
- Map Smart uses a dated professional-play snapshot, not live ranked data.
- Unknown outside picks cannot affect the lineup until someone marks them.
- Saved players do not sync between browsers or devices.
- Discord sharing remains copy-and-paste.
- The local agent roster and map snapshot change only when this repository is updated.

## Disclaimer

Agent Roulette is a fan project. It is not affiliated with or endorsed by Riot Games. VALORANT and agent names are trademarks of Riot Games, Inc. Agent artwork comes from Riot’s Public Content Catalog; the favicon and interface branding are original to this project.

# Agent Roulette

[Launch Agent Roulette](https://ananyaabhay.github.io/agent-roulette/)

Agent Roulette is a lightweight role-aware VALORANT agent randomiser for real groups of friends. It accounts for who is playing today, which agents each saved player owns, agents already locked by outside teammates, distinct-agent rules, role coverage, pins, and a shared three-reroll budget.

V1.3.1 is a usability and production-hardening release. The app remains a static site with no account, backend, database, API key, build step, or runtime package dependency.

## How it works

1. Open **Add player**.
2. Choose an existing saved profile or create a new one.
3. For a new profile, explicitly start with **Default agents only** or **All agents**, then customise ownership.
4. Mark any known outside teammate picks.
5. Choose **Role Balanced** or **Full Chaos** and press **Spin**.
6. Pin results or spend one shared reroll on an individual player or **Redraw unpinned**.
7. Use **New Match** when the next agent-select begins.

## Saved players and current stack

These are deliberately separate concepts:

- **Saved Player Library** contains long-lived profiles on this device. Each profile has a stable internal ID, display name, and owned-agent list.
- **Current Stack** contains only the saved players participating today.

Removing someone from the current stack does not delete their saved ownership. Re-add them later from the library. **Delete profile** is a separate, confirmed permanent action. Duplicate display names are safe because names are not used as IDs.

The five data-defined starter agents cannot be disabled. New profiles never silently assume an ownership model: the person creating the profile sees the starting choice first.

## Modes

### Role Balanced

Role Balanced applies simple role minimums and maximums to the seats the app currently knows about. Known outside picks count toward those targets.

It does **not** use maps, patch meta, win rates, professional pick rates, synergy, or player skill. It aims for sensible coverage; it does not claim to generate an objectively optimal composition.

### Full Chaos

Full Chaos turns role targets off while preserving the hard rules:

- every player must own their assigned agent;
- outside picks cannot be assigned to the stack;
- stack assignments must be distinct.

## Outside teammates and Team Needs

For stacks below five players, the five-seat strip shows:

- current-stack players;
- known outside picks;
- still-unknown outside seats.

**Team Needs** uses the same quota calculation as the solver. It reports which roles the stack must still cover, which are already covered by known outside picks, and which are flexible. It no longer reports how many profiles technically own each role. In Full Chaos it clearly reports that role targets are disabled.

Unknown outside seats are never guessed. Mark a pick when the teammate locks. If that pick conflicts with an active draft, Agent Roulette offers to rebuild a valid draft without spending a reroll. It preserves valid pins and releases only a pin that cannot remain legal. An impossible change is rejected rather than leaving the Match invalid.

## Match lifecycle and rerolls

- **Spin** creates the one initial draft for the active Match.
- An individual **Reroll** changes the requested player. If a direct swap cannot work, the solver may rearrange other unpinned players around valid pins.
- **Redraw unpinned** requires every unpinned slot to change.
- Both successful reroll types spend exactly one token from the same three-reroll budget.
- Failed or no-change attempts spend zero.
- The budget never goes below zero.
- **New Match** clears the draft and pins and restores all three tokens.

Changing current-stack membership starts a new Match after confirmation. A rename, ownership addition, harmless ownership removal, or safe mode/outside-pick change preserves the active draft. A change that makes the draft invalid is reconciled only after confirmation and does not spend a social reroll.

## Browser-local storage

Agent Roulette separates storage by lifespan:

- `localStorage` keeps the Saved Player Library and preferred mode on this browser and device.
- `sessionStorage` keeps the current stack, outside picks, active draft, pins, Match number, mode, and rerolls for the current browser tab.

Refreshing the same tab therefore restores the active Match. Closing the tab ends that temporary session. Clearing browser data, private browsing, another browser, or another device can remove or separate profiles because there is no cloud account or sync.

V1.3 saved profiles migrate automatically. Stored JSON, IDs, agent names, stack size, outside-seat count, draft shape, pins, and reroll values are validated before use. Malformed state fails closed.

## Discord sharing

- **Copy result** copies the formatted Match.
- **Copy & open Discord** copies first, confirms success, and then opens Discord.
- **Open Discord** remains available as a separate normal link.

The user still chooses a conversation and pastes manually. There is no OAuth, bot, login integration, backend, or automatic posting. Player names are escaped in copied Discord text so mention-like and Markdown characters do not unexpectedly ping or format people; the visible name inside Agent Roulette is unchanged.

## Solver overview

The production solver builds each player's legal pool, searches the smallest pool first, randomises candidate order, prunes branches that cannot still reach role minimums, backtracks when needed, and performs a final validation of role minimums and maximums.

Game identity and starter flags live in `data/game-data.js`. Role quotas are data-driven and shared by the solver and Team Needs.

The test-only oracle deliberately uses a slower exhaustive enumeration without the production pruning logic. It compares whether both implementations classify reduced randomized cases as solvable or impossible, which can detect production false negatives.

## Testing

Run:

```powershell
npm test
```

The V1.3.1 release suite contains **38 automated tests** and reports:

- **5,000** randomized production-solver regression trials;
- **1,000** independent exhaustive oracle comparisons;
- **50,000** seeded fairness simulations across five scenarios;
- false positives, false negatives, and total oracle mismatches;
- agent symmetry deviations within roles and role-frequency totals.

The measured release result is **38 passing, 0 failing**, with **0 oracle mismatches**. The largest within-role agent deviation in the five fairness scenarios was **11.58%** in the smallest one-player sample. The intentionally Controller-heavy Role Balanced duo distribution is a constraint effect, not agent-order bias. No production randomness rewrite was justified.

GitHub Actions runs the same tests on every push to `main` and every pull request.

## Project structure

```text
agent-roulette/
├── .github/workflows/tests.yml  Push and pull-request test automation
├── data/game-data.js            Agents, starter flags, roles, quotas, constants
├── logic/
│   ├── discord.js               Safe Discord formatting
│   ├── match.js                 Spin, pin, reroll, reconciliation, New Match
│   ├── solver.js                Production constraint solver and Team Needs
│   └── storage.js               Saved-library and active-session validation
├── tests/
│   ├── app-contract.test.js     Security, terminology, metadata, accessibility
│   ├── oracle.test.js           Independent exhaustive reference solver
│   ├── randomness.test.js       Monte Carlo fairness measurements
│   ├── solver.test.js           Solver, Match, reroll, and transition tests
│   └── storage.test.js          Profiles, sessions, migration, Discord safety
├── app.js                       Browser state and safe DOM rendering
├── favicon.svg                  Original Agent Roulette mark
├── index.html                   Accessible page structure and metadata
├── styles.css                   Responsive visual system
└── package.json                 Test commands; no installed packages required
```

## Limitations

- Role Balanced is a role-coverage model, not a meta recommendation.
- Unknown outside picks cannot affect the draft until someone marks them.
- Profiles do not sync between browsers or devices.
- A static local app cannot enforce honest reroll usage or ownership claims against someone deliberately changing browser data.
- Discord sharing remains copy-and-paste.
- The local agent roster changes only when this repository is updated.

## Future Map Smart roadmap

Map Smart is deliberately **not part of V1.3.1**. A later release may add versioned map identity and sourced preference data as a separate recommendation layer. It must not turn map opinions into solver legality rules or claim AI authority without evidence.

No map selector, map weights, meta scoring, live statistics, AI recommendations, LLM integration, or synergy recommendations are implemented here.

## Disclaimer

Agent Roulette is a fan project. It is not affiliated with or endorsed by Riot Games. VALORANT and agent names are trademarks of Riot Games, Inc. The favicon and interface branding are original to this project and do not use Riot artwork.

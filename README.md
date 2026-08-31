# Agent Roulette

Agent Roulette is a lightweight pre-game VALORANT agent randomiser for friends who do not all own the same agents. It accounts for each stack player's unlocked pool, removes agents already locked by outside teammates, and can build a role-aware composition without assigning duplicate agents.

This is a static website. It has no account system, backend, database, API key, package dependency, or build step. It is suitable for GitHub Pages.

## What V1.3 does

- Supports solo players through five-stacks.
- Stores player names and unlocked-agent selections in this browser on this device.
- Keeps default agents enabled as data-defined starter unlocks.
- Excludes known outside teammate picks from every stack player's pool.
- Counts known outside picks toward the role targets.
- Explains live **Team Needs** using the same quotas as the solver.
- Offers **Role Balanced** and **Full Chaos** modes.
- Uses one shared budget of three rerolls for individual rerolls and Redraw unpinned.
- Separates Spin, Reroll, and New Round so Spin cannot be repeated inside an active round.
- Copies a Discord-ready result and provides a normal link to open Discord.

## How the modes work

### Role Balanced

Role Balanced uses the ownership and outside-pick information supplied on the page. It applies simple role minimums and maximums for the number of currently accounted-for seats.

It does **not** use the selected map, current patch meta, win rates, professional pick rates, agent synergy, or player skill. It is trying to produce sensible role coverage, not claim an objectively optimal composition.

### Full Chaos

Full Chaos disables role targets. It still respects the hard rules:

- a player must own the assigned agent;
- an outside teammate's agent cannot be assigned;
- no two stack players receive the same agent.

## Outside teammate picks

For stacks smaller than five, open **Other teammate picks** after an outside teammate locks an agent. Known picks are removed from stack pools and their roles count toward Role Balanced.

Unknown outside picks are allowed. The page shows how many outside seats are known so the limitation is visible without blocking Spin. The whole section disappears for a five-stack.

## Rounds and rerolls

- **Spin** generates the first and only initial draft for the current round.
- **Reroll** changes one player's agent and spends one shared reroll. If a single swap is impossible, the solver may rearrange other unpinned players around pinned assignments.
- **Redraw unpinned** changes every unpinned slot and spends one shared reroll.
- A failed reroll or redraw does not spend a token.
- **New Round** clears the draft and pins, then restores all three rerolls.

## Saved data

Player profiles have stable internal IDs. Display names are not used as database keys.

The app saves only:

- player IDs and display names;
- unlocked-agent selections;
- the last selected mode.

The current draft, outside picks, pins, round number, and reroll budget are intentionally not saved. Use **Reset saved player data** to clear the stored profiles on that browser.

`localStorage` is device-local. Clearing browser data, using private browsing, changing browsers, or changing devices can remove or separate these profiles. There is no cloud account or sync.

## Project structure

```text
agent-roulette/
├── index.html              Page structure and accessible controls
├── styles.css             Existing editorial/industrial visual language
├── app.js                 Browser state, safe DOM rendering, persistence and events
├── data/
│   └── game-data.js       Agents, starter flags, roles, quotas and product constants
├── logic/
│   ├── solver.js          Pure constrained-player-first backtracking solver
│   ├── round.js           Spin, pin, reroll, redraw and New Round lifecycle
│   └── storage.js         Saved-profile validation and serialization
├── tests/
│   └── solver.test.js     Deterministic regression and randomized stress tests
└── package.json           The test command; no packages are installed
```

The solver owns hard constraints. Game identity data is separate. A future recommendation layer can rank otherwise legal candidates without mixing map opinions into correctness rules.

## How the solver works

The solver builds a list of agents each player can legally receive. It starts with the player who has the fewest choices, tries a candidate, and then moves to the next player. If a choice blocks the rest of the team, it backs up and tries another.

During the search it checks whether the remaining players could still cover missing roles. At the end it checks the role minimums again. That final check is important: “a role could still have been filled earlier” is not proof that the completed draft actually filled it.

## Run it locally

Do not double-click `index.html`. Browser security rules can block JavaScript modules opened as local files.

On Windows, open PowerShell in this folder and run:

```powershell
py -m http.server 8000
```

If `py` is not recognised but Python is installed, use:

```powershell
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in a browser. Keep the PowerShell window open while using the app. Press `Ctrl+C` in that window to stop the local server.

No `npm install` command is required.

## Run the tests

Install a current Node.js version if the `node` command is not available. From this folder run either:

```powershell
npm test
```

or the equivalent direct command:

```powershell
node --test
```

The V1.3 suite contains 21 automated tests plus 5,000 seeded randomized cases. It covers ownership, duplicate prevention, outside picks, role minimums and maximums, solo through five-stack, Full Chaos, Team Needs, terminal validation, rerolls, pins, redraws, the reroll floor, New Round, saved-profile sanitation, and the dynamic-HTML safety rule.

The release run completed with 21 passing tests, 0 failures. The randomized cases produced 4,675 valid drafts and 325 correctly reported impossible setups.

## Publish as its own GitHub Pages repository

This is the recommended option. Agent Roulette has its own tests, documentation, data lifecycle, and future roadmap, so a separate repository gives it a clean history and a clear **View Code** destination. Your portfolio can link to the live app.

1. On GitHub, create an empty public repository named `agent-roulette`. Do not add a README on GitHub because this folder already has one.
2. Open PowerShell in this folder.
3. Run these commands one at a time:

```powershell
git init
git add .
git commit -m "Release Agent Roulette v1.3"
git branch -M main
git remote add origin https://github.com/ananyaabhay/agent-roulette.git
git push -u origin main
```

4. On the GitHub repository page, open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select branch **main**, folder **/(root)**, then save.
7. After GitHub finishes publishing, the expected URL is:

```text
https://ananyaabhay.github.io/agent-roulette/
```

GitHub can take a few minutes to show the first deployment. No server or environment variable is required.

### Portfolio links

Use these two destinations in the Agent Roulette project card:

```html
<a href="https://ananyaabhay.github.io/agent-roulette/">Launch App</a>
<a href="https://github.com/ananyaabhay/agent-roulette">View Code</a>
```

Describe it as:

> A role-aware Valorant agent randomiser that accounts for player unlocks, teammate locks and composition constraints.

Use **Launch App**, not “Explore Prototype”.

## Alternative: keep it inside the portfolio repository

The existing portfolio already uses a `projects/` folder, so Agent Roulette can instead be copied to:

```text
projects/agent-roulette/
```

Its live URL would then be:

```text
https://ananyaabhay.github.io/projects/agent-roulette/
```

This is simpler if you want one repository, but Agent Roulette's commits, issues, tests, and code link will be mixed into the portfolio. Do not copy or move it automatically; choose this deliberately.

## When Riot releases a new agent

The public app should keep using local versioned data rather than fetching a third-party API every time someone presses Spin.

1. Confirm the new playable agent and role on Riot's official [Agents page](https://playvalorant.com/en-us/agents/).
2. Open `data/game-data.js`.
3. Add one object in the correct role group:

```js
{ id: "new-agent", name: "New Agent", role: "Controller", starter: false },
```

4. Keep `id` lowercase and stable. Use a hyphen if it contains multiple words. Do not reuse or later rename an ID after profiles have saved it.
5. Set `starter: true` only if the agent is genuinely a default unlock. Starter behaviour comes from this flag; no solver edit is needed.
6. Update `GAME_DATA_VERSION` at the top of the file.
7. Run `npm test`.
8. Run the site locally and confirm the agent appears under the right role and can be selected.
9. Commit and push the change. GitHub Pages will redeploy it.

Do not edit `logic/solver.js` just because the roster size changed. There is no hardcoded “29 agents” rule.

## Future Map Smart version

V1.3 deliberately does not invent map-meta data. A future version can add:

- `data/maps.js` for map identity;
- `data/map-agent-preferences.js` for versioned weights, confidence, reasons, patch, date, and sources;
- `logic/recommendations.js` to rank legal candidates with weighted randomness;
- a map selector and separate **Map Intel** panel;
- a structured **Result Explanation** panel.

The recommendation layer should influence candidate order or probability. It should not turn preferences into hard legality rules or become embedded in the backtracking solver. **Team Needs**, **Map Intel**, and **Result Explanation** should remain separate concepts.

## Limitations

- Role Balanced is a simple role-coverage model, not a meta recommendation.
- Unknown outside picks cannot be accounted for until someone marks them.
- Saved profiles do not sync across browsers or devices.
- Discord is a copy-and-paste workflow. The site cannot post to a channel and does not use OAuth or a bot.
- The local roster changes only when this repository is updated and redeployed.

## Disclaimer

Agent Roulette is a fan project. It is not affiliated with or endorsed by Riot Games. VALORANT and agent names are trademarks of Riot Games, Inc.

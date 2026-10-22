import { AGENTS } from "../data/game-data.js";
import { UPCOMING_AGENTS } from "../data/upcoming.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** How long the "she's here" message lingers before the banner retires. */
export const ARRIVED_GRACE_DAYS = 21;

function daysUntil(releaseDate, now) {
  const release = Date.parse(`${releaseDate}T00:00:00Z`);
  const today = Date.parse(
    `${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`,
  );
  return Math.round((release - today) / DAY_IN_MS);
}

/**
 * What to show about an announced agent, if anything.
 *
 * A "coming soon" banner still saying "coming soon" in December is worse than
 * no banner, so this expires on its own: it counts down, flips to an arrival
 * note on the day, and disappears once the agent is in local data or the grace
 * period runs out. Nobody has to remember to take it down.
 */
export function getUpcomingAgentNotice({
  now = new Date(),
  upcoming = UPCOMING_AGENTS,
  localAgents = AGENTS,
} = {}) {
  const known = new Set(localAgents.map((agent) => agent.name.toLowerCase()));

  for (const agent of upcoming) {
    const inRoster = known.has(agent.name.toLowerCase());
    const days = daysUntil(agent.releaseDate, now);

    // Before release she cannot be in the roster, so being there early would
    // be a mistake — stay quiet rather than announce it.
    if (inRoster && days > 0) continue;
    if (days > 0) {
      return {
        ...agent,
        state: "upcoming",
        days,
        headline:
          days === 1
            ? `${agent.name} arrives tomorrow`
            : `${agent.name} arrives in ${days} days`,
        detail: `${agent.tagline} She is not in the roulette yet — you can't own an agent that hasn't shipped.`,
      };
    }

    if (days > -ARRIVED_GRACE_DAYS) {
      // Three weeks of "she's here", whether or not the roster has caught up,
      // then it retires itself. A launch is worth marking; a banner that is
      // still marking it in December is not.
      return {
        ...agent,
        state: "arrived",
        days,
        headline: `${agent.name} is here`,
        detail: inRoster
          ? `${agent.name} is in the roulette now. Unlock her in game, then tick her on your roster so she can be drawn.`
          : `${agent.name} released on ${agent.releaseDate} and isn't in this build yet. She'll appear once the roster is updated.`,
      };
    }
  }
  return null;
}

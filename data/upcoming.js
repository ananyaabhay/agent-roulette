/**
 * Agents that have been announced but are not yet playable.
 *
 * They deliberately stay out of AGENTS until release. New player rosters
 * default to every agent selected, so an unreleased agent in that list would
 * be assigned to people who cannot possibly pick her.
 *
 * Dates are the Americas release. Other regions follow a day later; the banner
 * says "around" rather than pretending to a timezone it doesn't know.
 */
export const UPCOMING_AGENTS = Object.freeze([
  Object.freeze({
    id: "hush",
    name: "Hush",
    role: "Duelist",
    origin: "Guangdong, China",
    releaseDate: "2026-10-27",
    tagline: "A reality-bending Duelist with telekinesis, arriving with Season 26 Act VI.",
    trailerTitle: "RISE AND FALL // Hush Agent Trailer",
    trailerUrl: "https://www.youtube.com/watch?v=AfcCyTsh4ag",
  }),
]);

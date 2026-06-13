#!/usr/bin/env node
/**
 * Generate market-models/worldcup.json — the CIM prediction-market model for
 * the 2026 FIFA World Cup.
 *
 * The model contains two families of variables, all team-level:
 *
 *   1. Group standings (36 vars): for each of the 12 groups A–L, three
 *      variables — Winner / Runner-up / Third place. The states are the four
 *      teams drawn into that group. All standing variables are independent
 *      clusters (no per-group joint clique); the bracket structure below is
 *      what ties them together.
 *
 *   2. Knockout matches (32 vars): one variable per match from the Round of 32
 *      through the Final, plus the third-place play-off. Each variable's states
 *      are *every team eligible to reach that match* under the official bracket
 *      — for a slot fed by a group Winner/Runner-up that is the four group
 *      teams; for a third-place slot it is the union of the candidate groups;
 *      and for later rounds it is the union of the two feeding matches.
 *
 * Bracket structure (junction-tree cliques): every match ends in a joint
 * clique with the variables that determine its participants, so traders can
 * quote a match conditioned on who actually reaches it. Variables are added
 * in *reverse bracket order* — Final first, Round of 32 last, group standings
 * after the matches — and each one is *absorbed* ('cliques') into the clique
 * of the match its winner feeds (plus, for the second feeder of a pair, the
 * already-added sibling), growing it into {match, feeder1, feeder2}:
 *   - every match also sets newCluster (no members), which creates its own
 *     singleton clique {match} dummy-attached alongside the absorption. This
 *     is load-bearing, not cosmetic: the backend absorbs into the *smallest*
 *     clique containing the requested aliases, so a match's feeders land in
 *     its singleton instead of bloating the already-complete clique above it.
 *     Group Winner/Runner-up variables are leaves — pure absorptions with
 *     newCluster false — so every singleton ends up consumed by a feeder
 *     (except the third-place play-off's, which has none);
 *   - third-place *standings* have no variables at all: a third-place slot
 *     appears in several candidate pools, and a variable shared across
 *     multiple match cliques would create a loop, which a junction *tree*
 *     cannot represent. Third-place eligibility stays encoded in the match
 *     states. The third-place play-off (m103) is fed by the semifinal
 *     *losers* — not winners — so it stays an independent cluster too.
 *
 * Per-variable clique fields (consumed by scripts/seed-worldcup.mjs):
 *   cliques     string[][]  existing cliques the variable is absorbed into
 *   newCluster  boolean     create a new clique containing the variable
 *   members     string[]    existing variables included in the new clique
 *
 * Source data: the 5 Dec 2025 final draw and the published 104-match bracket
 * (Wikipedia: "2026 FIFA World Cup" / "...knockout stage"). Re-run after any
 * edit:  node scripts/build-worldcup-model.mjs
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Final draw (teams listed in draw/pot order; group order is decided on
//     the pitch, so the four teams are simply the variable's states) ---------
const groups = {
  A: ["Mexico", "South Africa", "South Korea", "Czech Republic"],
  B: ["Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland"],
  C: ["Brazil", "Morocco", "Haiti", "Scotland"],
  D: ["United States", "Paraguay", "Australia", "Turkey"],
  E: ["Germany", "Curaçao", "Ivory Coast", "Ecuador"],
  F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
  G: ["Belgium", "Egypt", "Iran", "New Zealand"],
  H: ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
  I: ["France", "Senegal", "Iraq", "Norway"],
  J: ["Argentina", "Algeria", "Austria", "Jordan"],
  K: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
  L: ["England", "Croatia", "Ghana", "Panama"],
};
const GROUP_ORDER = Object.keys(groups); // A .. L

// --- Round of 32 slot definitions (official bracket, matches 73–88) ---------
// slot is {pos:'W'|'RU', g} for a group winner/runner-up, or
//         {pos:'3rd', gs:[...]} for a third-place slot with candidate groups.
const r32 = {
  73: [{ pos: "RU", g: "A" }, { pos: "RU", g: "B" }],
  74: [{ pos: "W", g: "E" }, { pos: "3rd", gs: ["A", "B", "C", "D", "F"] }],
  75: [{ pos: "W", g: "F" }, { pos: "RU", g: "C" }],
  76: [{ pos: "W", g: "C" }, { pos: "RU", g: "F" }],
  77: [{ pos: "W", g: "I" }, { pos: "3rd", gs: ["C", "D", "F", "G", "H"] }],
  78: [{ pos: "RU", g: "E" }, { pos: "RU", g: "I" }],
  79: [{ pos: "W", g: "A" }, { pos: "3rd", gs: ["C", "E", "F", "H", "I"] }],
  80: [{ pos: "W", g: "L" }, { pos: "3rd", gs: ["E", "H", "I", "J", "K"] }],
  81: [{ pos: "W", g: "D" }, { pos: "3rd", gs: ["B", "E", "F", "I", "J"] }],
  82: [{ pos: "W", g: "G" }, { pos: "3rd", gs: ["A", "E", "H", "I", "J"] }],
  83: [{ pos: "RU", g: "K" }, { pos: "RU", g: "L" }],
  84: [{ pos: "W", g: "H" }, { pos: "RU", g: "J" }],
  85: [{ pos: "W", g: "B" }, { pos: "3rd", gs: ["E", "F", "G", "I", "J"] }],
  86: [{ pos: "W", g: "J" }, { pos: "RU", g: "H" }],
  87: [{ pos: "W", g: "K" }, { pos: "3rd", gs: ["D", "E", "I", "J", "L"] }],
  88: [{ pos: "RU", g: "D" }, { pos: "RU", g: "G" }],
};

// --- Round of 16 → Final: each match is fed by two earlier matches ----------
const bracket = {
  89: [74, 77], 90: [73, 75], 91: [76, 78], 92: [79, 80],
  93: [83, 84], 94: [81, 82], 95: [86, 88], 96: [85, 87],
  97: [89, 90], 98: [93, 94], 99: [91, 92], 100: [95, 96],
  101: [97, 98], 102: [99, 100],
  103: [101, 102], // third-place play-off (the two losing semi-finalists)
  104: [101, 102], // final (the two winning semi-finalists)
};

const roundOf = (m) =>
  m <= 88 ? "Round of 32"
  : m <= 96 ? "Round of 16"
  : m <= 100 ? "Quarterfinal"
  : m <= 102 ? "Semifinal"
  : m === 103 ? "Third-Place Play-off"
  : "Final";

const clusterOf = (m) =>
  ({
    "Round of 32": "Round of 32",
    "Round of 16": "Round of 16",
    Quarterfinal: "Quarterfinals",
    Semifinal: "Semifinals",
    "Third-Place Play-off": "Third Place",
    Final: "Final",
  })[roundOf(m)];

// --- Eligibility -------------------------------------------------------------
const slotTeams = (s) =>
  s.pos === "3rd" ? s.gs.flatMap((g) => groups[g]) : groups[s.g];

const slotDesc = (s) =>
  s.pos === "3rd"
    ? `Third place (Group ${s.gs.join("/")})`
    : `${s.pos === "W" ? "Winner" : "Runner-up"} Group ${s.g}`;

const eligCache = {};
function matchTeams(m) {
  if (eligCache[m]) return eligCache[m];
  const set = r32[m]
    ? new Set([...slotTeams(r32[m][0]), ...slotTeams(r32[m][1])])
    : new Set([...matchTeams(bracket[m][0]), ...matchTeams(bracket[m][1])]);
  eligCache[m] = set;
  return set;
}

// Stable ordering: walk the draw (group A..L, pot order) and keep eligibles.
const DRAW_ORDER = GROUP_ORDER.flatMap((g) => groups[g]);
const ordered = (set) => DRAW_ORDER.filter((t) => set.has(t));

// --- Bracket cliques ---------------------------------------------------------
// Deterministic feeder aliases of an R32 match (W/RU slots only; third-place
// pool slots cannot be clique members — see header).
const slotAlias = (s) =>
  s.pos === "W" ? `${s.g.toLowerCase()}1`
  : s.pos === "RU" ? `${s.g.toLowerCase()}2`
  : null;
const detFeeders = (m) => r32[m].map(slotAlias).filter(Boolean);

// Group variables are added in group/position order (a1, a2, a3, b1, ...).
const addOrder = (alias) =>
  GROUP_ORDER.indexOf(alias[0].toUpperCase()) * 3 + (parseInt(alias[1], 10) - 1);

// Match each knockout match feeds with its winner. The third-place play-off
// (103) is fed by the semifinal losers, so it creates no winner link.
const feeds = {};
for (const [n, fs] of Object.entries(bracket)) {
  if (Number(n) === 103) continue;
  for (const f of fs) feeds[f] = Number(n);
}

// Matches are inserted in descending order, so the higher-numbered sibling of
// a feeder pair is already present: the first feeder absorbs into the next
// match's singleton {next}, the second into the resulting {next, sibling}.
const matchClique = (m) => {
  const n = feeds[m];
  if (!n) return []; // the Final and the third-place play-off
  const sibling = bracket[n].find((f) => f !== m);
  return sibling > m ? [[`m${n}`, `m${sibling}`]] : [[`m${n}`]];
};

// Group Winner/Runner-up variables absorb into the R32 match they feed (the
// matches are already present). For two-feeder matches the later-added feeder
// joins {match, earlier}, completing the clique {match, f1, f2}.
const feederClique = {};
for (const m of Object.keys(r32)) {
  const feeders = detFeeders(m).sort((a, b) => addOrder(a) - addOrder(b));
  if (feeders.length >= 1) feederClique[feeders[0]] = [[`m${m}`]];
  if (feeders.length === 2) feederClique[feeders[1]] = [[`m${m}`, feeders[0]]];
}

// --- Build variables ---------------------------------------------------------
const variables = [];

// Knockout matches, in reverse bracket order (Final first). Each match joins
// the clique of the match its winner feeds.
const knockoutMatches = [
  ...Object.keys(r32).map(Number),
  ...Object.keys(bracket).map(Number),
].sort((a, b) => b - a);

for (const m of knockoutMatches) {
  const round = roundOf(m);
  let description;
  if (r32[m]) {
    description = `${round} winner (Match ${m}): ${slotDesc(r32[m][0])} vs ${slotDesc(r32[m][1])}. States are every team eligible to reach this match.`;
  } else if (m === 103) {
    description = `Third-place play-off winner (Match 103): loser of Semifinal 101 vs loser of Semifinal 102.`;
  } else {
    const [a, b] = bracket[m];
    description = `${round} winner (Match ${m}): winner of Match ${a} vs winner of Match ${b}. States are every team eligible to reach this match.`;
  }
  variables.push({
    alias: `m${m}`,
    name: `${round} — Match ${m}`,
    description,
    category: "knockout",
    tags: ["world cup", round.toLowerCase(), `match ${m}`],
    cluster: clusterOf(m),
    states: ordered(matchTeams(m)),
    cliques: matchClique(m),
    newCluster: true,
    members: [],
  });
}

// Group standings, after the matches: Winner/Runner-up variables absorb into
// the R32 match they feed. No third-place variables — see header.
const POS = [
  ["1", "Winner", "winner"],
  ["2", "Runner-up", "runner-up"],
];
for (const g of GROUP_ORDER) {
  for (const [n, label, phrase] of POS) {
    const alias = `${g.toLowerCase()}${n}`;
    variables.push({
      alias,
      name: `Group ${g} — ${label}`,
      description: `Which team finishes ${phrase} of Group ${g} (${groups[g].join(", ")}).`,
      category: "group",
      tags: ["world cup", `group ${g.toLowerCase()}`, phrase],
      cluster: `Group ${g}`,
      states: groups[g].slice(),
      cliques: feederClique[alias] || [],
      newCluster: false,
      members: [],
    });
  }
}

// --- Emit --------------------------------------------------------------------
const model = {
  $comment:
    "2026 FIFA World Cup prediction market. Generated by scripts/build-worldcup-model.mjs from the final draw and the official 104-match bracket. 32 knockout-match variables (Round of 32 → Final + third-place play-off; states = every team eligible to reach that match per the bracket) followed by 24 group-standing variables (Winner/Runner-up for each group A–L; states = the four group teams). Variables are listed in add order: matches in reverse bracket order (Final first), then groups. Each variable is absorbed ('cliques') into the clique of the match its winner feeds — plus the already-added sibling feeder for the second of a pair — growing it into {match, feeder1, feeder2}. Matches also set 'newCluster' (no 'members'), creating their own singleton clique, which is where their feeders absorb later (the backend picks the smallest clique containing the requested aliases); group variables are leaves and absorb only. No third-place standing variables (they would appear in several match cliques, creating a junction-tree loop; third-place eligibility stays in the match states); the third-place play-off (fed by semifinal losers, not winners) stays an independent cluster.",
  b: "0.001",
  ammDeposit: "1.0",
  variables,
};

const outPath = resolve(__dirname, "../market-models/worldcup.json");
writeFileSync(outPath, JSON.stringify(model, null, 2) + "\n");

const groupCount = variables.filter((v) => v.category === "group").length;
const koCount = variables.filter((v) => v.category === "knockout").length;
const maxStates = Math.max(...variables.map((v) => v.states.length));
const linked = variables.filter((v) => v.cliques.length > 0).length;
console.log(
  `Wrote ${outPath}\n  ${variables.length} variables (${koCount} knockout + ${groupCount} group), max states = ${maxStates}, ${linked} linked into the bracket tree`,
);

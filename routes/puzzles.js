const express = require("express");
const router = express.Router();

const { withDb } = require("../lib/db");
const { todayStr } = require("../lib/dates");
const { actorId } = require("../lib/actor");
const config = require("../config");
const asyncHandler = require("../lib/asyncHandler");

/**
 * Strips answer-bearing / spoiler fields before a puzzle ever reaches the
 * browser. `penpaShare` fully encodes the puzzle AND its solution (that's
 * how penpa's answer-check works), so it's the one field that must never
 * be sent until /:id/play explicitly hands it out post-release.
 * Everything else here is safe to list in an archive.
 */
function publicPuzzle(p) {
  // textPuzzle/textAnswer are excluded here for the same reason
  // penpaShare is: they're alternative ways of presenting/verifying the
  // actual puzzle (used when there's no penpa link), so they're held
  // back until /play (and, for textAnswer, verified only via /answer —
  // its actual value is never sent to the client at all).
  const { penpaShare, successMessage, textPuzzle, textAnswer, ...rest } = p;
  // Defensive defaults for puzzles saved before `extras` existed.
  rest.rules = rest.rules || { text: "", images: [] };
  rest.extras = rest.extras || { text: "", images: [] };
  return rest;
}

function isReleased(puzzle, today) {
  return puzzle && puzzle.date <= today;
}

// Solve count + average solve time for one puzzle, for the archive's
// sort-by-popularity / sort-by-time options. Only completions with a
// recorded timeMs count toward the average (a completion can have a
// null timeMs if there was no matching /play start record). Counts
// anonymous and signed-in solves the same way — both are just entries
// in db.completions, keyed by whatever actorId() produced at the time.
function puzzleSolveStats(db, puzzleId) {
  const completions = db.completions.filter((c) => c.puzzleId === puzzleId);
  const timed = completions.filter((c) => typeof c.timeMs === "number");
  const avgTimeMs = timed.length
    ? Math.round(timed.reduce((sum, c) => sum + c.timeMs, 0) / timed.length)
    : null;
  return { solveCount: completions.length, avgTimeMs };
}

// Current streak (consecutive released days ending at the most recent
// released puzzle) + lifetime solve count, for the solved banner / share
// text. `uid` is whatever actorId() returned — a real user id or an
// "anon:..." id — so this works identically either way.
function computeActorStats(db, uid) {
  const today = todayStr(config.RELEASE_TIMEZONE);
  const released = db.puzzles
    .filter((p) => p.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  let streak = 0;
  for (let i = released.length - 1; i >= 0; i--) {
    const solved = db.completions.some((c) => c.userId === uid && c.puzzleId === released[i].id);
    if (solved) streak++;
    else break;
  }

  const totalSolved = db.completions.filter((c) => c.userId === uid).length;
  return { streak, totalSolved };
}

// Records a completion the first time it's called for a given
// actor+puzzle; subsequent calls just return the original, unchanged —
// this is what makes replays/reset-and-resolve never alter a recorded
// time, whether triggered by /complete or /answer below. `uid` is
// whatever actorId() returned.
function recordCompletionIfNeeded(db, uid, puzzle, auto) {
  const existing = db.completions.find((c) => c.userId === uid && c.puzzleId === puzzle.id);
  if (existing) return { completion: existing, alreadyRecorded: true };

  const start = db.starts.find((s) => s.userId === uid && s.puzzleId === puzzle.id);
  const startedAt = start ? new Date(start.startedAt) : null;
  const solvedAt = new Date();
  const completion = {
    userId: uid,
    puzzleId: puzzle.id,
    solvedAt: solvedAt.toISOString(),
    timeMs: startedAt ? solvedAt.getTime() - startedAt.getTime() : null,
    auto,
  };
  db.completions.push(completion);
  return { completion, alreadyRecorded: false };
}

// Case/whitespace-insensitive comparison for text-answer puzzles — exact
// formatting shouldn't matter for a typed word/phrase answer.
function normalizeAnswer(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// GET /api/puzzles/today — today's puzzle (or most recent released one)
router.get("/today", asyncHandler(async (req, res) => {
  const today = todayStr(config.RELEASE_TIMEZONE);
  const puzzle = await withDb((db) => {
    const released = db.puzzles
      .filter((p) => p.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!released.length) return null;
    return released.find((p) => p.date === today) || released[released.length - 1];
  });
  if (!puzzle) return res.status(404).json({ error: "No puzzles have been released yet." });
  res.json({ puzzle: publicPuzzle(puzzle), isExactlyToday: puzzle.date === today });
}));

// GET /api/puzzles — archive list. Anything dated after "today" (server
// clock) is simply never included in the response — not hidden by the
// client, never sent at all. Solved-status reflects the current visitor
// whether they're signed in or anonymous.
router.get("/", asyncHandler(async (req, res) => {
  const today = todayStr(config.RELEASE_TIMEZONE);
  const uid = actorId(req);
  const list = await withDb((db) => {
    const released = db.puzzles
      .filter((p) => p.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date));
    return released.map((p) => {
      const completion = uid ? db.completions.find((c) => c.userId === uid && c.puzzleId === p.id) : null;
      return {
        ...publicPuzzle(p),
        solved: !!completion,
        solvedAt: completion ? completion.solvedAt : null,
        timeMs: completion ? completion.timeMs : null,
        ...puzzleSolveStats(db, p.id),
      };
    });
  });
  res.json({ puzzles: list, today });
}));

// GET /api/puzzles/:id — metadata, rules, and extras (no penpaShare).
// Used by both rules.html (before playing) and solve.html (alongside the
// puzzle, for the rules-below-the-grid section).
router.get("/:id", asyncHandler(async (req, res) => {
  const today = todayStr(config.RELEASE_TIMEZONE);
  const uid = actorId(req);
  const result = await withDb((db) => {
    const puzzle = db.puzzles.find((p) => p.id === req.params.id);
    if (!isReleased(puzzle, today)) return null;
    const completion = uid ? db.completions.find((c) => c.userId === uid && c.puzzleId === puzzle.id) : null;
    return {
      ...publicPuzzle(puzzle),
      solved: !!completion,
      solvedAt: completion ? completion.solvedAt : null,
      timeMs: completion ? completion.timeMs : null,
    };
  });
  if (!result) return res.status(404).json({ error: "This puzzle isn't available yet." });
  res.json({ puzzle: result });
}));

// POST /api/puzzles/:id/play — the ONLY endpoint that returns the actual
// penpa share string. Works for anonymous visitors too (actorId() falls
// back to their anon_id cookie) — no account required to play. Requires
// the puzzle to be released as of the server's clock. Also records
// (once) the server-side start time used to compute solve duration
// authoritatively in /complete below.
router.post("/:id/play", asyncHandler(async (req, res) => {
  const uid = actorId(req);
  if (!uid) return res.status(401).json({ error: "Couldn't identify this session — try reloading." });
  const today = todayStr(config.RELEASE_TIMEZONE);

  const result = await withDb((db) => {
    const puzzle = db.puzzles.find((p) => p.id === req.params.id);
    if (!isReleased(puzzle, today)) return { error: "This puzzle isn't available yet." };

    let start = db.starts.find((s) => s.userId === uid && s.puzzleId === puzzle.id);
    if (!start) {
      start = { userId: uid, puzzleId: puzzle.id, startedAt: new Date().toISOString() };
      db.starts.push(start);
    }

    const completion = db.completions.find((c) => c.userId === uid && c.puzzleId === puzzle.id);

    return {
      penpaShare: puzzle.penpaShare || "",
      textPuzzle: puzzle.textPuzzle || "",
      // Tells the client to render an answer-input box, WITHOUT ever
      // sending the actual answer — that's only ever compared
      // server-side, in /answer below.
      hasTextAnswer: !!puzzle.textAnswer,
      successMessage: puzzle.successMessage || "Congratulations",
      startedAt: start.startedAt,
      alreadySolved: !!completion,
      solvedAt: completion ? completion.solvedAt : null,
      // So a replay of an already-solved puzzle can show "first solved in
      // M:SS" without the timer live-counting (that time is locked in).
      timeMs: completion ? completion.timeMs : null,
      // Only needed when already solved (so revisiting can show the
      // solved banner immediately, streak included) — cheap enough to
      // just always compute rather than branch on it.
      stats: computeActorStats(db, uid),
    };
  });

  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

// POST /api/puzzles/:id/complete — called by the client the moment
// solve-detect.js sees a solve (including on a reset/replay of an
// already-solved puzzle). Duration is computed server-side from the
// /play start time, not trusted from the client. A puzzle can only be
// completed ONCE per actor — replaying and re-triggering this endpoint
// just hands back the original completion instead of overwriting it, so
// resetting the board to re-solve an old puzzle never changes your time.
// No account required — see actorId().
router.post("/:id/complete", asyncHandler(async (req, res) => {
  const uid = actorId(req);
  if (!uid) return res.status(401).json({ error: "Couldn't identify this session — try reloading." });
  const auto = !!(req.body && req.body.auto);

  const result = await withDb((db) => {
    const puzzle = db.puzzles.find((p) => p.id === req.params.id);
    if (!puzzle) return { error: "Unknown puzzle." };

    const { completion, alreadyRecorded } = recordCompletionIfNeeded(db, uid, puzzle, auto);
    return {
      completion,
      alreadyRecorded,
      puzzleTitle: puzzle.title,
      puzzleDate: puzzle.date,
      stats: computeActorStats(db, uid),
    };
  });

  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

// POST /api/puzzles/:id/answer — for text-answer puzzles (competition
// or word puzzles with no grid): the solver types an answer, it's
// checked server-side against `textAnswer` (never sent to the client),
// and a correct answer records the completion in the same step —
// there's no separate "mark as solved" action, since submitting the
// right answer already proves it. No account required — see actorId().
router.post("/:id/answer", asyncHandler(async (req, res) => {
  const uid = actorId(req);
  if (!uid) return res.status(401).json({ error: "Couldn't identify this session — try reloading." });
  const submitted = String((req.body && req.body.answer) || "").trim();
  if (!submitted) return res.status(400).json({ error: "Enter an answer." });

  const today = todayStr(config.RELEASE_TIMEZONE);
  const result = await withDb((db) => {
    const puzzle = db.puzzles.find((p) => p.id === req.params.id);
    if (!isReleased(puzzle, today)) return { error: "This puzzle isn't available yet." };
    if (!puzzle.textAnswer) return { error: "This puzzle isn't set up for answer verification." };

    if (normalizeAnswer(submitted) !== normalizeAnswer(puzzle.textAnswer)) {
      return { correct: false };
    }

    const { completion, alreadyRecorded } = recordCompletionIfNeeded(db, uid, puzzle, true);
    return {
      correct: true,
      completion,
      alreadyRecorded,
      puzzleTitle: puzzle.title,
      puzzleDate: puzzle.date,
      stats: computeActorStats(db, uid),
    };
  });

  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

module.exports = router;

const express = require("express");
const router = express.Router();

const { withDb } = require("../lib/db");
const { todayStr } = require("../lib/dates");
const config = require("../config");
const asyncHandler = require("../lib/asyncHandler");

/**
 * Strips answer-bearing / spoiler fields before a puzzle ever reaches the
 * browser. `penpaShare` fully encodes the puzzle AND its solution (that's
 * how penpa's answer-check works), so it's the one field that must never
 * be sent until /:id/play explicitly hands it out post-release,
 * post-login. Everything else here is safe to list in an archive.
 */
function publicPuzzle(p) {
  // textPuzzle is excluded here for the same reason penpaShare is: it's
  // an alternative way of presenting the actual puzzle content (used
  // when there's no penpa link), so it's held back until /play rather
  // than sent to anyone browsing the archive or reading the rules page.
  const { penpaShare, successMessage, textPuzzle, ...rest } = p;
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
// null timeMs if there was no matching /play start record).
function puzzleSolveStats(db, puzzleId) {
  const completions = db.completions.filter((c) => c.puzzleId === puzzleId);
  const timed = completions.filter((c) => typeof c.timeMs === "number");
  const avgTimeMs = timed.length
    ? Math.round(timed.reduce((sum, c) => sum + c.timeMs, 0) / timed.length)
    : null;
  return { solveCount: completions.length, avgTimeMs };
}

// Current streak (consecutive released days ending at the most recent
// released puzzle) + lifetime solve count, for the solved banner / share text.
function computeUserStats(db, userId) {
  const today = todayStr(config.RELEASE_TIMEZONE);
  const released = db.puzzles
    .filter((p) => p.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  let streak = 0;
  for (let i = released.length - 1; i >= 0; i--) {
    const solved = db.completions.some((c) => c.userId === userId && c.puzzleId === released[i].id);
    if (solved) streak++;
    else break;
  }

  const totalSolved = db.completions.filter((c) => c.userId === userId).length;
  return { streak, totalSolved };
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
// client, never sent at all.
router.get("/", asyncHandler(async (req, res) => {
  const today = todayStr(config.RELEASE_TIMEZONE);
  const list = await withDb((db) => {
    const released = db.puzzles
      .filter((p) => p.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date));
    return released.map((p) => {
      const completion = req.user
        ? db.completions.find((c) => c.userId === req.user.id && c.puzzleId === p.id)
        : null;
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
  const result = await withDb((db) => {
    const puzzle = db.puzzles.find((p) => p.id === req.params.id);
    if (!isReleased(puzzle, today)) return null;
    const completion = req.user
      ? db.completions.find((c) => c.userId === req.user.id && c.puzzleId === puzzle.id)
      : null;
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
// penpa share string. Requires login (so progress can be tracked) and
// requires the puzzle to be released as of the server's clock. Also
// records (once) the server-side start time used to compute solve
// duration authoritatively in /complete below.
router.post("/:id/play", asyncHandler(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Sign in to play and track your progress." });
  const today = todayStr(config.RELEASE_TIMEZONE);

  const result = await withDb((db) => {
    const puzzle = db.puzzles.find((p) => p.id === req.params.id);
    if (!isReleased(puzzle, today)) return { error: "This puzzle isn't available yet." };

    let start = db.starts.find((s) => s.userId === req.user.id && s.puzzleId === puzzle.id);
    if (!start) {
      start = { userId: req.user.id, puzzleId: puzzle.id, startedAt: new Date().toISOString() };
      db.starts.push(start);
    }

    const completion = db.completions.find((c) => c.userId === req.user.id && c.puzzleId === puzzle.id);

    return {
      penpaShare: puzzle.penpaShare || "",
      textPuzzle: puzzle.textPuzzle || "",
      successMessage: puzzle.successMessage || "Congratulations",
      startedAt: start.startedAt,
      alreadySolved: !!completion,
      solvedAt: completion ? completion.solvedAt : null,
      // So a replay of an already-solved puzzle can show "first solved in
      // M:SS" without the timer live-counting (that time is locked in).
      timeMs: completion ? completion.timeMs : null,
    };
  });

  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

// POST /api/puzzles/:id/complete — called by the client the moment
// solve-detect.js sees a solve (including on a reset/replay of an
// already-solved puzzle). Duration is computed server-side from the
// /play start time, not trusted from the client. A puzzle can only be
// completed ONCE per user — replaying and re-triggering this endpoint
// just hands back the original completion instead of overwriting it, so
// resetting the board to re-solve an old puzzle never changes your time.
router.post("/:id/complete", asyncHandler(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Sign in to save your progress." });
  const auto = !!(req.body && req.body.auto);

  const result = await withDb((db) => {
    const puzzle = db.puzzles.find((p) => p.id === req.params.id);
    if (!puzzle) return { error: "Unknown puzzle." };

    const existing = db.completions.find((c) => c.userId === req.user.id && c.puzzleId === puzzle.id);
    let completion, alreadyRecorded;

    if (existing) {
      completion = existing;
      alreadyRecorded = true;
    } else {
      const start = db.starts.find((s) => s.userId === req.user.id && s.puzzleId === puzzle.id);
      const startedAt = start ? new Date(start.startedAt) : null;
      const solvedAt = new Date();
      completion = {
        userId: req.user.id,
        puzzleId: puzzle.id,
        solvedAt: solvedAt.toISOString(),
        timeMs: startedAt ? solvedAt.getTime() - startedAt.getTime() : null,
        auto,
      };
      db.completions.push(completion);
      alreadyRecorded = false;
    }

    return {
      completion,
      alreadyRecorded,
      puzzleTitle: puzzle.title,
      puzzleDate: puzzle.date,
      stats: computeUserStats(db, req.user.id),
    };
  });

  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

module.exports = router;

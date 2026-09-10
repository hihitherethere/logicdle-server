const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { withDb } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { todayStr } = require("../lib/dates");
const config = require("../config");
const asyncHandler = require("../lib/asyncHandler");

router.use(requireAuth);

/**
 * Per-day results, NOT a cumulative score. For every RELEASED puzzle
 * whose day has actually passed (date < today — a puzzle dated today is
 * deliberately excluded, so solving-in-progress never leaks who's ahead
 * while people are still working on it) this returns that day's
 * completions from THIS leaderboard's members, ranked fastest-to-slowest
 * by actual solve time. There's no AoC-style point system and nothing
 * is summed or carried across days — this is recomputed fresh from
 * `db.puzzles`/`db.completions` on every call, so there's no separate
 * leaderboard-specific history being kept anywhere; once you stop
 * looking at a given day, its ranking isn't "stored" by this feature
 * any more than the underlying completions already were.
 */
function computeDailyResults(db, leaderboard, today) {
  const memberIds = leaderboard.memberIds;
  const pastPuzzles = db.puzzles
    .filter((p) => p.date < today)
    .sort((a, b) => b.date.localeCompare(a.date)); // most recent past day first

  return pastPuzzles
    .map((p) => {
      const results = db.completions
        .filter((c) => c.puzzleId === p.id && memberIds.includes(c.userId) && typeof c.timeMs === "number")
        .sort((a, b) => a.timeMs - b.timeMs)
        .map((c, idx) => {
          const user = db.users.find((u) => u.id === c.userId);
          return { rank: idx + 1, username: user ? user.username : "(unknown)", timeMs: c.timeMs };
        });
      return { puzzleId: p.id, date: p.date, title: p.title, results };
    })
    .filter((day) => day.results.length > 0); // skip days nobody on this leaderboard solved
}

function newJoinCode() {
  // Short, human-typeable code — uppercase letters + digits, no ambiguous
  // characters (0/O, 1/I) to avoid transcription mistakes when sharing it.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

function summarize(lb, userId) {
  return {
    id: lb.id,
    name: lb.name,
    ownerUsername: lb.ownerUsername,
    isOwner: lb.ownerId === userId,
    joinCode: lb.joinCode, // visible to any member, same as AoC — anyone can invite others
    memberCount: lb.memberIds.length,
    createdAt: lb.createdAt,
  };
}

// POST /api/leaderboards — create a new leaderboard. Creator auto-joins.
router.post("/", asyncHandler(async (req, res) => {
  const name = (req.body && req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Give your leaderboard a name." });

  const result = await withDb((db) => {
    let joinCode;
    do { joinCode = newJoinCode(); } while (db.leaderboards.some((l) => l.joinCode === joinCode));

    const lb = {
      id: crypto.randomUUID(),
      name,
      ownerId: req.user.id,
      ownerUsername: req.user.username,
      joinCode,
      memberIds: [req.user.id],
      createdAt: new Date().toISOString(),
    };
    db.leaderboards.push(lb);
    return lb;
  });

  res.status(201).json({ leaderboard: summarize(result, req.user.id) });
}));

// POST /api/leaderboards/join — join an existing leaderboard by its code.
router.post("/join", asyncHandler(async (req, res) => {
  const code = (req.body && req.body.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Enter a join code." });

  const result = await withDb((db) => {
    const lb = db.leaderboards.find((l) => l.joinCode === code);
    if (!lb) return { error: "No leaderboard found with that code." };
    if (!lb.memberIds.includes(req.user.id)) lb.memberIds.push(req.user.id);
    return { leaderboard: lb };
  });

  if (result.error) return res.status(404).json(result);
  res.json({ leaderboard: summarize(result.leaderboard, req.user.id) });
}));

// GET /api/leaderboards/mine — leaderboards the current user belongs to.
router.get("/mine", asyncHandler(async (req, res) => {
  const list = await withDb((db) =>
    db.leaderboards.filter((l) => l.memberIds.includes(req.user.id))
  );
  res.json({ leaderboards: list.map((l) => summarize(l, req.user.id)) });
}));

// GET /api/leaderboards/:id — per-day results (only for days that have
// passed). Members only.
router.get("/:id", asyncHandler(async (req, res) => {
  const today = todayStr(config.RELEASE_TIMEZONE);
  const result = await withDb((db) => {
    const lb = db.leaderboards.find((l) => l.id === req.params.id);
    if (!lb) return { error: "Not found." };
    if (!lb.memberIds.includes(req.user.id)) return { error: "You're not a member of this leaderboard." };
    return { leaderboard: lb, days: computeDailyResults(db, lb, today) };
  });

  if (result.error) return res.status(result.error.includes("member") ? 403 : 404).json(result);
  res.json({ leaderboard: summarize(result.leaderboard, req.user.id), days: result.days });
}));

// POST /api/leaderboards/:id/leave
router.post("/:id/leave", asyncHandler(async (req, res) => {
  const result = await withDb((db) => {
    const lb = db.leaderboards.find((l) => l.id === req.params.id);
    if (!lb) return { error: "Not found." };
    lb.memberIds = lb.memberIds.filter((id) => id !== req.user.id);
    return { ok: true };
  });
  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

module.exports = router;

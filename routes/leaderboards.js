const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { withDb } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../lib/asyncHandler");

router.use(requireAuth);

/**
 * Scoring, matching Advent of Code's local-leaderboard mechanic: for
 * each puzzle, look only at completions from THIS leaderboard's members
 * (not everyone on the site), rank them by how early they solved it
 * (solvedAt timestamp — earliest first), and award points as
 * (member-count-who-solved-it - rank + 1). Sum across every puzzle for
 * each member's total score. This rewards relative standing within your
 * own group, not raw solve speed against the whole site.
 */
function computeStandings(db, leaderboard) {
  const memberIds = leaderboard.memberIds;
  const members = db.users.filter((u) => memberIds.includes(u.id));

  const scoreByUser = {};
  const solvedByUser = {};
  members.forEach((u) => { scoreByUser[u.id] = 0; solvedByUser[u.id] = 0; });

  const relevantCompletions = db.completions.filter((c) => memberIds.includes(c.userId));
  const puzzleIds = Array.from(new Set(relevantCompletions.map((c) => c.puzzleId)));

  puzzleIds.forEach((puzzleId) => {
    const entries = relevantCompletions
      .filter((c) => c.puzzleId === puzzleId)
      .sort((a, b) => new Date(a.solvedAt) - new Date(b.solvedAt));
    const n = entries.length;
    entries.forEach((c, idx) => {
      scoreByUser[c.userId] = (scoreByUser[c.userId] || 0) + (n - idx);
      solvedByUser[c.userId] = (solvedByUser[c.userId] || 0) + 1;
    });
  });

  const standings = members.map((u) => ({
    userId: u.id,
    username: u.username,
    score: scoreByUser[u.id] || 0,
    solved: solvedByUser[u.id] || 0,
  }));
  standings.sort((a, b) => b.score - a.score || b.solved - a.solved || a.username.localeCompare(b.username));
  return standings;
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

// GET /api/leaderboards/:id — full standings. Members only.
router.get("/:id", asyncHandler(async (req, res) => {
  const result = await withDb((db) => {
    const lb = db.leaderboards.find((l) => l.id === req.params.id);
    if (!lb) return { error: "Not found." };
    if (!lb.memberIds.includes(req.user.id)) return { error: "You're not a member of this leaderboard." };
    return { leaderboard: lb, standings: computeStandings(db, lb) };
  });

  if (result.error) return res.status(result.error.includes("member") ? 403 : 404).json(result);
  res.json({ leaderboard: summarize(result.leaderboard, req.user.id), standings: result.standings });
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

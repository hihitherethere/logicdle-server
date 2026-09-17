const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { withDb } = require("../lib/db");
const { hashPassword, verifyPassword, newSessionToken } = require("../lib/auth");
const config = require("../config");
const asyncHandler = require("../lib/asyncHandler");

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  maxAge: 1000 * 60 * 60 * 24 * 90, // 90 days
  // Vercel serves everything over HTTPS, so require secure cookies there;
  // stay flexible for plain-HTTP local dev (`npm start` on localhost).
  secure: process.env.VERCEL === "1" || process.env.NODE_ENV === "production",
};

function publicUser(user) {
  return { username: user.username, isAdmin: !!user.isAdmin };
}

/**
 * Folds progress recorded anonymously (under "anon:<anonId>", from
 * playing puzzles with no account — see lib/actor.js) into a real
 * account, called right after both register and login succeed. The
 * anon_id cookie isn't cleared afterward, so this keeps working across
 * repeated logout/solve-anonymously/login-again cycles on the same
 * browser, not just a one-time transfer at signup.
 *
 * For a puzzle the user already has a start/completion under their real
 * account (e.g. they'd played it once on another device while signed
 * in), the anonymous record is dropped rather than overwriting it — but
 * its data isn't just discarded: whichever of the two is EARLIER wins,
 * so a genuinely earlier anonymous solve/start still ends up as the
 * account's canonical time.
 */
function transferAnonProgress(db, anonId, userId) {
  if (!anonId) return;
  const anonActorId = "anon:" + anonId;

  db.starts = db.starts.filter((s) => {
    if (s.userId !== anonActorId) return true;
    const existing = db.starts.find((s2) => s2.userId === userId && s2.puzzleId === s.puzzleId);
    if (!existing) {
      s.userId = userId;
      return true;
    }
    if (new Date(s.startedAt) < new Date(existing.startedAt)) {
      existing.startedAt = s.startedAt;
    }
    return false; // drop the now-redundant anonymous record
  });

  db.completions = db.completions.filter((c) => {
    if (c.userId !== anonActorId) return true;
    const existing = db.completions.find((c2) => c2.userId === userId && c2.puzzleId === c.puzzleId);
    if (!existing) {
      c.userId = userId;
      return true;
    }
    if (new Date(c.solvedAt) < new Date(existing.solvedAt)) {
      existing.solvedAt = c.solvedAt;
      existing.timeMs = c.timeMs;
      existing.auto = c.auto;
    }
    return false;
  });
}

router.post("/register", asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !/^[a-zA-Z0-9_\-.]{3,32}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-32 characters (letters, numbers, _ - .)." });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const result = await withDb((db) => {
    const taken = db.users.some((u) => u.username.toLowerCase() === username.toLowerCase());
    if (taken) return { error: "That username is already taken." };

    const user = {
      id: crypto.randomUUID(),
      username,
      passwordHash: hashPassword(password),
      isAdmin: config.ADMIN_USERNAMES.includes(username.toLowerCase()),
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);

    const token = newSessionToken();
    db.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };

    transferAnonProgress(db, req.anonId, user.id);

    return { token, user };
  });

  if (result.error) return res.status(400).json({ error: result.error });
  res.cookie("session", result.token, SESSION_COOKIE_OPTS);
  res.status(201).json({ user: publicUser(result.user) });
}));

router.post("/login", asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const result = await withDb((db) => {
    const user = db.users.find((u) => u.username.toLowerCase() === String(username || "").toLowerCase());
    if (!user || !verifyPassword(password || "", user.passwordHash)) {
      return { error: "Incorrect username or password." };
    }
    const token = newSessionToken();
    db.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };

    transferAnonProgress(db, req.anonId, user.id);

    return { token, user };
  });

  if (result.error) return res.status(401).json({ error: result.error });
  res.cookie("session", result.token, SESSION_COOKIE_OPTS);
  res.json({ user: publicUser(result.user) });
}));

router.post("/logout", asyncHandler(async (req, res) => {
  const token = req.cookies && req.cookies.session;
  if (token) await withDb((db) => { delete db.sessions[token]; });
  res.clearCookie("session");
  res.json({ ok: true });
}));

router.get("/me", (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

module.exports = router;

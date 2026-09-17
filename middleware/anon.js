const crypto = require("crypto");

const ANON_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year
  secure: process.env.VERCEL === "1" || process.env.NODE_ENV === "production",
};

/**
 * Runs on every request. Guarantees `req.anonId` is set — reading it
 * from the `anon_id` cookie if present, otherwise generating one and
 * setting the cookie for next time. This is what lets a signed-out
 * visitor start/complete puzzles and have their progress tracked
 * (streaks, "already solved" status) exactly like a signed-in user,
 * without ever creating an account — see lib/actor.js for how routes
 * use this alongside req.user, and routes/auth.js for how this
 * anonymous progress gets folded into a real account on register/login.
 *
 * Synchronous and local (no datastore round-trip), so — unlike
 * attachUser — this doesn't need asyncHandler().
 */
function attachAnonId(req, res, next) {
  let anonId = req.cookies && req.cookies.anon_id;
  if (!anonId) {
    anonId = crypto.randomUUID();
    res.cookie("anon_id", anonId, ANON_COOKIE_OPTS);
  }
  req.anonId = anonId;
  next();
}

module.exports = { attachAnonId };

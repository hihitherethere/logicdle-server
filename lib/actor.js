/**
 * Every route that records or looks up puzzle progress (starts,
 * completions) uses this instead of `req.user.id` directly, so the same
 * code path works for signed-in AND anonymous solvers. Anonymous ids are
 * prefixed ("anon:...") so they can never collide with a real user's
 * UUID, and so routes/auth.js can find them by that prefix when folding
 * anonymous progress into an account on register/login.
 *
 * Returns null only if somehow neither req.user nor req.anonId is set
 * (shouldn't happen in practice — attachAnonId runs on every request —
 * but callers should treat null as "can't identify this visitor" rather
 * than assuming it's always a string).
 */
function actorId(req) {
  if (req.user) return req.user.id;
  if (req.anonId) return "anon:" + req.anonId;
  return null;
}

module.exports = { actorId };

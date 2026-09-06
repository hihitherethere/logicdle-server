const { withDb } = require("../lib/db");
const config = require("../config");

async function getSessionUser(req) {
  const token = req.cookies && req.cookies.session;
  if (!token) return null;
  return withDb((db) => {
    const session = db.sessions[token];
    if (!session) return null;
    const user = db.users.find((u) => u.id === session.userId);
    if (!user) return null;

    // Admin status was previously only ever set at registration time, so
    // editing ADMIN_USERNAMES in .env (and restarting the server) had no
    // effect on accounts that already existed. Re-sync it against the
    // current config on every request instead — withDb() persists this
    // mutation automatically, so it stays in sync going forward too.
    const shouldBeAdmin = config.ADMIN_USERNAMES.includes(user.username.toLowerCase());
    if (user.isAdmin !== shouldBeAdmin) user.isAdmin = shouldBeAdmin;

    return user;
  });
}

// Runs on every request; attaches req.user (or null). Now async, since
// the datastore is a network call — must be wrapped with asyncHandler()
// wherever it's registered (see app.js), or a rejected promise here
// would hang the request instead of surfacing an error.
async function attachUser(req, res, next) {
  req.user = await getSessionUser(req);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in required." });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin };

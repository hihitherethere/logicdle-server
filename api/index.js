// Vercel deploys this as a Serverless Function. An Express app is already
// a valid (req, res) handler, so exporting it directly is all that's
// needed — Vercel's Node.js runtime calls it per-request. vercel.json
// rewrites /api/* here and everything else to the static files in
// /public, so in practice this only ever handles the JSON API routes.
module.exports = require("../app");

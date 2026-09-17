const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

const config = require("./config");
const { attachUser } = require("./middleware/auth");
const { attachAnonId } = require("./middleware/anon");
const asyncHandler = require("./lib/asyncHandler");
const authRoutes = require("./routes/auth");
const puzzleRoutes = require("./routes/puzzles");
const adminRoutes = require("./routes/admin");
const submissionRoutes = require("./routes/submissions");
const leaderboardRoutes = require("./routes/leaderboards");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser(config.COOKIE_SECRET));
app.use(attachAnonId); // sync — assigns an anonymous identity cookie if there isn't one yet
app.use(asyncHandler(attachUser)); // now async — reads from Redis

app.use("/api/auth", authRoutes);
app.use("/api/puzzles", puzzleRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/leaderboards", leaderboardRoutes);

// Static site + (once you clone it in) penpa-edit itself, served
// same-origin so solve-detect.js is allowed to look inside the puzzle
// iframe. On Vercel this also runs, but vercel.json rewrites static
// paths straight to the deployed files first, so this mostly matters
// for local dev (`npm start`) rather than production traffic.
app.use(express.static(path.join(__dirname, "public")));

// JSON error handler (covers multer file-type/size errors, bad JSON body,
// rejected promises forwarded by asyncHandler, etc.)
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(err.status || 400).json({ error: err.message || "Something went wrong." });
});

module.exports = app;

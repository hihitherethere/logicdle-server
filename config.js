require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 3000,
  RELEASE_TIMEZONE: process.env.RELEASE_TIMEZONE || "UTC",
  ADMIN_USERNAMES: (process.env.ADMIN_USERNAMES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  COOKIE_SECRET: process.env.COOKIE_SECRET || "dev-only-insecure-secret-change-me",
};

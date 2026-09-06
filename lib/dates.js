/**
 * Returns "today" as YYYY-MM-DD in the given IANA timezone. This is the
 * single source of truth the server uses to decide which puzzles are
 * released — it's evaluated with the SERVER's clock, not anything sent
 * by the client, which is what makes the release gate real instead of
 * cosmetic.
 */
function todayStr(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Adds `days` (may be negative) to a YYYY-MM-DD date string and returns
 * the result in the same format. Used to auto-place a new puzzle right
 * after the latest one already queued.
 */
function addDays(dateStr, days) {
  var d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { todayStr, addDays };

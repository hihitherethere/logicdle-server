/**
 * Admin/submitters now paste the FULL penpa URL (including the
 * https://.../penpa-edit/ part) rather than being asked to manually
 * trim it down to "everything after the #". This strips that prefix
 * server-side, in the one place every puzzle-content write path goes
 * through, so the stored `penpaShare` is always just the fragment —
 * exactly what solve.html needs for `iframe.src = "/penpa-edit/#" + penpaShare`.
 *
 * Splits on the FIRST "#" only (a URL fragment is everything after that,
 * even if it happens to contain further "#" characters). If there's no
 * "#" at all, the whole trimmed string is returned as-is — so pasting
 * just the bare fragment (the old expected format) still works.
 */
function extractPenpaFragment(raw) {
  const trimmed = String(raw || "").trim();
  const idx = trimmed.indexOf("#");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

module.exports = { extractPenpaFragment };

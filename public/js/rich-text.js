/**
 * Renders user-authored text (puzzle rules, extra content — some of
 * which comes from regular user submissions, not just the admin) with
 * clickable links, without allowing arbitrary HTML/script injection.
 *
 * Everything is HTML-escaped first; the ONLY markup this ever produces
 * is <a> tags it constructs itself, for:
 *   - markdown-style links: [label](https://example.com)
 *   - bare URLs typed directly: https://example.com
 *
 * Only http/https URLs become links — anything else (javascript:,
 * data:, etc.) is left as plain escaped text instead, since there's no
 * legitimate reason a puzzle's rules would need those schemes and
 * allowing them is a classic XSS vector.
 */
window.RichText = (function () {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(el, raw) {
    var escaped = escapeHtml(String(raw || ""));

    // [label](https://...) — both label and url are already HTML-escaped
    // at this point (they're substrings of `escaped`), so it's safe to
    // drop label back in as the link's visible text and url into href.
    escaped = escaped.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi, function (match, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });

    // Bare URLs, e.g. someone just pastes a link with no [label](...).
    // Split on the <a>...</a> tags already created above so this pass
    // never touches text already inside a link (its href or label).
    var parts = escaped.split(/(<a [^>]*>.*?<\/a>)/g);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf("<a ") === 0) continue;
      parts[i] = parts[i].replace(/(https?:\/\/[^\s<]+)/gi, function (url) {
        // Trim trailing punctuation that's almost certainly sentence
        // punctuation rather than part of the URL, e.g. "see https://x.com."
        var trail = "";
        var m = url.match(/[).,!?;:]+$/);
        if (m) {
          trail = m[0];
          url = url.slice(0, -trail.length);
        }
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + "</a>" + trail;
      });
    }

    el.innerHTML = parts.join("");
  }

  return { render: render, escapeHtml: escapeHtml };
})();

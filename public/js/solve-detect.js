/**
 * SOLVE DETECTION
 * ---------------
 * penpa-edit's answer-check is internal to penpa: when a solver's grid
 * matches the setter's solution, penpa pops up its own success message
 * (the puzzle's configured `successMessage`, default "Congratulations").
 * It doesn't emit any event/postMessage to a host page.
 *
 * Because this app self-hosts penpa-edit at /penpa-edit/ (same origin),
 * we can reach into `iframe.contentWindow` and catch that message
 * ourselves by wrapping the native `alert()` penpa calls with it — we
 * still forward the call to the real alert() so the solver sees it too.
 *
 * IMPORTANT: call this AFTER the iframe has already fired its own
 * "load" event (i.e. from inside a `load` listener), not before. It
 * does its setup immediately and synchronously — it does not wait for
 * or attach to any further load event itself. (An earlier version of
 * this file registered its own internal `load` listener here, which
 * meant the hook usually didn't actually attach until a *second*,
 * coincidental load of the same iframe — unreliable across browsers,
 * and the reason solves sometimes went undetected.)
 *
 * A secondary DOM-based fallback watches for newly-inserted elements
 * containing the success text, in case a given penpa version shows the
 * message as an on-page element instead of calling alert(). To avoid
 * false positives from penpa's OWN initial rendering (building the grid
 * causes a burst of unrelated DOM insertions right after load), this
 * fallback:
 *   - only inspects text inside NEWLY ADDED nodes for each mutation,
 *     never the whole page's text — matching anywhere on the page
 *     (including hidden help text, tooltips, etc.) is what caused
 *     false "solved" popups immediately on page load; and
 *   - ignores matches during a short grace period right after setup,
 *     while the puzzle is still finishing its own initial render.
 *
 * Returns true if detection was successfully attached (same-origin),
 * or false if not (e.g. penpa-edit isn't actually self-hosted at
 * /penpa-edit/ yet) — callers should surface that to the user, since
 * there's no other fallback once it fails.
 */
function attachSolveDetection(iframeEl, successMessage, onSolved) {
  var successText = String(successMessage || "Congratulations").toLowerCase();
  var fired = false;
  var armedAt = Date.now();
  var DOM_GRACE_MS = 1500;

  function fire(source, detail) {
    if (fired) return;
    fired = true;
    console.debug("[solve-detect] solve detected via", source, detail || "");
    onSolved({ auto: true, source: source });
  }

  var win;
  try {
    win = iframeEl.contentWindow;
    void win.document.title; // throws if not actually same-origin
  } catch (e) {
    console.warn("[solve-detect] iframe is not same-origin — is penpa-edit self-hosted at /penpa-edit/?");
    return false;
  }

  // Primary: catch penpa's own alert() call.
  var originalAlert = win.alert;
  win.alert = function (msg) {
    try {
      if (String(msg).toLowerCase().indexOf(successText) !== -1) fire("alert", msg);
    } catch (e) { /* ignore */ }
    return originalAlert.apply(win, arguments);
  };

  // Secondary: newly-added DOM text, after an initial grace period.
  try {
    var observer = new win.MutationObserver(function (records) {
      if (fired) return;
      if (Date.now() - armedAt < DOM_GRACE_MS) return;
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          var text = ((node && node.textContent) || "").toLowerCase();
          if (text.indexOf(successText) !== -1) {
            fire("dom", text.slice(0, 80));
            return;
          }
        }
      }
    });
    observer.observe(win.document.body, { childList: true, subtree: true });
  } catch (e) {
    /* alert() hook above still covers the common case */
  }

  return true;
}

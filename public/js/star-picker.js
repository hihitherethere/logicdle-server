/**
 * Difficulty is a 1-5 star rating (replacing the old Easy/Medium/Hard/
 * Insane text tiers). This is the one place both the interactive picker
 * (used in the admin and submission forms) and the read-only renderer
 * (used in the archive, rules page, solve page) live, so there's a
 * single source of truth for what a star rating looks like.
 */
window.StarPicker = (function () {
  function clamp(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(5, n));
  }

  // Wires up a row of `<button class="star" data-star="1..5">` elements
  // inside `containerEl` to set `hiddenInputEl.value`. Returns
  // { setValue } so callers can also set it programmatically (e.g. when
  // loading an existing puzzle into an edit form).
  function init(containerEl, hiddenInputEl, initialValue) {
    var stars = containerEl.querySelectorAll("[data-star]");

    function setValue(n) {
      n = clamp(n);
      hiddenInputEl.value = n || "";
      stars.forEach(function (s) {
        var starN = parseInt(s.getAttribute("data-star"), 10);
        s.classList.toggle("filled", starN <= n);
      });
    }

    stars.forEach(function (s) {
      if (s.disabled) return;
      s.addEventListener("click", function () {
        setValue(s.getAttribute("data-star"));
      });
    });

    setValue(initialValue || 0);
    return { setValue: setValue };
  }

  // Read-only star string for display, e.g. render(3) -> "★★★☆☆".
  function render(n) {
    n = clamp(n);
    return "★".repeat(n) + "☆".repeat(5 - n);
  }

  // The row of star buttons as an HTML string, for building dynamic
  // forms (e.g. the admin submissions review cards, rendered per-row).
  function pickerHtml(fieldName, editable) {
    var stars = [1, 2, 3, 4, 5]
      .map(function (n) {
        return '<button type="button" class="star" data-star="' + n + '"' + (editable ? "" : " disabled") + ">★</button>";
      })
      .join("");
    return (
      '<div class="star-picker" data-star-picker>' + stars + "</div>" +
      '<input type="hidden" data-f="' + fieldName + '">'
    );
  }

  return { init: init, render: render, pickerHtml: pickerHtml };
})();

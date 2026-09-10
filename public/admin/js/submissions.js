(function () {
  var notAdminEl = document.getElementById("not-admin");
  var adminUiEl = document.getElementById("admin-ui");

  Api.get("/api/auth/me").then(function (res) {
    if (!res.user || !res.user.isAdmin) {
      notAdminEl.hidden = false;
      return;
    }
    adminUiEl.hidden = false;
    init();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function statusBadge(status) {
    var label = status.charAt(0).toUpperCase() + status.slice(1);
    return '<span class="status-badge status-' + status + '">' + label + "</span>";
  }

  function init() {
    var statusFilter = document.getElementById("status-filter");
    var listEl = document.getElementById("submissions-list");

    statusFilter.addEventListener("change", load);

    function renderComments(sub, container) {
      container.innerHTML = "";
      (sub.comments || []).forEach(function (c) {
        var div = document.createElement("div");
        div.className = "comment" + (c.isAdmin ? " is-admin" : "");
        div.innerHTML =
          '<div class="who">' + escapeHtml(c.authorUsername) + (c.isAdmin ? " (admin)" : "") + "</div>" +
          "<div>" + escapeHtml(c.text) + "</div>";
        container.appendChild(div);
      });
    }

    function renderCard(sub) {
      var card = document.createElement("div");
      card.className = "submission-card";

      var editable = sub.status === "pending";

      card.innerHTML =
        '<div class="submission-head">' +
          '<div><div class="t">' + escapeHtml(sub.title) + "</div>" +
          '<div class="submission-meta">submitted by ' + escapeHtml(sub.submittedByUsername) + " · " + new Date(sub.submittedAt).toLocaleString() + "</div></div>" +
          statusBadge(sub.status) +
        "</div>" +

        '<div class="field" style="margin-top:14px;"><label>Title</label><input data-f="title" value="' + escapeHtml(sub.title) + '" ' + (editable ? "" : "disabled") + "></div>" +
        '<div class="field"><label>Type</label><input data-f="type" value="' + escapeHtml(sub.type) + '" ' + (editable ? "" : "disabled") + "></div>" +
        '<div class="field"><label>Difficulty</label>' + StarPicker.pickerHtml("difficulty", editable) + "</div>" +
        '<div class="field"><label>Author</label><input data-f="author" value="' + escapeHtml(sub.author) + '" ' + (editable ? "" : "disabled") + "></div>" +
        '<div class="field"><label>Penpa share string</label><textarea data-f="penpaShare" rows="2" ' + (editable ? "" : "disabled") + ">" + escapeHtml(sub.penpaShare || "") + "</textarea></div>" +
        '<div class="field"><label>Text puzzle content</label><textarea data-f="textPuzzle" rows="3" ' + (editable ? "" : "disabled") + ">" + escapeHtml(sub.textPuzzle || "") + "</textarea></div>" +
        '<div class="field"><label>Correct answer (text-verification mode)</label><input data-f="textAnswer" value="' + escapeHtml(sub.textAnswer || "") + '" ' + (editable ? "" : "disabled") + "></div>" +
        '<div class="field"><label>Rules text</label><textarea data-f="rulesText" rows="4" ' + (editable ? "" : "disabled") + ">" + escapeHtml((sub.rules && sub.rules.text) || "") + "</textarea></div>" +
        '<div class="field"><label>Extra content text</label><textarea data-f="extrasText" rows="2" ' + (editable ? "" : "disabled") + ">" + escapeHtml((sub.extras && sub.extras.text) || "") + "</textarea></div>" +

        '<div class="comment-thread" data-comments></div>' +
        '<form class="comment-form" data-comment-form>' +
          '<input type="text" placeholder="Add a comment…" required>' +
          '<button class="btn" type="submit">Send</button>' +
        "</form>" +

        (editable
          ? '<div class="submission-actions">' +
              '<button class="btn" data-act="save">Save changes</button>' +
              '<button class="btn btn-primary" data-act="accept">Accept &amp; publish</button>' +
              '<button class="btn btn-danger" data-act="reject">Reject</button>' +
              '<input type="date" data-accept-date style="margin-left:auto;" title="Optional: pick a specific release date instead of automatic placement">' +
            "</div>"
          : "");

      renderComments(sub, card.querySelector("[data-comments]"));
      StarPicker.init(card.querySelector("[data-star-picker]"), card.querySelector('[data-f="difficulty"]'), sub.difficulty);

      card.querySelector("[data-comment-form]").addEventListener("submit", function (e) {
        e.preventDefault();
        var input = e.target.querySelector("input");
        var text = input.value.trim();
        if (!text) return;
        Api.post("/api/admin/submissions/" + encodeURIComponent(sub.id) + "/comments", { text: text })
          .then(function (res) {
            input.value = "";
            renderComments(res.submission, card.querySelector("[data-comments]"));
          })
          .catch(function (err) { alert(err.message); });
      });

      function collectFields() {
        var fields = {};
        card.querySelectorAll("[data-f]").forEach(function (el) {
          fields[el.getAttribute("data-f")] = el.value;
        });
        return fields;
      }

      if (editable) {
        card.querySelector('[data-act="save"]').addEventListener("click", function () {
          Api.put("/api/admin/submissions/" + encodeURIComponent(sub.id), collectFields())
            .then(function () { load(); })
            .catch(function (err) { alert(err.message); });
        });

        card.querySelector('[data-act="accept"]').addEventListener("click", function () {
          if (!confirm('Publish "' + sub.title + '" as a real puzzle?')) return;
          var dateVal = card.querySelector("[data-accept-date]").value;
          Api.post("/api/admin/submissions/" + encodeURIComponent(sub.id) + "/accept", dateVal ? { date: dateVal } : {})
            .then(function () { load(); })
            .catch(function (err) { alert(err.message); });
        });

        card.querySelector('[data-act="reject"]').addEventListener("click", function () {
          var comment = prompt("Optional reason (shown to the submitter):", "");
          if (comment === null) return; // cancelled
          Api.post("/api/admin/submissions/" + encodeURIComponent(sub.id) + "/reject", { comment: comment })
            .then(function () { load(); })
            .catch(function (err) { alert(err.message); });
        });
      }

      return card;
    }

    function load() {
      var status = statusFilter.value;
      Api.get("/api/admin/submissions" + (status ? "?status=" + encodeURIComponent(status) : ""))
        .then(function (res) {
          listEl.innerHTML = "";
          if (!res.submissions.length) {
            listEl.innerHTML = '<p class="form-note">Nothing here.</p>';
            return;
          }
          res.submissions.forEach(function (sub) { listEl.appendChild(renderCard(sub)); });
        });
    }

    load();
  }
})();

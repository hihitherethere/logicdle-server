(function () {
  var notAdminEl = document.getElementById("not-admin");
  var adminUiEl = document.getElementById("admin-ui");

  Api.get("/api/auth/me").then(function (res) {
    if (!res.user || !res.user.isAdmin) {
      notAdminEl.hidden = false;
      return;
    }
    adminUiEl.hidden = false;
    initAdmin();
  });

  // Renders a row of removable thumbnails for `list` (an array of image
  // URLs) into `container`. `list` is mutated in place (never
  // reassigned) so this stays wired up correctly even after the form is
  // reset or loaded with a different puzzle's images.
  function makeThumbRenderer(container, list) {
    function draw() {
      container.innerHTML = "";
      list.forEach(function (url, idx) {
        var div = document.createElement("div");
        div.className = "thumb";
        div.innerHTML = '<img src="' + url + '" alt=""><button type="button" title="Remove">×</button>';
        div.querySelector("button").addEventListener("click", function () {
          list.splice(idx, 1);
          draw();
        });
        container.appendChild(div);
      });
    }
    return draw;
  }

  function setList(list, newItems) {
    list.length = 0;
    (newItems || []).forEach(function (item) { list.push(item); });
  }

  function initAdmin() {
    var form = document.getElementById("puzzle-form");
    var errorEl = document.getElementById("form-error");
    var saveBtn = document.getElementById("save-btn");
    var formTitle = document.getElementById("form-title");
    var editingIdNote = document.getElementById("editing-id-note");
    var imageInput = document.getElementById("f-image");
    var extrasImageInput = document.getElementById("f-extras-image");
    var puzzleListEl = document.getElementById("puzzle-list");
    var dateModeAuto = document.getElementById("date-mode-auto");
    var dateModeManual = document.getElementById("date-mode-manual");
    var dateInput = document.getElementById("f-date");

    var fields = {
      title: document.getElementById("f-title"),
      type: document.getElementById("f-type"),
      difficulty: document.getElementById("f-difficulty"),
      author: document.getElementById("f-author"),
      share: document.getElementById("f-share"),
      textPuzzle: document.getElementById("f-text-puzzle"),
      textAnswer: document.getElementById("f-answer"),
      success: document.getElementById("f-success"),
      rules: document.getElementById("f-rules"),
      extras: document.getElementById("f-extras"),
    };

    var difficultyPicker = StarPicker.init(document.querySelector("[data-star-picker]"), fields.difficulty, 3);

    var editingId = null; // null = creating a new puzzle
    var rulesImages = [];
    var extrasImages = [];
    var drawRulesThumbs = makeThumbRenderer(document.getElementById("thumb-row"), rulesImages);
    var drawExtrasThumbs = makeThumbRenderer(document.getElementById("extras-thumb-row"), extrasImages);

    function updateDateModeUI() {
      var manual = dateModeManual.checked;
      dateInput.disabled = !manual;
      if (!manual) dateInput.value = "";
    }
    dateModeAuto.addEventListener("change", updateDateModeUI);
    dateModeManual.addEventListener("change", updateDateModeUI);

    function wireUpload(input, list, redraw) {
      input.addEventListener("change", function () {
        var file = input.files[0];
        if (!file) return;
        var body = new FormData();
        body.append("image", file);
        fetch("/api/admin/images", { method: "POST", credentials: "same-origin", body: body })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.error) throw new Error(data.error);
            list.push(data.url);
            redraw();
            input.value = "";
          })
          .catch(function (err) { errorEl.textContent = err.message; });
      });
    }
    wireUpload(imageInput, rulesImages, drawRulesThumbs);
    wireUpload(extrasImageInput, extrasImages, drawExtrasThumbs);

    function resetForm() {
      editingId = null;
      form.reset();
      fields.success.value = "Congratulations";
      difficultyPicker.setValue(3);
      dateModeAuto.checked = true;
      updateDateModeUI();
      setList(rulesImages, []);
      setList(extrasImages, []);
      drawRulesThumbs();
      drawExtrasThumbs();
      formTitle.textContent = "New puzzle";
      editingIdNote.hidden = true;
      saveBtn.textContent = "Save puzzle";
      errorEl.textContent = "";
    }
    document.getElementById("clear-form-btn").addEventListener("click", resetForm);

    function loadIntoForm(p) {
      editingId = p.id;
      dateModeManual.checked = true;
      updateDateModeUI();
      dateInput.value = p.date;
      fields.title.value = p.title;
      fields.type.value = p.type;
      difficultyPicker.setValue(p.difficulty);
      fields.author.value = p.author;
      fields.share.value = p.penpaShare || "";
      fields.textPuzzle.value = p.textPuzzle || "";
      fields.textAnswer.value = p.textAnswer || "";
      fields.success.value = p.successMessage || "Congratulations";
      fields.rules.value = (p.rules && p.rules.text) || "";
      fields.extras.value = (p.extras && p.extras.text) || "";
      setList(rulesImages, (p.rules && p.rules.images) || []);
      setList(extrasImages, (p.extras && p.extras.images) || []);
      drawRulesThumbs();
      drawExtrasThumbs();
      formTitle.textContent = "Editing " + p.title;
      editingIdNote.hidden = false;
      editingIdNote.textContent = "Id: " + p.id + " (fixed — used in this puzzle's URLs)";
      saveBtn.textContent = "Update puzzle";
      errorEl.textContent = "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function loadPuzzleList() {
      Api.get("/api/admin/puzzles").then(function (res) {
        puzzleListEl.innerHTML = "";
        if (!res.puzzles.length) {
          puzzleListEl.innerHTML = '<p class="form-note">No puzzles yet — create your first one.</p>';
          return;
        }
        res.puzzles.forEach(function (p) {
          var row = document.createElement("div");
          row.className = "puzzle-row";
          row.innerHTML =
            '<div class="meta"><div class="t">' + escapeHtml(p.title) + '</div>' +
            '<div class="d">' + p.date + " · " + escapeHtml(p.type) + " · " + StarPicker.render(p.difficulty) + '</div></div>' +
            '<div class="actions"><button data-act="edit">Edit</button><button data-act="delete" class="danger">Delete</button></div>';
          row.querySelector('[data-act="edit"]').addEventListener("click", function () {
            Api.get("/api/admin/puzzles/" + encodeURIComponent(p.id)).then(function (r) { loadIntoForm(r.puzzle); });
          });
          row.querySelector('[data-act="delete"]').addEventListener("click", function () {
            if (!confirm('Delete "' + p.title + '"? This cannot be undone.')) return;
            Api.del("/api/admin/puzzles/" + encodeURIComponent(p.id)).then(function () {
              if (editingId === p.id) resetForm();
              loadPuzzleList();
            });
          });
          puzzleListEl.appendChild(row);
        });
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errorEl.textContent = "";

      if (dateModeManual.checked && !dateInput.value.trim()) {
        errorEl.textContent = "Pick a date, or switch to Automatic.";
        return;
      }

      var payload = {
        title: fields.title.value.trim(),
        type: fields.type.value.trim(),
        difficulty: fields.difficulty.value,
        author: fields.author.value.trim(),
        penpaShare: fields.share.value.trim(),
        textPuzzle: fields.textPuzzle.value.trim(),
        textAnswer: fields.textAnswer.value.trim(),
        successMessage: fields.success.value.trim() || "Congratulations",
        rulesText: fields.rules.value,
        rulesImages: rulesImages,
        extrasText: fields.extras.value,
        extrasImages: extrasImages,
      };
      if (dateModeManual.checked) payload.date = dateInput.value.trim();

      var req = editingId
        ? Api.put("/api/admin/puzzles/" + encodeURIComponent(editingId), payload)
        : Api.post("/api/admin/puzzles", payload);

      req
        .then(function () {
          resetForm();
          loadPuzzleList();
        })
        .catch(function (err) { errorEl.textContent = err.message; });
    });

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    resetForm();
    loadPuzzleList();
  }
})();

(function () {
  var el = document.getElementById("user-nav");
  if (!el) return;

  Api.get("/api/auth/me")
    .then(function (res) {
      if (res.user) {
        el.innerHTML =
          '<span class="nav-user">' + escapeHtml(res.user.username) + "</span>" +
          '<a href="/submit.html">Submit</a>' +
          '<a href="/leaderboards.html">Leaderboards</a>' +
          (res.user.isAdmin ? '<a href="/admin/index.html">Admin</a>' : "") +
          (res.user.isAdmin ? '<a href="/admin/submissions.html">Submissions</a>' : "") +
          '<a href="#" id="logout-link">Sign out</a>';
        document.getElementById("logout-link").addEventListener("click", function (e) {
          e.preventDefault();
          Api.post("/api/auth/logout").then(function () { location.reload(); });
        });
      } else {
        el.innerHTML = '<a href="/login.html">Sign in</a>';
      }
    })
    .catch(function () {
      el.innerHTML = '<a href="/login.html">Sign in</a>';
    });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
})();

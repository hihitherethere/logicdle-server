window.Api = (function () {
  async function handle(res) {
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || res.statusText);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function request(method, url, body) {
    var opts = {
      method: method,
      credentials: "same-origin",
      headers: {},
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(handle);
  }

  return {
    get: function (url) { return request("GET", url); },
    post: function (url, body) { return request("POST", url, body || {}); },
    put: function (url, body) { return request("PUT", url, body || {}); },
    del: function (url) { return request("DELETE", url); },
  };
})();

// Local development entrypoint. Vercel doesn't use this file at all — it
// imports app.js directly through api/index.js instead, since Vercel
// manages the HTTP server itself and just needs a request handler.
const app = require("./app");
const config = require("./config");

app.listen(config.PORT, () => {
  console.log(`Logicdle running at http://localhost:${config.PORT}`);
  console.log(`Release timezone: ${config.RELEASE_TIMEZONE}`);
});

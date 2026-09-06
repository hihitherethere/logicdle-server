// Every route (and the attachUser middleware) is now async, since the
// datastore is a network call (Redis) rather than a local file read.
// Express 4 doesn't automatically catch rejected promises from async
// handlers — an unhandled rejection here would just hang the request
// instead of returning an error. Wrap every async handler/middleware in
// this so failures reach the JSON error handler in app.js.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;

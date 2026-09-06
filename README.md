# Logicdle — a server-backed daily puzzle site

A small Node/Express app that releases one [penpa-edit](https://github.com/swaroopg92/penpa-edit)
puzzle a day: puzzles are gated **on the server**, not just hidden in the
UI; penpa-edit runs same-origin inside the site so solves can be
detected automatically; every solver has an account and the server
tracks their completions and streaks; there's a rules step (with image
uploads) between "pick a puzzle" and "start solving"; users can submit
their own puzzles for admin review; and users can create or join
private Advent-of-Code-style leaderboards.

## Quick start (local dev)

```bash
npm install
cp .env.example .env        # then edit .env — see below
git clone https://github.com/swaroopg92/penpa-edit /tmp/penpa-src
cp -r /tmp/penpa-src/docs/* public/penpa-edit/
npm start
```

Note: `@upstash/redis` and `@vercel/blob` are pinned to `"latest"` in
`package.json` rather than a specific version — I couldn't reach the
npm registry from my sandbox to confirm current exact version numbers,
so guessing one risked breaking `npm install` outright if it didn't
exist. After your first successful `npm install`, consider running
`npm install @upstash/redis@latest @vercel/blob@latest --save-exact` to
pin the versions you actually tested against.

You'll also need a Redis database and a Blob store before this will
actually run (see "Data storage" below) — both are free-tier, both work
from local dev too, not just on Vercel. Then visit
`http://localhost:3000`, register an account (use the username you put
in `ADMIN_USERNAMES` in `.env` to get admin rights), and add your first
puzzle at `/admin/index.html`.

**Want to deploy to Vercel specifically?** Skip to "Deploying to Vercel"
below — it walks through provisioning both storage pieces from the
Vercel dashboard, which is the easiest path.

I couldn't run `npm install`, clone penpa-edit, or reach the npm/Vercel
APIs myself while building this — my sandbox has no network access — so
this hasn't been executed against real Redis/Blob services end-to-end.
I did syntax-check every file and exercise the core request logic
against a stand-in for the Redis client that mimics its real behavior,
which caught real wiring bugs during development: the register →
session lookup → play → complete pipeline, the submission → admin
accept → published-puzzle pipeline, and the leaderboard scoring
function (verified against a hand-calculated example with tied scores,
to check the tie-break ordering too). But please do one real pass
end-to-end (register, submit and accept a puzzle, play it, create and
join a leaderboard) before relying on it.

## Why this is actually server-side (not just hidden in the UI)

Every puzzle's `penpaShare` string — the blob that fully encodes both
the puzzle *and* its solution, since that's how penpa's answer-check
works — lives only in the Redis-backed store (see "Data storage"
below). The only route that ever returns it is `POST
/api/puzzles/:id/play` (`routes/puzzles.js`), and that route:

1. Requires a logged-in user (`req.user`).
2. Re-checks the puzzle's release date against **the server's own
   clock** (`lib/dates.js`, using the timezone in `.env`) — not
   anything the client sends.
3. Refuses (`404`) if the date is in the future.

Every other endpoint — the archive list, `today`, and the rules
endpoint — strips `penpaShare` out of the response entirely
(`publicPuzzle()` in `routes/puzzles.js`). So there's no version of "if
I inspect the page source / API responses / JS bundle" that reveals
tomorrow's puzzle: the server simply never sends it. That's the
difference from the earlier static-site version, where the whole
manifest — including future puzzles — shipped to every visitor and was
only hidden by client-side JS.

## Why penpa-edit is embedded same-origin, and what that buys you

Penpa-edit's answer-check is internal to penpa: when a solve matches,
penpa shows its own success popup — there's no postMessage/event API
for a host page to find out. So to detect a solve automatically, the
host page has to be allowed to look inside the iframe, and browsers
only allow that for **same-origin** iframes. That's why
`public/penpa-edit/` exists — clone the real app in there so it's
served from your own domain instead of a third party's, and
`solve-detect.js` can then:

- wrap the iframe's `alert()` to catch penpa's success message, and
- watch the iframe's DOM with a `MutationObserver` as a second signal
  in case a given penpa version renders the message differently,

firing `onSolved()` the moment either one matches the puzzle's
configured `successMessage`. There's intentionally no manual "I solved
it" fallback button — you asked for it removed since the auto-detector
covers it — so if a future penpa-edit version changes how it announces
success, detection could silently stop working. Worth a periodic manual
check if you go a long time without a code update. See
`public/penpa-edit/README.md` for the one-time clone step, and its
licensing caveat.

The same same-origin access is also what makes the **Reset board**
button on the solve page possible — it clears the iframe's own
`localStorage` (that's where penpa keeps a solver's in-progress grid)
and reloads it, so you can replay an old, already-solved puzzle from a
blank grid. Resetting never touches your recorded time: the server only
ever stores a puzzle's *first* completion (see `/complete` below), so
replays just don't create a second one.

The server never trusts the client's *own* claim of how long a solve
took, either: `POST /api/puzzles/:id/play` stamps a server-side
`startedAt` the first time a user opens a given puzzle, and
`POST /api/puzzles/:id/complete` computes `timeMs` from that — the
client-visible timer is just a display, not the source of truth.

## The flow

1. **Home page** (`index.html`) — "Play today's puzzle" and "Browse the
   archive."
2. **Rules page** (`rules.html?puzzle=<id>`) — title, metadata, the
   rules text and any rule images you uploaded in the admin panel, and
   a **Continue** button.
3. Continue calls `POST /api/puzzles/:id/play`, which checks you're
   signed in and the puzzle is released, then hands back either the
   penpa share string or plain-text puzzle content (see "Penpa link vs.
   text puzzles" below) and starts the server-side timer.
4. **Solve page** (`solve.html?puzzle=<id>`) — top to bottom: any
   **extra content** you added for this puzzle (text/images, shown only
   if you added any), then either the penpa iframe (auto-sized to its
   content, so it never needs its own scrollbar) with a **Reset board**
   button, or — for text-only puzzles — the puzzle's text content and a
   manual **I've solved it** button, and finally the **rules** again
   underneath for reference while solving. On success it posts to
   `/complete` and shows an inline **Solved** banner with a **Copy
   stats** button that copies a short share-ready summary (puzzle, time,
   streak) to the clipboard.
5. **Archive page** (`archive.html`) — every released puzzle, searchable
   by title/type/author, filterable by difficulty, sortable (newest,
   oldest, most/least solved, fastest/slowest average time), paginated
   12 per page. Shows each puzzle's solve count and average solve time,
   plus your own time where you've solved it. Anything dated in the
   future was never sent by the server, so it doesn't appear at all —
   not even to build the search index.
6. **Submit a puzzle** (`submit.html`) — any signed-in user can propose
   a puzzle for an admin to review (see "Puzzle submissions" below).
7. **Leaderboards** (`leaderboards.html`) — create or join a private
   group leaderboard (see "Leaderboards" below).

## Penpa link vs. text puzzles

Every puzzle needs either a `penpaShare` string or plain **text puzzle
content** — at least one is required, both admin and submission forms
enforce this. Text content is meant as a fallback for puzzle types
penpa doesn't represent well, or for submitters who don't know how to
generate a penpa link: the solve page shows it as plain text in place
of the interactive grid. Since there's no interactive grid, there's
also no way to auto-detect a solve — that's the one case where the
solve page still shows a manual **I've solved it** button (it isn't
redundant with automatic checking there, since no automatic checking is
possible without a grid to watch).

## Admin: creating puzzles, rules, and extra content

`/admin/index.html` (visible once you're signed in with a username
listed in `ADMIN_USERNAMES`) has one form for creating and editing
puzzles. A few things worth knowing:

- **Id**: never typed by hand — generated server-side (8 random hex
  characters) when you save a new puzzle, and fixed afterward (shown
  read-only while editing).
- **Release date**: choose **Automatic** (the default) to have the
  server place this puzzle the day after whichever puzzle is currently
  queued latest — or the puzzle's own release day if there are no
  puzzles yet — so you can just keep adding puzzles without tracking
  dates yourself. Choose **Manual** to pick a specific date instead.
- **Penpa share string / text puzzle content**: at least one is
  required — see "Penpa link vs. text puzzles" above.
- **Difficulty**: a fixed dropdown (Easy / Medium / Hard / Insane)
  rather than free text, so the archive's difficulty filter has
  something consistent to match against.
- **Extra content**: optional text/images shown **above** the puzzle on
  the solve page — a note, a hint, context, whatever you want solvers
  to see before they start.
- **Rules text + images**: shown **below** the puzzle on the solve
  page (and also on the rules page before Continue). Rule/extras images
  are capped to a max height on display (`max-height: 260px` in
  `style.css`) so a large uploaded image can't dominate the page.

Both image uploaders work the same way: pick a file, it uploads
immediately to `/api/admin/images` and appears as a thumbnail; remove
one by clicking the × on its thumbnail. Saving the puzzle stores the
final list of image URLs alongside the corresponding text.

### Getting a `penpaShare` string

1. Build the puzzle in penpa-edit, Edit mode **Problem**.
2. Switch to Edit mode **Solution**, fill in the answer using the
   color/style penpa expects for its answer-check.
3. **Share → "URL with answer check / Extra options"** → choose which
   elements must match → optionally set a custom success message (this
   must exactly match the `successMessage` field in the admin form,
   since that's the text `solve-detect.js` watches for) → **Generate
   URL**.
4. Copy everything **after the `#`** into the "Penpa share string"
   field in the admin form.

## Puzzle submissions

Any signed-in user can submit a puzzle at `/submit.html` — the same
fields as the admin's own creation form (title, type, difficulty,
author, penpa link or text content, success message, rules, extras),
minus a date field: **submitters never choose a release date**, only
an admin does, at accept-time. Submitters can add an optional note for
the reviewer, and the submitter and any admin can go back and forth in
a comment thread on the submission afterward.

Admins review at `/admin/submissions.html` (linked from the main admin
page, and from the nav once signed in as an admin): filter by status
(Pending / Accepted / Rejected / All), edit any field on a pending
submission before deciding, leave comments, and either:

- **Accept & publish** — creates a real puzzle from the submission's
  fields, using the same automatic-date placement as the admin's own
  creation form (or an explicit date, if you fill in the optional date
  picker next to the button first).
- **Reject** — prompts for an optional reason, shown to the submitter
  as a comment.

A submission can only be reviewed once — the accept/reject buttons
disappear once its status leaves "pending."

## Leaderboards

Any signed-in user can create a private leaderboard at
`/leaderboards.html` and share its 6-character join code with others
(no account/leaderboard limit, no admin involvement). Scoring works
like [Advent of Code's local leaderboards](https://adventofcode.com/2026/leaderboard/self):
for each puzzle, only completions from that leaderboard's own members
are considered, ranked by how early each member solved it (earliest
`solvedAt` timestamp — not raw solve *duration*, matching AoC's actual
mechanic); the fastest-to-finish member gets N points (N = how many
members solved that puzzle), second gets N-1, down to 1 point for
last place. Points sum across every puzzle for each member's total
score. `routes/leaderboards.js`'s `computeStandings()` is the whole
implementation, and it's recomputed fresh on every page load rather
than stored — there's nothing to keep in sync.

## Data storage

This app needs a **writable place to persist data** and a **place to
store uploaded rule/extras images**. Which services to use depends on
where you're hosting it — see below.

### If you're deploying to Vercel (recommended path — see next section)

Vercel's serverless functions run on a **read-only filesystem** (aside
from `/tmp`, which isn't shared or persisted across invocations) — a
plain JSON file or local `multer` disk uploads, which this app used
before, simply can't survive there. So on Vercel this app uses:

- **Redis** (via [Upstash](https://upstash.com), attached through the
  Vercel Marketplace) for everything that used to live in
  `data/db.json` — users, sessions, puzzles, completions, start times.
  `lib/db.js` stores it all as one JSON blob under a single key, the
  same shape as the old file, just over HTTP instead of the filesystem.
  Note the *Vercel KV* and *Vercel Postgres* products themselves were
  discontinued in December 2024 — their replacements are Marketplace
  integrations (Upstash for Redis, Neon for Postgres), which is what's
  used here.
- **Vercel Blob** for rule/extras images — `routes/admin.js` uploads
  directly to it and stores the resulting public URL, no local file
  serving involved.

**Tradeoff worth knowing:** `withDb()` in `lib/db.js` is a
read-modify-write over the *whole* dataset, not a real transaction —
same limitation the old JSON-file version had, just now over the
network instead of the filesystem. Two requests that both read, then
both write, can race, and the second write silently wins. For a small
personal/community puzzle site this is a low-stakes, documented
tradeoff; if you outgrow it, move to a real relational database (e.g.
Neon Postgres via the Vercel Marketplace) with row-level writes —
`withDb()` is the one place in the codebase that would need to change.

### If you're deploying somewhere else (a VPS, Render, Railway, Fly.io)

The exact same Redis + Blob setup works from any environment with the
right tokens — you don't have to be running *on* Vercel to use Vercel
Blob's API or Upstash's REST API, both are plain HTTPS. Provision an
Upstash Redis database directly at [upstash.com](https://upstash.com)
(outside the Vercel Marketplace) and set `KV_REST_API_URL` /
`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN`) yourself; get a `BLOB_READ_WRITE_TOKEN` from
the Vercel dashboard's Storage tab even without deploying the app
itself to Vercel. Everything else about the app is a plain Express
server and runs the same way anywhere.

Passwords are hashed with bcrypt (`bcryptjs`, pure JS — no native
compilation step needed). Sessions are random 256-bit tokens in an
`httpOnly` cookie, looked up server-side per request; there's no JWT and
nothing session-related is trusted from the client.

## Deploying to Vercel

1. **Push this project to a GitHub (or GitLab/Bitbucket) repo.** Vercel
   deploys from a connected git repo.
2. **Populate `public/penpa-edit/`** before you push (see "Quick start"
   above) — it needs to already be in the repo, since there's no build
   step here that could clone it for you.
3. **Import the project in Vercel**: [vercel.com/new](https://vercel.com/new) →
   pick your repo → Vercel will detect it as a plain Node project (no
   framework preset needed) → click **Deploy**. It'll fail on first
   deploy because there's no database or blob store attached yet —
   that's expected, continue to the next steps.
4. **Attach Redis**: in the project → **Storage** tab → **Marketplace
   Database Providers** → choose **Upstash** (Redis) → create a
   database and connect it to this project. Vercel injects
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN`, depending on the integration version)
   into your project automatically.
5. **Attach Blob storage**: same **Storage** tab → **Create Database** →
   **Blob** → connect it to this project. This injects
   `BLOB_READ_WRITE_TOKEN` automatically.
6. **Set the remaining environment variables**: project → **Settings**
   → **Environment Variables** → add `RELEASE_TIMEZONE`,
   `ADMIN_USERNAMES`, and `COOKIE_SECRET` (see the table below for what
   each does — same variables as local dev, just entered in the
   dashboard instead of a `.env` file).
7. **Redeploy** (Deployments tab → ⋯ on the latest one → Redeploy) so
   the new environment variables and storage connections take effect.
8. Visit your `*.vercel.app` URL, register with the username from
   `ADMIN_USERNAMES`, and add your first puzzle at `/admin/index.html`.

If step 4 injects env vars under names other than what's listed above,
check **Settings → Environment Variables** for the exact names your
specific integration used and adjust the two `process.env.…` lines at
the top of `getClient()` in `lib/db.js` to match — Marketplace
integrations have varied their exact naming over time, and I can't
verify the current exact names without being able to actually walk
through the Vercel dashboard from here.

## Environment variables

| Variable | What it does |
|---|---|
| `PORT` | Port the server listens on (local dev only — Vercel ignores this and manages the port itself). |
| `RELEASE_TIMEZONE` | IANA timezone (e.g. `America/New_York`). All visitors unlock the next puzzle at local midnight in *this* timezone, not their own. |
| `ADMIN_USERNAMES` | Comma-separated usernames with admin rights. Re-checked on every request (`middleware/auth.js`), so editing this and redeploying/restarting takes effect for existing accounts immediately — no need to re-register. |
| `COOKIE_SECRET` | Random string for signing cookies. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) | Redis connection. Auto-injected by the Vercel Marketplace Upstash integration; set manually if hosting elsewhere. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob access for image uploads. Auto-injected once a Blob store is attached; set manually if hosting elsewhere. |

## File map

```
app.js                         the Express app (no app.listen() — imported by both entrypoints below)
server.js                      local dev entrypoint (`npm start`) — calls app.listen()
api/index.js                   Vercel serverless entrypoint — exports the same app
vercel.json                    routes /api/* to the function, everything else to /public
config.js                      env-driven config
lib/db.js                      Redis-backed datastore (Upstash)
lib/asyncHandler.js            wraps async route handlers so rejected promises reach the error middleware
lib/auth.js                    password hashing, session tokens
lib/dates.js                   server-side "what day is it" (release gate) + addDays()
middleware/auth.js             session lookup, requireAuth / requireAdmin
routes/auth.js                 register / login / logout / me
routes/puzzles.js              today / archive (search/sort/paginate client-side, solve stats server-computed) / rules / play / complete
routes/admin.js                puzzle CRUD (random id, auto/manual date, text-puzzle support), image upload (Vercel Blob), submission review
routes/submissions.js          user-facing puzzle submission: create / list own / comment / image upload
routes/leaderboards.js         create / join / standings / leave — AoC-style scoring
public/index.html              home
public/archive.html            archive — search, difficulty filter, sort, pagination
public/rules.html              rules + Continue
public/solve.html              extras + penpa embed (no scrollbar) OR text-puzzle block + rules + reset + inline solved banner/share
public/submit.html             puzzle submission form + "your submissions" with comment threads
public/leaderboards.html       create/join a leaderboard
public/leaderboard.html        one leaderboard's standings
public/login.html, register.html
public/admin/index.html, admin/js/admin.js       puzzle CRUD
public/admin/submissions.html, admin/js/submissions.js   review/edit/accept/reject submissions
public/js/api.js, nav.js, solve-detect.js
public/penpa-edit/             ← clone penpa-edit's docs/ folder here (see its own README)
```

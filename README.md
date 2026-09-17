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
   archive." No account needed for either.
2. **Rules page** (`rules.html?puzzle=<id>`) — title, metadata, the
   rules text and any rule images you uploaded in the admin panel, and
   a **Continue** button.
3. Continue calls `POST /api/puzzles/:id/play`, which checks the puzzle
   is released, then hands back whichever content mode the puzzle uses
   (see "Three ways to present a puzzle" below) and starts the
   server-side timer. No sign-in required — see "Playing without an
   account" below for how progress is tracked either way.
4. **Solve page** (`solve.html?puzzle=<id>`) — top to bottom: any
   **extra content** you added for this puzzle (text/images, shown only
   if you added any), then the puzzle itself in whichever mode applies
   (penpa iframe, an answer box, or plain text), and finally the
   **rules** again underneath for reference while solving. Solving is
   detected automatically (penpa's own success message, or a correct
   text answer) and posts to `/complete` or `/answer`, which shows an
   inline **Solved** banner with a **Copy stats** button that copies a
   short share-ready summary (puzzle, time, streak) to the clipboard.
   Revisiting an already-solved puzzle shows that same banner again
   immediately, with your original recorded time rather than a
   live-counting timer.
5. **Archive page** (`archive.html`) — every released puzzle, searchable
   by title/type/author, filterable by difficulty, sortable (newest,
   oldest, most/least solved, fastest/slowest average time), paginated
   12 per page. Shows each puzzle's solve count and average solve time,
   plus your own time where you've solved it. Anything dated in the
   future was never sent by the server, so it doesn't appear at all —
   not even to build the search index.
6. **Submit a puzzle** (`submit.html`) — any signed-in user can propose
   a puzzle for an admin to review (see "Puzzle submissions" below).
   Submitting still requires an account, unlike playing.
7. **Leaderboards** (`leaderboards.html`) — create or join a private
   group leaderboard (see "Leaderboards" below). Also still requires an
   account, since a leaderboard is inherently about attributing results
   to identifiable people.

## Playing without an account

Solving puzzles — starting, completing, streaks, "already solved"
status in the archive — never requires an account. `middleware/anon.js`
gives every visitor a random `anon_id` cookie (httpOnly, ~1 year) the
first time they hit the server if they don't already have one or a
session; `lib/actor.js`'s `actorId(req)` is what every puzzle route
actually keys progress by — a real user's id if signed in, otherwise
`"anon:" + anonId`. Nothing about `db.starts` or `db.completions`
distinguishes an anonymous solver from a signed-in one beyond that
string, so every existing feature (streaks, solve stats, revisiting a
solved puzzle) works identically either way.

**Registering or logging in transfers that progress into the
account.** `transferAnonProgress()` in `routes/auth.js` runs right
after both `/register` and `/login` succeed: every start/completion
under the current `anon_id` gets reassigned to the now-authenticated
user. If the account already has its own record for a given puzzle
(e.g. solved once already on another device), the anonymous one is
merged rather than overwritten — whichever of the two actually happened
earlier wins as the canonical time, and the redundant record is
dropped, so there's never a duplicate completion for the same puzzle.
The `anon_id` cookie itself isn't cleared afterward, so this keeps
working across repeated logout → solve anonymously → log back in
cycles on the same browser, not just a one-time transfer at signup.

**Known limitation, not something this tries to fully solve:**
anonymous identity is just a cookie. Clearing cookies (or using a
different browser/device) starts a fresh anonymous identity with no
memory of prior solves — there's no way around that without requiring
accounts, which defeats the point of this feature. For a personal or
small-community puzzle site this is a reasonable, low-stakes tradeoff;
it's not meant to prevent someone determined to replay a puzzle to
reset their own streak.

## Three ways to present a puzzle

Every puzzle needs at least one of these — admin and submission forms
both enforce it:

- **Penpa share string** — the interactive grid, with automatic solve
  detection (see "Why penpa-edit is embedded same-origin" above).
- **Text puzzle content** — plain text shown in place of the grid, for
  puzzle types penpa doesn't represent well. There's no way to
  auto-detect a solve without an interactive grid, so this is the one
  case where the solve page shows a manual **I've solved it** button —
  it isn't redundant with automatic checking here, since none is
  possible for this puzzle. (Admin-form only — see "Puzzle submissions"
  below for why it's not in the submission form.)
- **Text answer** — for word/competition-style puzzles: the solver
  types an answer into a box on the solve page (the puzzle's actual
  content/prompt lives in the rules or extras text, same as any other
  puzzle) and it's checked **server-side** (`POST /api/puzzles/:id/answer`
  in `routes/puzzles.js`) against a stored answer that's never sent to
  the client — same spoiler-protection pattern as `penpaShare`. A
  correct answer records the completion in the same step, so there's no
  separate "mark as solved" button for this mode either: submitting the
  right answer already proves it. The comparison is case- and
  whitespace-insensitive.

If a puzzle has more than one of these set, `solve.html` picks in that
order — penpa link first, then text-answer, then plain text.

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
- **Penpa share string / text puzzle content / correct answer**: at
  least one is required — see "Three ways to present a puzzle" above.
- **Difficulty**: a 1-5 star picker (`public/js/star-picker.js`,
  shared by every form and every display of difficulty across the
  site) rather than free text or named tiers, stored as a plain integer
  1-5 — so the archive's difficulty filter and sort have something
  numeric and consistent to work with.
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

**Links in rules/extras text**: both fields support clickable links —
`[label](https://example.com)` for a labeled link, or just paste a bare
URL and it's auto-linkified. This is deliberately NOT arbitrary HTML:
`public/js/rich-text.js` HTML-escapes everything first and only ever
constructs `<a>` tags itself (`target="_blank" rel="noopener noreferrer"`,
`http(s)://` only — a `javascript:` link, for instance, is left as
inert plain text rather than becoming clickable). This matters because
rules/extras text isn't admin-only content — it also comes from regular
user submissions (`routes/submissions.js`) before an admin ever reviews
it, so it has to be safe to render without trusting the source.

### Getting a penpa link

1. Build the puzzle in penpa-edit, Edit mode **Problem**.
2. Switch to Edit mode **Solution**, fill in the answer using the
   color/style penpa expects for its answer-check.
3. **Share → "URL with answer check / Extra options"** → choose which
   elements must match → optionally set a custom success message (this
   must exactly match the `successMessage` field in the admin form,
   since that's the text `solve-detect.js` watches for) → **Generate
   URL**.
4. Copy the **whole generated URL** — including the `https://...`
   part — and paste all of it into the "Penpa link" field in the admin
   form. You don't need to trim it down yourself: `extractPenpaFragment()`
   in `lib/penpa.js` strips everything up through the first `#`
   server-side, on every write path (admin create/edit, submission
   create/edit), so pasting the full URL and pasting just the bare
   fragment both work — the fragment is all that's ever stored.

## Puzzle submissions

Any signed-in user can submit a puzzle at `/submit.html` — mostly the
same fields as the admin's own creation form (title, type, a 1-5 star
difficulty picker, author, success message, rules, extras), minus a
date field: **submitters never choose a release date**, only an admin
does, at accept-time. The submission form offers **penpa link** or
**text answer** as content modes — not the plain-text "text puzzle
content" mode, since anything you'd put there fits in the "extra
content" field instead, so the submission form only offers the two
modes that need special server handling (a penpa link, or a verified
answer). Submitters can add an optional note for the reviewer, and the
submitter and any admin can go back and forth in a comment thread on
the submission afterward.

Admins review at `/admin/submissions.html` (linked from the main admin
page, and from the nav once signed in as an admin): filter by status
(Pending / Accepted / Rejected / All), edit any field on a pending
submission before deciding — including switching between content modes
— leave comments, and either:

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
(no account/leaderboard limit, no admin involvement). This is
deliberately **not** Advent-of-Code-style cumulative scoring — there's
no running point total, and nothing leaderboard-specific is stored past
what's needed to know who's a member:

- For each puzzle, results only appear on the leaderboard **once that
  day has passed** (`date < today` in the release timezone) — a puzzle
  dated today never shows any data, so nobody can see who's ahead while
  people are still solving it.
- What's shown is each member's **actual solve time**, ranked
  fastest-to-slowest, for each qualifying day — not points, and nothing
  summed across days.
- `computeDailyResults()` in `routes/leaderboards.js` recomputes this
  fresh from `db.puzzles`/`db.completions` on every request; the
  leaderboard record itself only stores its name, owner, join code, and
  member list — no scores or history live anywhere.

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
   `BLOB_READ_WRITE_TOKEN` automatically. **Make sure you select Public
   access when creating it, not Private** — Vercel Blob's access mode is
   fixed at store creation and can't be changed afterward, and rule/extras
   images need to be viewable by anyone browsing the archive, even
   logged out. If you end up with a Private store, uploads fail with
   "Cannot use public access on a private store" (`put()` in
   `routes/admin.js`/`routes/submissions.js` always uploads with
   `access: "public"`) — the fix is to create a new store as Public and
   reconnect it, since there's no toggle to change an existing store's mode.
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
through the Vercel dashboard from here. One case already handled: if
you set a custom "URL prefix" (e.g. `STORAGE`) when connecting the
Redis store, `getClient()` also checks `STORAGE_KV_REST_API_URL` /
`STORAGE_KV_REST_API_TOKEN` as a fallback — no code change needed for
that specific case.

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
lib/actor.js                   actorId(req) — user id or "anon:..." id, used by every puzzle-progress route
lib/dates.js                   server-side "what day is it" (release gate) + addDays()
lib/penpa.js                   extractPenpaFragment() — strips a pasted full penpa URL down to its fragment
middleware/auth.js             session lookup, requireAuth / requireAdmin
middleware/anon.js             assigns the anon_id cookie so signed-out visitors can play
routes/auth.js                 register / login / logout / me / transferAnonProgress() on register+login
routes/puzzles.js              today / archive (search/sort/paginate client-side, solve stats server-computed) / rules / play / complete / answer — no login required
routes/admin.js                puzzle CRUD (random id, auto/manual date, star difficulty, 3 content modes), image upload (Vercel Blob), submission review
routes/submissions.js          user-facing puzzle submission: create / list own / comment / image upload (still requires login)
routes/leaderboards.js         create / join / per-day results (only once a day has passed) / leave (still requires login)
public/index.html              home
public/archive.html            archive — search, star-difficulty filter, sort, pagination
public/rules.html              rules + Continue
public/solve.html              extras + puzzle (penpa embed, answer box, or text block) + rules + reset + inline solved banner/share
public/submit.html             puzzle submission form + "your submissions" with comment threads
public/leaderboards.html       create/join a leaderboard
public/leaderboard.html        one leaderboard's per-day results
public/login.html, register.html
public/admin/index.html, admin/js/admin.js       puzzle CRUD
public/admin/submissions.html, admin/js/submissions.js   review/edit/accept/reject submissions
public/js/api.js, nav.js, solve-detect.js, star-picker.js, rich-text.js
public/penpa-edit/             ← clone penpa-edit's docs/ folder here (see its own README)
```

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const { put } = require("@vercel/blob");

const router = express.Router();
const { withDb } = require("../lib/db");
const { requireAdmin } = require("../middleware/auth");
const { todayStr, addDays } = require("../lib/dates");
const config = require("../config");
const asyncHandler = require("../lib/asyncHandler");

// Images upload to Vercel Blob rather than local disk — a serverless
// function's filesystem is read-only (aside from /tmp, which isn't
// shared or persisted across invocations), so nothing saved to disk
// here would survive past the current request. memoryStorage() just
// keeps the upload in a Buffer in memory, which put() below sends on to
// Blob storage directly.
const upload = multer({
  storage: multer.memoryStorage(),
  // Vercel's serverless functions cap request bodies around 4.5MB — stay
  // safely under that rather than accepting an upload that's guaranteed
  // to fail on the platform this app is meant to run on.
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed (max 4MB)."));
  },
});

const EXT_BY_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

router.use(requireAdmin);

// ---------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------

router.get("/puzzles", asyncHandler(async (req, res) => {
  const puzzles = await withDb((db) => db.puzzles.slice().sort((a, b) => b.date.localeCompare(a.date)));
  res.json({ puzzles });
}));

router.get("/puzzles/:id", asyncHandler(async (req, res) => {
  const puzzle = await withDb((db) => db.puzzles.find((p) => p.id === req.params.id));
  if (!puzzle) return res.status(404).json({ error: "Not found." });
  res.json({ puzzle });
}));

// Puzzle ids are never typed by hand — generated here and retried on the
// (extremely unlikely) chance of a collision. Exported for reuse by the
// submission-accept flow below, which creates puzzles the same way.
function randomId(db) {
  let id;
  do {
    id = crypto.randomBytes(4).toString("hex"); // 8 hex chars
  } while (db.puzzles.some((p) => p.id === id));
  return id;
}

// "Automatic" placement: one day after whatever puzzle is currently
// queued latest (released or not), or today if there are no puzzles yet.
function autoDate(db) {
  if (!db.puzzles.length) return todayStr(config.RELEASE_TIMEZONE);
  const latest = db.puzzles.reduce((max, p) => (p.date > max ? p.date : max), db.puzzles[0].date);
  return addDays(latest, 1);
}

function validate(body) {
  const required = ["title", "type", "author"]; // difficulty checked separately below (numeric 1-5)
  for (const key of required) {
    if (!body[key] || typeof body[key] !== "string" || !body[key].trim()) {
      return `"${key}" is required.`;
    }
  }
  const difficulty = Number(body.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    return '"difficulty" must be a whole number from 1 to 5 (stars).';
  }
  // A puzzle needs SOME way to be presented — a real penpa link, plain
  // text content, or a text answer to verify (for word/competition
  // puzzles with no grid at all).
  const hasPenpa = body.penpaShare && body.penpaShare.trim();
  const hasText = body.textPuzzle && body.textPuzzle.trim();
  const hasAnswer = body.textAnswer && body.textAnswer.trim();
  if (!hasPenpa && !hasText && !hasAnswer) {
    return "Provide a Penpa share string, text puzzle content, or a text answer.";
  }
  // Date is optional on create (falls back to automatic placement), but
  // if one IS given (manual mode), it has to be well-formed.
  if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return '"date" must be in YYYY-MM-DD form.';
  }
  return null;
}

router.post("/puzzles", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const err = validate(body);
  if (err) return res.status(400).json({ error: err });

  const result = await withDb((db) => {
    const puzzle = {
      id: randomId(db),
      date: body.date && body.date.trim() ? body.date.trim() : autoDate(db),
      title: body.title,
      type: body.type,
      difficulty: Number(body.difficulty),
      author: body.author,
      penpaShare: body.penpaShare || "",
      textPuzzle: body.textPuzzle || "",
      textAnswer: body.textAnswer || "",
      successMessage: body.successMessage || "Congratulations",
      rules: {
        text: body.rulesText || "",
        images: Array.isArray(body.rulesImages) ? body.rulesImages : [],
      },
      // Shown ABOVE the puzzle on the solve page — separate from rules,
      // which are shown below it.
      extras: {
        text: body.extrasText || "",
        images: Array.isArray(body.extrasImages) ? body.extrasImages : [],
      },
    };
    db.puzzles.push(puzzle);
    return { puzzle };
  });

  res.status(201).json(result);
}));

router.put("/puzzles/:id", asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return res.status(400).json({ error: '"date" must be in YYYY-MM-DD form.' });
  }
  if (body.difficulty !== undefined && body.difficulty !== "") {
    const d = Number(body.difficulty);
    if (!Number.isInteger(d) || d < 1 || d > 5) {
      return res.status(400).json({ error: '"difficulty" must be a whole number from 1 to 5 (stars).' });
    }
  }

  const result = await withDb((db) => {
    const puzzle = db.puzzles.find((p) => p.id === req.params.id);
    if (!puzzle) return { error: "Not found." };

    ["date", "title", "type", "author", "successMessage"].forEach((key) => {
      if (typeof body[key] === "string" && body[key].trim()) puzzle[key] = body[key];
    });
    if (body.difficulty !== undefined && body.difficulty !== "") {
      puzzle.difficulty = Number(body.difficulty);
    }
    // penpaShare / textPuzzle / textAnswer can legitimately be cleared to
    // empty (e.g. switching from one mode to another), so these allow an
    // explicit empty string through rather than requiring non-blank.
    if (typeof body.penpaShare === "string") puzzle.penpaShare = body.penpaShare;
    if (typeof body.textPuzzle === "string") puzzle.textPuzzle = body.textPuzzle;
    if (typeof body.textAnswer === "string") puzzle.textAnswer = body.textAnswer;

    if (body.rulesText !== undefined || body.rulesImages !== undefined) {
      puzzle.rules = puzzle.rules || { text: "", images: [] };
      if (body.rulesText !== undefined) puzzle.rules.text = body.rulesText;
      if (Array.isArray(body.rulesImages)) puzzle.rules.images = body.rulesImages;
    }

    if (body.extrasText !== undefined || body.extrasImages !== undefined) {
      puzzle.extras = puzzle.extras || { text: "", images: [] };
      if (body.extrasText !== undefined) puzzle.extras.text = body.extrasText;
      if (Array.isArray(body.extrasImages)) puzzle.extras.images = body.extrasImages;
    }

    return { puzzle };
  });

  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

router.delete("/puzzles/:id", asyncHandler(async (req, res) => {
  const result = await withDb((db) => {
    const idx = db.puzzles.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return { error: "Not found." };
    db.puzzles.splice(idx, 1);
    return { ok: true };
  });
  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

// Generic image upload for rules/extras content — returns a URL to drop
// into the images gallery. Not tied to a puzzle id so you can upload
// images before the puzzle itself is saved. Uploads go straight to
// Vercel Blob and the returned URL is already a full, public,
// CDN-served https:// URL — no local file serving involved.
router.post("/images", upload.single("image"), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });

  const ext = path.extname(req.file.originalname || "").toLowerCase() || EXT_BY_MIME[req.file.mimetype] || "";
  const blob = await put(`rules/${crypto.randomUUID()}${ext}`, req.file.buffer, {
    access: "public",
    contentType: req.file.mimetype,
  });

  res.json({ url: blob.url });
}));

// ---------------------------------------------------------------------
// Submission review — users submit via /api/submissions (routes/submissions.js);
// everything here is the admin side of reviewing those submissions.
// ---------------------------------------------------------------------

router.get("/submissions", asyncHandler(async (req, res) => {
  const status = req.query.status; // "pending" | "accepted" | "rejected" | undefined (= all)
  const submissions = await withDb((db) => {
    const list = db.submissions.slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return status ? list.filter((s) => s.status === status) : list;
  });
  res.json({ submissions });
}));

router.put("/submissions/:id", asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (body.difficulty !== undefined && body.difficulty !== "") {
    const d = Number(body.difficulty);
    if (!Number.isInteger(d) || d < 1 || d > 5) {
      return res.status(400).json({ error: '"difficulty" must be a whole number from 1 to 5 (stars).' });
    }
  }

  const result = await withDb((db) => {
    const sub = db.submissions.find((s) => s.id === req.params.id);
    if (!sub) return { error: "Not found." };

    ["title", "type", "author", "successMessage"].forEach((key) => {
      if (typeof body[key] === "string" && body[key].trim()) sub[key] = body[key];
    });
    if (body.difficulty !== undefined && body.difficulty !== "") {
      sub.difficulty = Number(body.difficulty);
    }
    if (typeof body.penpaShare === "string") sub.penpaShare = body.penpaShare;
    if (typeof body.textPuzzle === "string") sub.textPuzzle = body.textPuzzle;
    if (typeof body.textAnswer === "string") sub.textAnswer = body.textAnswer;

    if (body.rulesText !== undefined || body.rulesImages !== undefined) {
      sub.rules = sub.rules || { text: "", images: [] };
      if (body.rulesText !== undefined) sub.rules.text = body.rulesText;
      if (Array.isArray(body.rulesImages)) sub.rules.images = body.rulesImages;
    }
    if (body.extrasText !== undefined || body.extrasImages !== undefined) {
      sub.extras = sub.extras || { text: "", images: [] };
      if (body.extrasText !== undefined) sub.extras.text = body.extrasText;
      if (Array.isArray(body.extrasImages)) sub.extras.images = body.extrasImages;
    }

    return { submission: sub };
  });

  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

// Publishes the submission as a real puzzle. Submitters never set a
// date (see routes/submissions.js) — this uses the same automatic
// placement as the regular admin creation form unless an explicit
// `date` is passed here, so the admin can still choose a specific date
// at accept-time if they want to.
router.post("/submissions/:id/accept", asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return res.status(400).json({ error: '"date" must be in YYYY-MM-DD form.' });
  }

  const result = await withDb((db) => {
    const sub = db.submissions.find((s) => s.id === req.params.id);
    if (!sub) return { error: "Not found." };
    if (sub.status !== "pending") return { error: "This submission has already been reviewed." };

    const puzzle = {
      id: randomId(db),
      date: body.date && body.date.trim() ? body.date.trim() : autoDate(db),
      title: sub.title,
      type: sub.type,
      difficulty: Number(sub.difficulty) || 3,
      author: sub.author,
      penpaShare: sub.penpaShare || "",
      textPuzzle: sub.textPuzzle || "",
      textAnswer: sub.textAnswer || "",
      successMessage: sub.successMessage || "Congratulations",
      rules: sub.rules || { text: "", images: [] },
      extras: sub.extras || { text: "", images: [] },
    };
    db.puzzles.push(puzzle);

    sub.status = "accepted";
    sub.reviewedAt = new Date().toISOString();
    sub.reviewedBy = req.user.username;
    sub.publishedPuzzleId = puzzle.id;

    return { submission: sub, puzzle };
  });

  if (result.error) return res.status(400).json(result);
  res.json(result);
}));

router.post("/submissions/:id/reject", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await withDb((db) => {
    const sub = db.submissions.find((s) => s.id === req.params.id);
    if (!sub) return { error: "Not found." };
    if (sub.status !== "pending") return { error: "This submission has already been reviewed." };

    sub.status = "rejected";
    sub.reviewedAt = new Date().toISOString();
    sub.reviewedBy = req.user.username;
    if (body.comment && body.comment.trim()) {
      sub.comments.push({
        authorUsername: req.user.username,
        isAdmin: true,
        text: body.comment.trim(),
        createdAt: new Date().toISOString(),
      });
    }

    return { submission: sub };
  });

  if (result.error) return res.status(400).json(result);
  res.json(result);
}));

router.post("/submissions/:id/comments", asyncHandler(async (req, res) => {
  const text = (req.body && req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Comment text is required." });

  const result = await withDb((db) => {
    const sub = db.submissions.find((s) => s.id === req.params.id);
    if (!sub) return { error: "Not found." };
    sub.comments = sub.comments || [];
    sub.comments.push({
      authorUsername: req.user.username,
      isAdmin: true,
      text,
      createdAt: new Date().toISOString(),
    });
    return { submission: sub };
  });

  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

module.exports = router;

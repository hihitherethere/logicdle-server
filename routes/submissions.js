const express = require("express");
const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const { put } = require("@vercel/blob");
const router = express.Router();

const { withDb } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../lib/asyncHandler");

// Every route here needs a signed-in user — there's no anonymous submission.
router.use(requireAuth);

// Same upload setup as routes/admin.js's /images — any signed-in user can
// upload rule/extras images for their OWN submission, not just admins.
// Kept as a separate endpoint (rather than reusing the admin one) since
// the admin route is behind requireAdmin for everything else it does.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed (max 4MB)."));
  },
});
const EXT_BY_MIME = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
  "image/webp": ".webp", "image/svg+xml": ".svg",
};

router.post("/images", upload.single("image"), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });
  const ext = path.extname(req.file.originalname || "").toLowerCase() || EXT_BY_MIME[req.file.mimetype] || "";
  const blob = await put(`submissions/${crypto.randomUUID()}${ext}`, req.file.buffer, {
    access: "public",
    contentType: req.file.mimetype,
  });
  res.json({ url: blob.url });
}));

function validate(body) {
  const required = ["title", "type", "difficulty", "author"];
  for (const key of required) {
    if (!body[key] || typeof body[key] !== "string" || !body[key].trim()) {
      return `"${key}" is required.`;
    }
  }
  const hasPenpa = body.penpaShare && body.penpaShare.trim();
  const hasText = body.textPuzzle && body.textPuzzle.trim();
  if (!hasPenpa && !hasText) {
    return "Provide either a Penpa share string or text puzzle content.";
  }
  return null;
}

// POST /api/submissions — create a new submission. Deliberately has no
// `date` field at all: submitters never choose a release date, only the
// admin does, at accept-time (see routes/admin.js's /submissions/:id/accept).
router.post("/", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const err = validate(body);
  if (err) return res.status(400).json({ error: err });

  const submission = await withDb((db) => {
    const sub = {
      id: crypto.randomUUID(),
      status: "pending",
      submittedBy: req.user.id,
      submittedByUsername: req.user.username,
      submittedAt: new Date().toISOString(),
      title: body.title,
      type: body.type,
      difficulty: body.difficulty,
      author: body.author,
      penpaShare: body.penpaShare || "",
      textPuzzle: body.textPuzzle || "",
      successMessage: body.successMessage || "Congratulations",
      rules: {
        text: body.rulesText || "",
        images: Array.isArray(body.rulesImages) ? body.rulesImages : [],
      },
      extras: {
        text: body.extrasText || "",
        images: Array.isArray(body.extrasImages) ? body.extrasImages : [],
      },
      comments: [],
      reviewedAt: null,
      reviewedBy: null,
      publishedPuzzleId: null,
    };
    if (body.comment && body.comment.trim()) {
      sub.comments.push({
        authorUsername: req.user.username,
        isAdmin: false,
        text: body.comment.trim(),
        createdAt: new Date().toISOString(),
      });
    }
    db.submissions.push(sub);
    return sub;
  });

  res.status(201).json({ submission });
}));

// GET /api/submissions/mine — the current user's own submissions, with comments.
router.get("/mine", asyncHandler(async (req, res) => {
  const submissions = await withDb((db) =>
    db.submissions
      .filter((s) => s.submittedBy === req.user.id)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  );
  res.json({ submissions });
}));

// POST /api/submissions/:id/comments — add a follow-up comment. Only the
// original submitter (admins use the separate /api/admin/submissions/:id/comments
// endpoint, which doesn't require ownership) can post here.
router.post("/:id/comments", asyncHandler(async (req, res) => {
  const text = (req.body && req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Comment text is required." });

  const result = await withDb((db) => {
    const sub = db.submissions.find((s) => s.id === req.params.id);
    if (!sub) return { error: "Not found." };
    if (sub.submittedBy !== req.user.id) return { error: "You can only comment on your own submissions." };
    sub.comments = sub.comments || [];
    sub.comments.push({
      authorUsername: req.user.username,
      isAdmin: false,
      text,
      createdAt: new Date().toISOString(),
    });
    return { submission: sub };
  });

  if (result.error) return res.status(result.error.includes("own") ? 403 : 404).json(result);
  res.json(result);
}));

module.exports = router;

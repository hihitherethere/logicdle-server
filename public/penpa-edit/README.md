# Put penpa-edit here

This folder is intentionally empty. Clone the real penpa-edit app into it:

```bash
git clone https://github.com/swaroopg92/penpa-edit /tmp/penpa-edit-src
cp -r /tmp/penpa-edit-src/docs/* public/penpa-edit/
rm public/penpa-edit/README.md   # this file — no longer needed once populated
```

Note the `docs/` in that `cp` line — the actual web app (index.html, js/,
css/, etc.) lives in the repo's `docs/` folder, not its root. The repo
root is mostly project metadata (README, CHANGELOG, LICENSE,
package.json). GitHub Pages for `swaroopg92.github.io/penpa-edit/` is
configured to publish from that same `docs/` folder, which is why the
public demo works but a naive copy of the repo root won't.

Why it needs to live here (rather than just linking to the public
`swaroopg92.github.io/penpa-edit` instance): the solve page embeds it in
an `<iframe src="/penpa-edit/#...">`. Serving it from your own domain
makes that iframe **same-origin**, which is what allows
`solve-detect.js` to look inside it and detect the "Congratulations"
success popup automatically. A cross-origin iframe (pointing at
someone else's domain) would be blocked from that by the browser's
same-origin policy — see the root README for the full explanation.

Two things to check after cloning:

- Re-clone occasionally to pick up upstream fixes.
- penpa-edit's `LICENSE` says MIT, but its `CHANGELOG.md` also has a note
  about secondary distribution — worth a quick read of both, and
  possibly a note to the maintainer, before deploying this publicly.

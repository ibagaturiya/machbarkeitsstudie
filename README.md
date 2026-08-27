# machbarkeitsstudie

Feasibility-study tool for Wohnzonen in the Kanton Zürich: address in →
buildable volume out, every number traced to its article.

## What is in this repo

| Path | What it is |
|---|---|
| **`machbarkeitsstudie-tool/`** | **The application.** This folder is published verbatim as the site root — `index.html` is the main page. See its [README](machbarkeitsstudie-tool/README.md) for the full layout, and [REGELN.md](machbarkeitsstudie-tool/REGELN.md) for every legal rule the tool applies, in application order. |
| `.claude/launch.json` | Dev-server config, so the app can be started and driven locally instead of being verified by pushing to Pages. |
| `.github/workflows/pages.yml` | Runs the golden tests, then deploys `machbarkeitsstudie-tool/` to GitHub Pages on every push to `main`. |
| `888_issues/` | Screenshots of open UI defects. Not shipped. |
| `999_cookies/` | Reference material: the build plan, and the Zumikon client plans (Ausnützung, Kubische Berechnung, Projektpläne) the tool's output is checked against. Not shipped. |
| `CLAUDE.md` | Engineering rules for this repo. |

## `.git` is a file here, not a folder

The working tree lives in iCloud Drive (it has to — `machbarkeitsstudie/CLAUDE.md`
layers on `../CLAUDE.md`, the Cowork OS root). iCloud and git fight over the
same lock files: on 2026-08-27 a stale, empty `.git/HEAD.lock` from two days
earlier blocked a commit outright, which is the classic symptom.

So the git database was moved out of the synced area:

```
.git                     → a pointer file: "gitdir: /Users/iab/gitdirs/machbarkeitsstudie.git"
~/gitdirs/machbarkeitsstudie.git   → the actual repository (~58 MB), not synced
```

Set up with `git init --separate-git-dir` — the same mechanism submodules and
worktrees use, so every git command behaves normally. iCloud keeps backing up
the source files; GitHub holds the history; nothing races for a lock.

**Consequence worth knowing:** `~/gitdirs/` is *not* backed up by iCloud. If it
is lost, the working tree here is orphaned — recover by re-cloning from GitHub
rather than trying to repair it. Anything unpushed at that moment is gone, which
is one more reason to push once a change is verified.

## Working on it

```
cd machbarkeitsstudie-tool && node tests/run-tests.mjs && python3 serve.py
```

Tests first (wiring + legal arithmetic), then the dev server on
<http://localhost:8000>. Verify locally — tests green *and* a look at the
running app — before pushing; the push is the deploy.

Hosted: <https://ibagaturiya.github.io/machbarkeitsstudie/>

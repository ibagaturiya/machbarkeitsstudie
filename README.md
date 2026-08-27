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

## Working on it

```
cd machbarkeitsstudie-tool && node tests/run-tests.mjs && python3 serve.py
```

Tests first (wiring + legal arithmetic), then the dev server on
<http://localhost:8000>. Verify locally — tests green *and* a look at the
running app — before pushing; the push is the deploy.

Hosted: <https://ibagaturiya.github.io/machbarkeitsstudie/>

# CLAUDE.md — Machbarkeitsstudie (Kanton Zürich)

Engineering rules for **this repository**. They layer on top of, and never replace,
`../CLAUDE.md` (Cowork OS: memory system, tone, workstation routing, the
commit/push/deploy rule). Where both speak, the stricter one wins.

Two existing documents stay authoritative and are **not** superseded by this file:

| Document | Authority over |
|---|---|
| `machbarkeitsstudie-tool/REGELN.md` | Every legal rule the tool applies, in application order, with its Rechtsgrundlage and code location. The audit document. |
| `machbarkeitsstudie-tool/README.md` | How to run, test, export, deploy, and add a commune. |

Before adding a rule, a constant, or a helper anywhere, read the matching section of
`REGELN.md` first — §5 already lists every constant and whether it is a Rechtswert or
a Werkzeug-Annahme.

---

## 1. The Prepend Protocol

**New goes on top.** New features, functions, modules, rule blocks, changelog and log
entries are added at the **top** of the file, module, or block they belong to — never
appended at the bottom. The most recent thing is the first thing read.

- **Check before you add.** Search for an existing helper or rule first
  (`grep -rn "functionName" js/`). Shared geometry lives in `js/coordinates.js`, the
  massing arithmetic in `js/envelope.js`, legal values in `data/*.json`. Duplicating a
  helper into a second file is how the Attika setback drifts out of sync between the
  initial computation and the drag recompute — that is a real defect class here, not a
  style preference.
- **Do not rewrite a file to satisfy this rule.** It governs *additions*, not existing
  content.

**Carve-outs — prepending is wrong in these four places:**

1. **File preamble.** `window.MachbarkeitTool = window.MachbarkeitTool || {};` and the
   opening IIFE stay first. New code goes at the top *inside* the IIFE.
2. **`const`/`let` at module scope.** JS has no hoisting for these (temporal dead
   zone). A `const` must be declared above its first *executed* use — `function`
   declarations hoist and may be prepended freely.
3. **Ordered legal pipelines.** `deriveFootprint()` / `analyse()` in `js/app.js` run the
   steps of `REGELN.md` §3 in a binding sequence (Grundabstand → grosser Grenzabstand →
   Waldabstand → Baulinien → Längenteilung → anrechenbare Fläche → Deckel → AZ). Each
   step consumes the previous one's result. Insert a step **at its legal position**, and
   record why in the same commit. Same for `REGELN.md`'s own numbering.
4. **Ordered data.** JSON key order and the `_provenance` blocks mirror the article
   order of the source PDF. Keep them aligned with the document.

---

## 2. Zero-Assumption Policy

Never guess a structural variable or a legal definition. This sharpens two rules that
already exist — "If you're not sure about something, say so. Don't guess." (`../CLAUDE.md`)
and `REGELN.md` §1, where an unsupported zone or commune **aborts with an error instead of
falling back to a default**.

**Halt code generation immediately and ask** — as a short bulleted list in the terminal,
one bullet per missing item, no partial implementation in the meantime — when any of
these is unspecified:

- **Kanton** — the entire ruleset here is Zürich (PBG 700.1, ABV 700.2). No other canton.
- **Gemeinde** — Grenzabstand and Grünflächenziffer exist *only* in the communal BZO, not
  in the cantonal dataset. On file: Zürich, Zumikon. A third commune needs its own
  `data/bzo-*.json` with per-value provenance.
- **Zone** — e.g. `W2/25`, `W2b`. Wohnzonen only.
- **Messweise** — say which height/distance regime applies before writing any formula:
  - *altrechtlich* (§ 281 aPBG): Gebäudehöhe, Firsthöhe as a **Zuschlag** above the
    Schnittlinie — what Zumikon uses today;
  - *traufseitige Fassadenhöhe* (E-BZO Art. 32/138) — Zürich;
  - *IVHB / harmonisierte Begriffe* — **not** the regime these BZOs are written in.
    Do not silently compute "per IVHB"; if a task calls for it, that is a new regime and
    needs its own data, provenance and tests.
  - Grenzabstand measurement: § 22 ABV, rechtwinklig zur Fassade, on the **Gebäude**
    rectangle (Art. 18 Abs. 2 BZO Zumikon) — the parcel-edge approximation currently in
    use is a documented simplification, not the rule.

**`null` means "this rule does not exist here" — never 0, never a default.** A missing
value is a halt condition, not an opportunity to interpolate.

**Uncertainty must survive to the screen.** Where the tool cannot know something, it
shows a flag or a `review` item; a failed data source is never rendered as a green PASS
(`REGELN.md` §2, §3.17).

---

## 3. Prompt Caching & Token Discipline

The application itself makes **no LLM calls** — see §4: legal evaluation never touches a
model at runtime. This rule therefore governs (a) how large legal texts are fed to Claude
during development, and (b) any future pipeline that processes PBG/BZO/SIA text.

**Foundational texts go first and stay byte-identical.** Caching is a *prefix match*:
one changed byte invalidates everything after it. Render order is `tools` → `system` →
`messages`, so the stable material — statute excerpts, `data/*.json`, `REGELN.md` — belongs
at the very front of the context or pipeline, and the volatile part (the parcel, the
question, timestamps, run IDs) goes last, after the final breakpoint.

- Put the `cache_control: {"type": "ephemeral"}` breakpoint at the end of the **shared**
  block, not at the end of the whole prompt — otherwise every request writes a new entry
  and none is ever read. Max 4 breakpoints per request.
- TTL is 5 minutes by default, `"ttl": "1h"` for bursty work. Write costs 1.25× (5 min) or
  2× (1 h); reads cost ~0.1× of base input — that is where the "up to 90 %" comes from,
  and it applies to the **cached portion only**.
- Minimum cacheable prefix is model-dependent (512 tokens on Claude Opus 5, higher on
  older models). Below it, nothing caches and no error is raised.
- Verify with `usage.cache_read_input_tokens`. Zero across repeated runs means a silent
  invalidator sits in the prefix — a `Date.now()`, a per-run id, an unsorted `JSON.stringify`.
- Never truncate a statute to make it fit. Chunk it, or say it does not fit.

**In this repo specifically:** the PDFs under `machbarkeitsstudie-tool/source/` are large
and immutable. Read a cited page range rather than the whole document, and keep the
extracted quote in `_provenance` so nothing has to be re-read to answer "says who".

---

## 4. Deterministic If/Else Translation

**No model evaluates legal compliance at runtime. Ever.** Every rule is compiled ahead of
time into explicit conditional structures — this is already how the tool works, and it is
not negotiable: a Machbarkeitsstudie has to produce the same numbers twice.

- Legal values live in `data/*.json` with a `_provenance` entry (file, page, article,
  quote). Code reads them; code does not infer them.
- Branches are explicit and exhaustive. Every `if` chain over a legal case ends in an
  `else` that either handles the case or **throws** — never a silent fallthrough, never an
  implicit default.
- Spatial checks compare against exact boundaries and raise a typed, named error when
  breached (e.g. a Baukörper below `MIN_PRIMITIVE_WIDTH_M`, an Attika that fails the
  45° profile). The error message states the value, the limit, and the article.
- A Werkzeug-Annahme is never presented as a Rechtswert. `REGELN.md` §5 is the register;
  the UI's Quellen section repeats the distinction.

**Numeric precision — how this is implemented honestly here.** This project is
deliberately build-step-free plain browser JS (no `package.json`, no bundler, no
TypeScript): there is no decimal type, and JS numbers are IEEE-754 doubles. "Strongly
typed decimals" cannot be taken literally, so the requirement is met as:

- Legal quantities are stored as **exact literals** from the source document (`6.5`, `25`,
  `1.0`) and never re-derived, re-rounded, or round-tripped through a percentage.
- Comparisons on legal thresholds use an **explicit, documented epsilon** at the precision
  of the source (`>= x - 1e-6` for metres) — never bare `==` on a computed float, never an
  undocumented tolerance.
- Rounding happens **once, at display time** (`fmt()`), never inside the computation chain.
- Types are enforced by runtime guards at module boundaries plus JSDoc annotations;
  a non-finite or missing legal value throws instead of propagating `NaN`.
- If a future change needs real decimal arithmetic or a type system, that is a build-step
  decision to raise explicitly — do not smuggle it in.

---

## Commands

```
cd machbarkeitsstudie-tool
python3 serve.py                 # dev server on :8000 — not `python3 -m http.server`
node tests/run-tests.mjs         # golden tests; must be green before every commit
```

`file://` does not work (fetch is blocked). Deployment is a push to `main`:
`.github/workflows/pages.yml` runs the golden tests first, then publishes
`machbarkeitsstudie-tool/` to <https://ibagaturiya.github.io/machbarkeitsstudie/>.
Per `../CLAUDE.md`: verify (tests **and** a look at the running app), then commit, push and
deploy without asking, and report whether the deploy landed.

## The invariant

> **Mehr Land darf nie weniger Baurecht ergeben.**

Guarded by the monotonicity golden test. Any change that touches the derivation chain has
to keep it true.

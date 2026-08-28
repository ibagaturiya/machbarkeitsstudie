// protokoll.js — das Laufprotokoll eines Durchgangs.
//
// Eine Zeile je Pipeline-Schritt mit ihrer Dauer, eine je gefeuertem
// Paragraphen, eine je Werkzeug-Annahme. Das ist der Grund, warum das
// Werkzeug so aussieht, wie es aussieht: es rechnet deterministisch, ohne
// Modell (CLAUDE.md §4), und der einzige Weg, das sichtbar zu machen, ist
// das Protokoll neben dem Ergebnis stehen zu lassen.
//
// Bewusst in js/ui/ und NICHT in js/core/: hier laeuft eine Uhr. core/ ist
// per Definition deterministisch — gleiche Eingaben, gleiche Zahlen — und
// eine Wanduhr im Protokoll waere genau die Sorte stiller Nichtdeterminismus,
// die die Golden-Tests nicht mehr fassen koennten. Das Protokoll beschreibt
// den Lauf, nicht das Recht.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // Vier Arten, mehr nicht. Jede hat ein Kuerzel und eine Farbe (panels.css):
  //   step  run  ein Rechenschritt, mit ms
  //   ok    ok   eine Pruefung, die gehalten hat
  //   cite  §    eine Rechtsnorm, die tatsaechlich gefeuert hat
  //   warn  !    eine Annahme oder eine Quelle, die nicht erreichbar war
  const BADGE = { step: 'run', ok: 'ok', cite: '§', warn: '!' };

  function stamp(ms) {
    const d = new Date(ms);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  }

  // `now` ist injizierbar, damit ein Test das Protokoll deterministisch
  // pruefen kann, ohne auf die Systemuhr zu warten.
  function createProtokoll({ now = () => Date.now(), onLine = null } = {}) {
    const t0 = now();
    const lines = [];
    const marks = new Map();
    const timings = [];

    function push(kind, msg, ms) {
      if (!BADGE[kind]) throw new Error(`Unbekannte Protokollart "${kind}"`);
      const line = { t: stamp(now()), kind, badge: BADGE[kind], msg: String(msg), ms: ms ?? null };
      lines.push(line);
      if (onLine) onLine(line);
      return line;
    }

    const api = {
      lines,
      timings,

      step: (msg, ms) => push('step', ms != null ? `${msg} · ${Math.round(ms)} ms` : msg, ms),
      ok: (msg) => push('ok', msg),
      warn: (msg) => push('warn', msg),

      // Eine Zitatzeile entsteht NUR aus einer Norm, die in diesem Lauf
      // wirklich angewandt wurde. `article` kommt aus dem _provenance-Block
      // der Datendatei, nicht aus dieser Datei — hier wird kein Paragraph
      // erfunden (CLAUDE.md §4).
      cite: (article, was) => {
        if (!article) return null;
        return push('cite', was ? `${article} — ${was}` : String(article));
      },

      // Zeitmessung: mark() setzt den Startpunkt, stage() schliesst ihn ab
      // und schreibt die Zeile mit der gemessenen Dauer.
      mark(key) { marks.set(key, now()); return api; },
      since(key) { return marks.has(key) ? now() - marks.get(key) : null; },
      stage(key, msg) {
        const ms = api.since(key);
        if (ms != null) timings.push({ key, ms });
        return push('step', ms != null ? `${msg} · ${Math.round(ms)} ms` : msg, ms);
      },

      elapsedMs() { return now() - t0; },

      // Die Laufzusammenfassung wird GEZAEHLT, nicht getippt: Regeln aus den
      // Zitatzeilen, Annahmen aus den Kennwerten mit kind ANNAHME, Konflikte
      // aus den Warnungen, die eine Quelle als nicht pruefbar melden.
      summary({ kennwerte = [], conflicts = 0 } = {}) {
        const rows = kennwerte.flatMap((g) => g.rows);
        const rulesChecked = new Set(
          lines.filter((l) => l.kind === 'cite').map((l) => l.msg.split(' — ')[0])
        ).size + rows.filter((r) => r.kind === 'GEPRÜFT').length;
        // Nur Zeilen, die wirklich als ANNAHME gekennzeichnet sind. Die
        // Warnungen NICHT dazuzaehlen: eine ausgefallene Quelle ist ein
        // Konflikt, keine Annahme, und beides in einer Zahl zu mischen
        // machte die Zusammenfassung unpruefbar gegen die Tafel daneben.
        const assumptions = rows.filter((r) => r.kind === 'ANNAHME').length;
        return {
          rulesChecked,
          assumptions,
          conflicts,
          durationMs: api.elapsedMs(),
          citations: lines.filter((l) => l.kind === 'cite').length,
          warnings: lines.filter((l) => l.kind === 'warn').length,
        };
      },
    };
    return api;
  }

  T.createProtokoll = createProtokoll;
})();

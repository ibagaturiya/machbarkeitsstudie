// liquid-glass.js — Lichtbrechung am Rand der Glasfenster.
//
// Nach der Herleitung von https://kube.io/blog/liquid-glass-css-svg/ (gelesen
// 30.08.2026). Die Idee: eine Glasscheibe ist am Rand nicht flach, sondern
// angeschrägt. Licht, das durch diese Schräge fällt, wird gebrochen — der
// Hintergrund erscheint dort seitlich versetzt. Genau diesen Versatz kann
// SVG zeichnen: <feDisplacementMap /> verschiebt jeden Bildpunkt um einen
// Betrag, den ein zweites Bild vorgibt (Rot = x, Grün = y, 128 = kein
// Versatz). Dieses zweite Bild wird hier gerechnet.
//
// ZWEI DINGE VORWEG, beide unangenehm:
//
// 1. Das trägt NUR Chromium. Ein SVG-Filter als `backdrop-filter` ist
//    ausserhalb von Chromium nicht implementiert — Safari und Firefox
//    kennen `backdrop-filter`, aber nicht mit `url(#…)`. Deshalb fasst
//    dieses Modul das CSS gar nicht erst an, wenn die Engine nicht passt:
//    die Fenster behalten dann ihr mattiertes Glas aus css/tokens.css. Was
//    dort trotzdem nach Glas aussieht — Fase, Lichtkante, Innenschatten —
//    steht in css/shell.css und läuft überall, ohne dieses Modul.
//
// 2. Eine falsche Erkennung wäre teuer. Setzte man `backdrop-filter:
//    url(#f) blur(18px)` in Safari, verwürfe Safari die GANZE Deklaration
//    als ungültig — samt Weichzeichner. Die Fenster wären dann nicht
//    weniger schön, sondern unlesbar: klare Sicht auf das Millimeterpapier
//    unter dem Text. Darum wird der Wert erst gesetzt, nachdem er sich als
//    anwendbar erwiesen hat, und die CSS-Regel bleibt als Boden liegen.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // ---- Kennzahlen der Scheibe -------------------------------------------
  // BEZEL_PX: wie breit die Schräge ist, von der Kante nach innen. Darüber
  // hinaus ist die Scheibe flach und bricht nichts (Versatz 0).
  // N_GLAS: Brechungsindex. 1.5 ist Fensterglas; höher bricht stärker.
  // SCALE_PX: der maximale Versatz in Pixeln, den feDisplacementMap aus dem
  // normierten Vektorfeld macht — die Stärke des Effekts.
  // Werte am laufenden Bild eingestellt (Chromium, 30.08.2026): die Brechung
  // zeigt, was HINTER der Scheibe liegt, und dahinter liegt hier nur das
  // schwach gezeichnete Millimeterpapier. Am unteren Ende des vom Artikel
  // genannten Bereichs (Fase 8-16 px, Versatz 20-40 px) war deshalb kaum
  // etwas zu sehen; am oberen Ende steht die Kante, ohne dass der Text
  // darueber leidet -- gebrochen wird der Untergrund, nicht der Inhalt.
  const BEZEL_PX = 11;
  const N_GLAS = 1.5;
  const SCALE_PX = 16;
  // Über dieser Kantenlänge wird die Karte in Schritten gerundet, damit
  // nicht jede Pixelbreite beim Ziehen des Fensters eine neue Karte kostet.
  const GROESSEN_RASTER = 24;

  // ---- 1. Das Höhenprofil der Fase --------------------------------------
  // t läuft von 0 an der Kante bis 1 am inneren Ende der Fase. Zurück kommt
  // die Dicke des Glases an dieser Stelle, ebenfalls 0…1.
  //
  // Die vierte Wurzel (Squircle) statt des Kreises: der Kreis geht am
  // inneren Ende mit einem Knick in die flache Fläche über, und dieser Knick
  // zeichnet sich als sichtbarer Ring im Fenster ab. Die Squircle-Variante
  // läuft weich aus — es ist auch die Form, die Apple für diese Optik nimmt.
  function hoehe(t) {
    const u = 1 - Math.min(1, Math.max(0, t));
    return Math.pow(1 - u * u * u * u, 0.25);
  }

  // Steigung der Oberfläche an der Stelle t, numerisch. Daraus folgt die
  // Flächennormale und damit der Einfallswinkel.
  function steigung(t) {
    const d = 1e-3;
    const a = hoehe(Math.min(1, t + d));
    const b = hoehe(Math.max(0, t - d));
    return (a - b) / (2 * d);
  }

  // ---- 2. Brechung ------------------------------------------------------
  // Der einfallende Strahl steht senkrecht auf dem Hintergrund. Der Winkel
  // zwischen ihm und der Flächennormalen ist also gerade der Neigungswinkel
  // der Oberfläche. Snellius: sin(θ1) = n · sin(θ2). Was den Bildpunkt
  // verschiebt, ist die Differenz der beiden Winkel.
  //
  // Rückgabe: der seitliche Versatz, noch unnormiert, quer zur Kante nach
  // aussen. Bei senkrechtem Einfall und n = 1.5 gibt es keine Totalreflexion
  // — der Fall muss also nicht abgefangen werden.
  function versatz(t) {
    const m = steigung(t);
    if (!isFinite(m)) return 0;
    const theta1 = Math.atan(m);
    const theta2 = Math.asin(Math.sin(theta1) / N_GLAS);
    return Math.tan(theta1 - theta2) * hoehe(t);
  }

  // ---- 3. Abstand zur Kante eines abgerundeten Rechtecks -----------------
  // Vorzeichenbehaftete Distanzfunktion, innen negativ. Analytisch statt
  // gemessen: das kostet je Bildpunkt eine Wurzel statt einer Suche.
  function sdRoundRect(px, py, w, h, r) {
    const qx = Math.abs(px) - (w / 2 - r);
    const qy = Math.abs(py) - (h / 2 - r);
    return Math.min(Math.max(qx, qy), 0)
      + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  }

  // ---- 4. Die Karte -----------------------------------------------------
  // Ein RGBA-Bild in der Grösse des Fensters: Rot trägt den Versatz in x,
  // Grün den in y, 128 heisst «hier nichts verschieben». Die Richtung ist
  // der Gradient der Distanzfunktion, also die Flächennormale in der Ebene;
  // er wird über zwei Differenzen genommen statt analytisch, weil die
  // Ableitung an den Ecken des abgerundeten Rechtecks unstetig ist.
  function baueKarte(w, h, r) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: false });
    const img = ctx.createImageData(w, h);
    const px = img.data;

    // Erst die Beträge sammeln, dann gemeinsam normieren: feDisplacementMap
    // rechnet mit einem einzigen `scale`, also muss der grösste Versatz
    // genau 1 ergeben, sonst stimmt die Stärke nicht mit SCALE_PX überein.
    const vx = new Float32Array(w * h);
    const vy = new Float32Array(w * h);
    let max = 0;
    const cx = w / 2, cy = h / 2;
    const d = 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const sx = x + 0.5 - cx, sy = y + 0.5 - cy;
        const sd = sdRoundRect(sx, sy, w, h, r);
        const tiefe = -sd; // Abstand von der Kante nach innen
        if (sd > 0 || tiefe >= BEZEL_PX) continue; // aussen oder flach: 0

        const t = tiefe / BEZEL_PX;
        const betrag = versatz(t);
        if (betrag === 0) continue;

        // Gradient der Distanzfunktion = Richtung «nach aussen».
        let gx = sdRoundRect(sx + d, sy, w, h, r) - sdRoundRect(sx - d, sy, w, h, r);
        let gy = sdRoundRect(sx, sy + d, w, h, r) - sdRoundRect(sx, sy - d, w, h, r);
        const len = Math.hypot(gx, gy);
        if (len < 1e-6) continue;
        gx /= len; gy /= len;

        vx[i] = gx * betrag;
        vy[i] = gy * betrag;
        const a = Math.abs(vx[i]), b = Math.abs(vy[i]);
        if (a > max) max = a;
        if (b > max) max = b;
      }
    }

    const k = max > 0 ? 127 / max : 0;
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      px[p] = 128 + vx[i] * k;
      px[p + 1] = 128 + vy[i] * k;
      px[p + 2] = 128;
      px[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  // ---- 5. Filter je Fenstergrösse ---------------------------------------
  // Gleich grosse Fenster teilen sich einen Filter: die Karte hängt allein
  // an Breite, Höhe und Radius. Auf diesem Bildschirm sind das statt elf
  // Karten drei bis vier.
  const filterCache = new Map();
  let defsHost = null;
  let lfd = 0;

  function defs() {
    if (defsHost) return defsHost;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    defsHost = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defsHost);
    document.body.appendChild(svg);
    return defsHost;
  }

  function filterFuer(w, h, r) {
    const key = `${w}x${h}r${r}`;
    const da = filterCache.get(key);
    if (da) return da;

    const id = `lg-${++lfd}`;
    const NS = 'http://www.w3.org/2000/svg';
    const f = document.createElementNS(NS, 'filter');
    f.setAttribute('id', id);
    // userSpaceOnUse mit dem Kasten des Fensters: sonst legt der Browser die
    // Filterfläche prozentual um das Element und die Karte sitzt versetzt.
    f.setAttribute('filterUnits', 'userSpaceOnUse');
    f.setAttribute('primitiveUnits', 'userSpaceOnUse');
    f.setAttribute('x', '0'); f.setAttribute('y', '0');
    f.setAttribute('width', String(w)); f.setAttribute('height', String(h));
    // sRGB, nicht linearRGB: sonst rechnet der Filter die Kanäle vorher um
    // und aus «128 = keine Verschiebung» wird ein schleichender Drift.
    f.setAttribute('color-interpolation-filters', 'sRGB');

    const fe = document.createElementNS(NS, 'feImage');
    fe.setAttribute('x', '0'); fe.setAttribute('y', '0');
    fe.setAttribute('width', String(w)); fe.setAttribute('height', String(h));
    fe.setAttribute('result', 'karte');
    fe.setAttribute('href', baueKarte(w, h, r));

    const dm = document.createElementNS(NS, 'feDisplacementMap');
    dm.setAttribute('in', 'SourceGraphic');
    dm.setAttribute('in2', 'karte');
    dm.setAttribute('scale', String(SCALE_PX));
    dm.setAttribute('xChannelSelector', 'R');
    dm.setAttribute('yChannelSelector', 'G');

    f.appendChild(fe); f.appendChild(dm);
    defs().appendChild(f);
    filterCache.set(key, id);
    return id;
  }

  // ---- 6. Anwenden ------------------------------------------------------
  // Der Weichzeichner bleibt: die Brechung allein macht den Untergrund nicht
  // ruhig genug, um Text darueber zu lesen. Steht vor seiner Verwendung --
  // `const` kennt kein Hoisting (CLAUDE.md §1, Carve-out 2).
  const BLUR = 'blur(20px) saturate(115%)';

  const raster = (v) => Math.max(GROESSEN_RASTER,
    Math.round(v / GROESSEN_RASTER) * GROESSEN_RASTER);

  function anwenden(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 * BEZEL_PX || rect.height < 2 * BEZEL_PX) return;
    const w = raster(rect.width), h = raster(rect.height);
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    if (el.dataset.lgKey === `${w}x${h}r${r}`) return;
    el.dataset.lgKey = `${w}x${h}r${r}`;
    const id = filterFuer(w, h, Math.min(r, Math.min(w, h) / 2));
    el.style.backdropFilter = `url(#${id}) ${BLUR}`;
  }

  // ---- 7. Erkennung -----------------------------------------------------
  // CSS.supports('backdrop-filter','url(#x)') meldet in Safari `true`,
  // obwohl dort nichts gebrochen wird — als alleiniges Kriterium taugt es
  // also nicht. `navigator.userAgentData` gibt es nur in Chromium; das ist
  // hier kein Schnüffeln am User-Agent-String, sondern die Prüfung auf eine
  // Schnittstelle, die genau mit der gesuchten Fähigkeit zusammenfällt.
  // Liegt man daneben, bleibt das mattierte Glas stehen — kein Schaden.
  function traegtDieEngine() {
    if (typeof CSS === 'undefined' || !CSS.supports) return false;
    if (!CSS.supports('backdrop-filter', 'url(#x)')) return false;
    const uad = navigator.userAgentData;
    if (!uad || !Array.isArray(uad.brands)) return false;
    return uad.brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand));
  }

  let beobachter = null;

  function start() {
    if (!traegtDieEngine()) return false;
    document.documentElement.classList.add('has-liquid-glass');
    const ziele = () => document.querySelectorAll('.panel');
    beobachter = new ResizeObserver((eintraege) => {
      for (const e of eintraege) anwenden(e.target);
    });
    ziele().forEach((el) => { anwenden(el); beobachter.observe(el); });
    return true;
  }

  T.liquidGlass = { start, baueKarte, hoehe, versatz };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

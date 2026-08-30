// netz.js — jeder Netzabruf sagt, WELCHE Quelle ausgefallen ist.
//
// Anlass: eine Studie brach mit «Fehler: Load failed» ab. Vier Worte, und
// zwar genau dieselben vier, egal welcher der sieben Dienste gerade nicht
// antwortete — Adresssuche, Zonenplan, Parzellengeometrie, Höhenmodell,
// Waldabstand, ÖREB oder die BZO-Datei. «Load failed» ist Safaris Wortlaut
// für ein fetch(), das nie zustande kam (Chrome sagt «Failed to fetch»);
// die Meldung stammt aus der Netzwerkschicht und trägt naturgemäss keinen
// Hinweis darauf, wohin die Anfrage ging.
//
// Die HTTP-Fehler waren nie das Problem: jede Aufrufstelle prüft res.ok
// selbst und nennt dabei ihren Dienst («Kantonale Nutzungsplanung: HTTP
// 503»). Der blinde Fleck ist der Fall DAVOR — kein Netz, kein DNS, TLS
// abgewiesen, Anfrage blockiert. Genau den fängt fetchQuelle ab.
//
// Warum ein eigener Fehlertyp: REGELN.md §2 verlangt, dass eine
// ausgefallene Datenquelle als solche sichtbar bleibt und nie als
// bestandene Prüfung durchgeht. Ein benannter Typ lässt die Aufrufer
// unterscheiden, ob die Quelle FEHLT (weiterrechnen mit Vorbehalt) oder ob
// die Antwort inhaltlich nicht passt (Abbruch) — ein `Error` mit
// zusammengebautem Text kann das nicht.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // Der Host kommt aus der URL, nicht aus einer zweiten Konstante — sonst
  // zeigt die Meldung eines Tages auf einen Dienst, der längst umgezogen
  // ist (CLAUDE.md §1: nicht duplizieren).
  // Zuerst als absolute URL lesen und erst dann die Seitenadresse als Basis
  // heranziehen: eine absolute URL darf nicht davon abhaengen, dass es ein
  // window.location gibt. Sonst faellt die Auswertung ausserhalb des
  // Browsers (Testlauf) auf die rohe URL zurueck, und die Meldung traegt
  // statt des Hosts den ganzen Query-String.
  function hostVon(url) {
    const roh = String(url);
    try {
      return new URL(roh).host;
    } catch (e) {
      // relativ — braucht eine Basis
    }
    try {
      const basis = (typeof window !== 'undefined' && window.location)
        ? window.location.href : undefined;
      const u = new URL(roh, basis);
      return u.protocol === 'file:' ? roh : u.host;
    } catch (e) {
      return roh;
    }
  }

  class QuelleNichtErreichbarError extends Error {
    constructor(quelle, url, ursache) {
      const host = hostVon(url);
      super(`${quelle} (${host}) nicht erreichbar — `
        + `Netzwerkfehler: ${(ursache && ursache.message) || ursache}. `
        + `Keine Verbindung, DNS, TLS oder eine Blockade im Browser; `
        + `die Antwort kam nie an. Erneut versuchen.`);
      this.name = 'QuelleNichtErreichbarError';
      this.quelle = quelle;
      this.url = String(url);
      this.host = host;
      this.ursache = ursache;
    }
  }

  // Ersetzt fetch() überall dort, wo eine benannte Quelle abgerufen wird.
  // Gibt dieselbe Response zurück wie fetch — die res.ok-Prüfung bleibt bei
  // der Aufrufstelle, die ihren Dienst und ihre Semantik kennt.
  async function fetchQuelle(quelle, url, options) {
    if (typeof quelle !== 'string' || !quelle) {
      throw new TypeError('fetchQuelle: Quellenname fehlt');
    }
    try {
      return await fetch(url, options);
    } catch (ursache) {
      // AbortController-Abbrüche sind gewollt und kein Quellenausfall.
      if (ursache && ursache.name === 'AbortError') throw ursache;
      throw new QuelleNichtErreichbarError(quelle, url, ursache);
    }
  }

  T.QuelleNichtErreichbarError = QuelleNichtErreichbarError;
  T.fetchQuelle = fetchQuelle;
})();

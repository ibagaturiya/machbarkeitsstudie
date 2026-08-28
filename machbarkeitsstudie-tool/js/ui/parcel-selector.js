// parcel-selector.js — map-based click-to-select for the parcel(s) to
// analyse. Leaflet (CDN, no build step),
// chosen because it works with plain <script> tags and has first-class WMS/
// WMTS tile support, needed for both the basemap and the cadastral parcel
// overlay.
//
// Leaflet's default CRS is Web Mercator (EPSG:3857) with lat/lng in WGS84 --
// deliberately NOT fighting that with a custom EPSG:2056 CRS. Click
// coordinates are converted through coordinates.js (wgs84ToLv95) before
// hitting the identify API, and parcel polygons are converted the other way
// (lv95ToWgs84) before being drawn on the map.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  const T = window.MachbarkeitTool;

  // Cadastral webmap only -- it already renders parcels, parcel numbers,
  // buildings and street names on a clean white ground, which is exactly
  // what picking parcels needs.
  //
  // There used to be a ch.swisstopo.pixelkarte-farbe basemap underneath it.
  // Removed: at zoom 19 that layer renders buildings as solid black blocks,
  // and it 400s entirely at zoom 20, so tiles loaded inconsistently and the
  // map showed dark rectangular patches that looked like overlapping tiles.
  // One layer, no blending, no artifacts.
  // Amtliche Vermessung direkt vom Kanton Zürich (MapServer-WMS, on the fly
  // aus den Vektordaten gerendert). Ersetzt die gekachelte cadastralwebmap
  // des Bundes: deren WMTS-Cache lieferte Nachbarkacheln aus verschiedenen
  // Datenständen — Strassen und Parzellenlinien sprangen an den Kachel-
  // grenzen sichtbar um mehrere Pixel (mit drei nebeneinandergelegten
  // Originalkacheln verifiziert, 2026-08-28; der Bund-WMS zeigte dieselbe
  // Naht, er bedient sich aus demselben Cache). Der kantonale Dienst rendert
  // jede Anfrage frisch, die Geometrie stösst exakt aneinander, und die
  // Layergruppe blendet bei kleinen Massstäben selbst auf Landeskarten um
  // statt mit 400 zu antworten. Das Werkzeug rechnet ohnehin nur im Kanton
  // Zürich (CLAUDE.md, Zero-Assumption).
  const AV_WMS_URL = 'https://wms.zh.ch/AVfarbigZH';
  const CADASTRE_WMTS_URL = 'https://wmts.geo.admin.ch/1.0.0/ch.kantone.cadastralwebmap-farbe/default/current/3857/{z}/{x}/{y}.png'; // eslint-disable-line no-unused-vars -- dokumentiert die abgelöste Quelle
  // Underneath it: the grey national map as fallback ground. The cadastre
  // layer only exists at large scales — zoomed further out its tiles 400
  // and the pane went fully black. The cadastre's opaque white ground
  // covers this layer wherever it exists, so nothing blends at high zoom.
  const BASE_WMTS_URL = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg';
  // The cadastre layer serves up to z20 and 400s at z21, so cap there
  // rather than letting Leaflet request tiles that don't exist.
  const MAX_ZOOM = 20;

  function lv95RingToLatLngs(ring) {
    return ring.map(([e, n]) => {
      const { lat, lon } = T.lv95ToWgs84(e, n);
      return [lat, lon];
    });
  }

  // firstParcel: the object returned by geocodeAndIdentify() (has
  // .easting, .northing, .geometryLV95, .egrid, ...). onSelectionChange is
  // called with the current selection array after every add/remove.
  // Tracks the live map so a second search can tear it down. Leaflet refuses
  // to initialise a container twice ("Map container is already initialized"),
  // which is exactly what happened when searching another address without
  // reloading the page.
  let activeMap = null;

  // onHover bekommt die Parzellennummer, ueber der der Zeiger steht, oder
  // null. Nur fuer die BEREITS gewaehlten Polygone: die uebrigen Parzellen
  // kommen aus gerasterten Katasterkacheln, unter denen keine Geometrie
  // liegt -- ein Hover-Effekt auf ihnen hiesse, bei jeder Mausbewegung den
  // Identify-Dienst zu fragen. Der Entwurf ging von einer Vektor-Parzellen-
  // ebene aus; die hat diese Karte nicht, und so zu tun als ob waere ein
  // Effekt ohne Deckung.
  function initParcelMap(containerId, firstParcel, onSelectionChange, gemeindeOverride, onHover) {
    if (activeMap) {
      activeMap.remove();
      activeMap = null;
    }
    const { lat, lon } = T.lv95ToWgs84(firstParcel.easting, firstParcel.northing);
    // zoomAnimation/fadeAnimation off: with the default CSS-transform zoom
    // animation, the previous zoom level's tiles are scaled up and cross-
    // faded with the newly loading ones. The cadastral webmap draws thin
    // parcel-border lines, and a scaled copy of that line sitting a few
    // pixels from the freshly loaded one reads exactly like a doubled,
    // "stitched" outline while the new tiles are still arriving -- worse on
    // a slow connection, and this map is used for precise clicking, so a
    // hard zoom-swap (loses the smooth animation, keeps the lines clean) is
    // the right trade here.
    const map = L.map(containerId, { maxZoom: MAX_ZOOM, zoomAnimation: false, fadeAnimation: false })
      .setView([lat, lon], 19);
    activeMap = map;

    L.tileLayer(BASE_WMTS_URL, {
      maxZoom: MAX_ZOOM,
      // The grey map itself stops at z19; Leaflet upscales it beyond that,
      // invisible under the opaque cadastre tiles that cover those zooms.
      maxNativeZoom: 19,
      // Kein eigener Attribution-Text: die Kachel-Ebene darueber nennt
      // swisstopo bereits — zweimal "swisstopo" in der Leiste ist Rauschen.
      keepBuffer: 4,
      updateWhenZooming: false,
    }).addTo(map);
    L.tileLayer.wms(AV_WMS_URL, {
      layers: 'AVfarbigZH',
      format: 'image/png',
      version: '1.3.0',
      maxZoom: MAX_ZOOM,
      // 512er-Kacheln: halb so viele Requests an den ungecachten Dienst,
      // und Strassennamen wiederholen sich seltener je Bildschirm.
      tileSize: 512,
      attribution: 'AV GIS-ZH / swisstopo',
      keepBuffer: 2,
      updateWhenZooming: false,
    }).addTo(map);
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

    // Leaflet caches the container size at init and only paints tiles for
    // that rectangle. Anything that resizes the container afterwards -- the
    // results block appearing below and adding a scrollbar, a window
    // resize -- leaves unpainted grey gaps where tiles were never requested.
    // Re-measuring on every container resize is the fix; a one-off call
    // after init isn't enough because the results block renders later.
    const container = document.getElementById(containerId);
    if (window.ResizeObserver) {
      new ResizeObserver(() => map.invalidateSize()).observe(container);
    } else {
      window.addEventListener('resize', () => map.invalidateSize());
    }

    // selection: Map<egrid, { egrid, polygon(turf, LV95), areaM2, leafletLayer, zone, rules }>.
    // Insertion-ordered, and the first entry is the Ausgangsparzelle: its
    // zone drives the rules and its address titles the report.
    const selection = new Map();
    const layerGroup = L.layerGroup().addTo(map);

    // Which parcel is currently the anchor -- not pinned to the one the
    // address resolved to. Clicking the blue parcel deselects it like any
    // other, so a neighbouring parcel can be picked straight off the map
    // instead of typing a second address to get there.
    let anchorEgrid = null;

    // Die Auswahl traegt die Akzentfarbe der Oberflaeche, nicht mehr Blau
    // und Rot: der ganze Bildschirm hat genau einen Akzent, und eine Karte
    // mit zwei fremden Signalfarben darin liest sich wie ein zweites
    // Werkzeug. Die Ausgangsparzelle steht voll im Akzent, weitere in der
    // helleren Stufe -- der Rang bleibt sichtbar, ohne eine dritte Farbe.
    // Die Werte werden aus den CSS-Variablen gelesen, damit --acc weiterhin
    // die EINE Stelle ist, an der die Farbe des Werkzeugs steht.
    const cssVar = (name, fallback) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    };
    const ACC = cssVar('--acc', '#ff9d2e');
    const ACC2 = cssVar('--acc2', '#ffbe63');
    const ANCHOR_STYLE = { color: ACC, weight: 2.5, fillColor: ACC, fillOpacity: 0.3 };
    const EXTRA_STYLE = { color: ACC2, weight: 1.8, fillColor: ACC2, fillOpacity: 0.2 };

    function styleFor(egrid) {
      return egrid === anchorEgrid ? ANCHOR_STYLE : EXTRA_STYLE;
    }

    // A representative LV95 point inside the parcel. Only the address-
    // resolved parcel arrives with easting/northing (the geocoder's), and
    // the anchor's point is what the terrain-height lookup is sampled at --
    // so a map-clicked parcel promoted to anchor needs one of its own, or
    // the height service is called with undefined and 400s.
    //
    // The centroid, not the click: two people clicking different corners of
    // the same parcel should get the same report. A centroid can fall
    // outside an L-shaped parcel, so it is tested first and the click point
    // (always inside, by construction) is the fallback.
    function representativePoint(parcelData, clickPoint) {
      if (Number.isFinite(parcelData.easting) && Number.isFinite(parcelData.northing)) {
        return { easting: parcelData.easting, northing: parcelData.northing };
      }
      try {
        const poly = T.parcelToTurfPolygon(parcelData.geometryLV95);
        const c = turf.centroid(poly).geometry.coordinates;
        if (turf.booleanPointInPolygon(turf.point(c), poly)) {
          return { easting: c[0], northing: c[1] };
        }
      } catch (_) { /* odd geometry -- fall through to the click point */ }
      return clickPoint;
    }

    function addToSelection(parcelData, clickPoint) {
      if (selection.has(parcelData.egrid)) return;
      // Anchor first, then style: an empty selection makes whatever is
      // clicked next the new Ausgangsparzelle.
      if (anchorEgrid === null) anchorEgrid = parcelData.egrid;
      const latlngs = lv95RingToLatLngs(parcelData.geometryLV95[0]);
      const leafletLayer = L.polygon(latlngs, styleFor(parcelData.egrid)).addTo(layerGroup);
      if (onHover) {
        leafletLayer.on('mouseover', () => onHover(parcelData.parcelNumber, true));
        leafletLayer.on('mouseout', () => onHover(null, false));
      }
      const point = representativePoint(parcelData, clickPoint);
      selection.set(parcelData.egrid, { ...parcelData, ...point, leafletLayer });
      onSelectionChange(Array.from(selection.values()));
    }

    function removeFromSelection(egrid) {
      const entry = selection.get(egrid);
      if (!entry) return;
      layerGroup.removeLayer(entry.leafletLayer);
      selection.delete(egrid);
      // Dropping the anchor promotes the next parcel still selected (Map
      // keeps insertion order), so a multi-parcel selection doesn't lose its
      // rules basis; with nothing left, the anchor is simply vacant until
      // the next click.
      if (egrid === anchorEgrid) {
        const next = selection.keys().next();
        anchorEgrid = next.done ? null : next.value;
        if (anchorEgrid !== null) selection.get(anchorEgrid).leafletLayer.setStyle(ANCHOR_STYLE);
      }
      onSelectionChange(Array.from(selection.values()));
    }

    addToSelection(firstParcel);

    map.on('click', async (e) => {
      const { easting, northing } = T.wgs84ToLv95(e.latlng.lng, e.latlng.lat);
      let identified;
      try {
        identified = await T.identifyParcel(easting, northing);
      } catch (err) {
        return; // clicked outside any parcel (e.g. a street) -- ignore, not an error
      }
      if (selection.has(identified.egrid)) {
        removeFromSelection(identified.egrid);
        return;
      }
      try {
        // Zone from the parcel's REPRESENTATIVE point (centroid where it lies
        // inside), not the raw click: on a parcel straddling a zone boundary
        // the click position silently decided the zone — two people clicking
        // different corners got different reports. The centroid is
        // deterministic; the boundary-uncertainty flag (edgeUncertain) still
        // reports proximity to a zone border.
        const rep = representativePoint(identified, { easting, northing });
        const zone = await T.lookupZone(rep.easting, rep.northing);
        const rules = await T.getZoneRules(zone, gemeindeOverride);
        addToSelection(
          { ...identified, zone: zone.zone, zoneLabel: zone.zoneLabel,
            zoneDescription: zone.zoneDescription, zoneSource: zone.zoneSource, rules },
          { easting, northing }
        );
      } catch (err) {
        // Unsupported commune, outside the Bauzone, zone not on file … —
        // silently ignoring left the user with a dead click and no feedback.
        L.popup()
          .setLatLng(e.latlng)
          .setContent(`<div style="max-width:280px">${String(err.message || err)
            .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`)
          .openOn(map);
      }
    });

    const controller = {
      map,
      getSelection: () => Array.from(selection.values()),
      // Programmatic equivalent of a map click, by LV95 coordinate. Exists
      // so the selection flow can be exercised without synthesising pixel
      // events (Leaflet swallows synthetic DOM clicks, which makes
      // automated end-to-end testing of this page impossible otherwise).
      selectAtLV95: (easting, northing) => {
        const { lat, lon } = T.lv95ToWgs84(easting, northing);
        map.fire('click', { latlng: L.latLng(lat, lon) });
      },
    };
    return controller;
  }

  T.initParcelMap = initParcelMap;
})();

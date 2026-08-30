// geocode.js — address -> LV95 coordinates + EGRID + parcel geometry
// No build step: attaches to a global namespace instead of using ES modules.
window.MachbarkeitTool = window.MachbarkeitTool || {};

(function () {
  // Netzabrufe laufen ueber T.fetchQuelle (js/core/netz.js): faellt eine
  // Quelle aus, nennt der Fehler sie beim Namen statt «Load failed».
  const T = window.MachbarkeitTool;
  const SEARCH_URL = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
  const IDENTIFY_URL = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify';
  const PARCEL_LAYER = 'ch.swisstopo-vd.amtliche-vermessung';

  async function geocodeAddress(address) {
    const url = `${SEARCH_URL}?searchText=${encodeURIComponent(address)}&type=locations&origins=address&limit=1&sr=2056`;
    const res = await T.fetchQuelle('Adresssuche', url);
    if (!res.ok) throw new Error(`SearchServer HTTP ${res.status}`);
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      throw new Error(`No geocoding result for "${address}"`);
    }
    const attrs = data.results[0].attrs;
    // IMPORTANT: with sr=2056, geo.admin.ch's "x" field is the LV95 NORTHING
    // and "y" is the LV95 EASTING — the opposite of the usual x=easting
    // convention. Confirmed empirically 2026-08-21 (plan section 7 already
    // warned the API has changed coordinate shape before without notice —
    // re-verify this mapping if results ever look wrong by ~1,000,000).
    return {
      address,
      label: attrs.label,
      easting: attrs.y,
      northing: attrs.x,
      lat: attrs.lat,
      lon: attrs.lon,
    };
  }

  async function identifyParcel(easting, northing) {
    const params = new URLSearchParams({
      geometryType: 'esriGeometryPoint',
      geometry: `${easting},${northing}`,
      layers: `all:${PARCEL_LAYER}`,
      mapExtent: `${easting},${northing},${easting},${northing}`,
      imageDisplay: '100,100,96',
      tolerance: '5',
      sr: '2056',
    });
    const res = await T.fetchQuelle('Amtliche Vermessung (Parzelle)', `${IDENTIFY_URL}?${params}`);
    if (!res.ok) throw new Error(`MapServer identify HTTP ${res.status}`);
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      throw new Error(`No parcel found at ${easting}, ${northing}`);
    }
    const result = data.results[0];
    return {
      egrid: result.attributes.egris_egrid,
      parcelNumber: result.attributes.number,
      bfsNr: result.attributes.bfsnr,
      geoportalUrl: result.attributes.geoportal_url,
      // LV95 polygon ring(s), same [easting, northing] order as turf.js expects for [x, y].
      geometryLV95: result.geometry.rings,
    };
  }

  async function geocodeAndIdentify(address) {
    const geocoded = await geocodeAddress(address);
    const parcel = await identifyParcel(geocoded.easting, geocoded.northing);
    return { ...geocoded, ...parcel };
  }

  // ---- combined address / parcel-number search ------------------------
  // SearchServer marks up the matched part of every label with <b>. That
  // split is useful rather than noise: for an address the bold half is the
  // postcode+commune ("Haldenstrasse 5" + "<b>8126 Zumikon</b>"), for a
  // parcel it is the commune ("<b>Zumikon</b> 1207 (CH 9677 ...)"). Parsed
  // here rather than injected as HTML anywhere -- the suggestion list is
  // built from text nodes only.
  function splitLabel(html) {
    const bold = ((html || '').match(/<b>(.*?)<\/b>/) || [, ''])[1].replace(/<[^>]*>/g, '').trim();
    const rest = (html || '').replace(/<b>.*?<\/b>/g, ' ').replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return { bold, rest };
  }

  async function searchOrigin(text, origin, limit) {
    const url = `${SEARCH_URL}?searchText=${encodeURIComponent(text)}&type=locations`
      + `&origins=${origin}&limit=${limit}&sr=2056`;
    const res = await T.fetchQuelle('Adresssuche (Vorschläge)', url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  }

  // Suggestions for the search box: addresses and parcel numbers in one
  // list. They have to be two requests -- asking SearchServer for
  // `origins=address,parcel` in one call lets the address matches crowd the
  // parcels out entirely (verified 2026-08-24: "Zumikon 1207" returns five
  // addresses and no parcel).
  //
  // A parcel number on its own is ambiguous across communes, so a bare
  // number is looked up as "<Gemeinde> <number>" when a commune is selected;
  // otherwise the user types the commune themselves ("Zumikon 1207"), which
  // is the order geo.admin.ch's parcel index expects.
  async function searchLocations(text, { gemeinde = null, limit = 6 } = {}) {
    const q = (text || '').trim();
    if (q.length < 2) return [];
    const bareNumber = /^\d+$/.test(q);
    const parcelQuery = bareNumber && gemeinde ? `${gemeinde} ${q}` : q;
    const [addressRaw, parcelRaw] = await Promise.all([
      bareNumber ? Promise.resolve([]) : searchOrigin(q, 'address', limit),
      searchOrigin(parcelQuery, 'parcel', limit),
    ]);

    const addresses = addressRaw.map((r) => {
      const { bold, rest } = splitLabel(r.attrs.label);
      return {
        kind: 'address',
        primary: rest || bold,
        secondary: rest ? bold : '',
        // What lands in the input when this row is picked -- kept in a form
        // that would find the same place again if the user edits and
        // resubmits it without touching the list.
        value: rest && bold ? `${rest}, ${bold}` : (rest || bold),
        easting: r.attrs.y,
        northing: r.attrs.x,
        lat: r.attrs.lat,
        lon: r.attrs.lon,
      };
    });

    const parcels = parcelRaw.map((r) => {
      const { bold, rest } = splitLabel(r.attrs.label);
      const number = (rest.split(' ')[0] || '').trim();
      const egrid = (rest.match(/\(([^)]*)\)/) || [, ''])[1].trim();
      return {
        kind: 'parcel',
        primary: `Parzelle ${number}`,
        secondary: [bold, egrid].filter(Boolean).join(' · '),
        value: `${bold} ${number}`.trim(),
        easting: r.attrs.y,
        northing: r.attrs.x,
        lat: r.attrs.lat,
        lon: r.attrs.lon,
      };
    });

    // Whatever the query looks like goes first: a leading digit reads as a
    // parcel number, anything else as an address.
    const parcelFirst = /^\d/.test(q);
    const [a, b] = parcelFirst ? [parcels, addresses] : [addresses, parcels];
    return [...a.slice(0, limit), ...b.slice(0, limit)];
  }

  // Resolve one suggestion (or, failing that, whatever the user typed) to a
  // parcel. Same shape as geocodeAndIdentify() so the caller doesn't care
  // which of the two search origins the location came from.
  async function resolveAndIdentify(pick) {
    const parcel = await identifyParcel(pick.easting, pick.northing);
    return {
      address: pick.value || pick.label || null,
      label: pick.value || pick.label || null,
      easting: pick.easting,
      northing: pick.northing,
      lat: pick.lat,
      lon: pick.lon,
      ...parcel,
    };
  }

  window.MachbarkeitTool.geocodeAddress = geocodeAddress;
  window.MachbarkeitTool.identifyParcel = identifyParcel;
  window.MachbarkeitTool.geocodeAndIdentify = geocodeAndIdentify;
  window.MachbarkeitTool.searchLocations = searchLocations;
  window.MachbarkeitTool.resolveAndIdentify = resolveAndIdentify;
})();

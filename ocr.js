'use strict';
/* =====================================================================
   Belegerkennung (B-12) – läuft vollständig im Browser, ohne Lizenz:
   - PDF mit Textebene: Text direkt aus der Datei (pdf.js)
   - Fotos und gescannte PDFs: Texterkennung (Tesseract, deutsch)
   Die Belege verlassen dabei das Gerät nicht; aus dem Netz geladen werden
   nur Programmcode und Sprachdaten (einmalig, danach im Browser-Cache).
   Erkannte Werte werden nur vorgeschlagen; der Mitarbeiter bestätigt.
   ===================================================================== */
const Ocr = (() => {
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFW = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const KEY = 'reisekosten.ocr';
  let worker = null, loading = null;
  const enabled = () => { try { return localStorage.getItem(KEY) !== 'aus'; } catch { return true; } };
  const setEnabled = on => { try { localStorage.setItem(KEY, on ? 'an' : 'aus'); } catch { /* egal */ } };

  const load = src => new Promise((ok, fail) => {
    if ([...document.scripts].some(s => s.src === src && s.dataset.ok)) return ok();
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous';
    s.onload = () => { s.dataset.ok = '1'; ok(); };
    s.onerror = () => fail(new Error('Die Belegerkennung konnte nicht geladen werden (Internetverbindung?).'));
    document.head.appendChild(s);
  });
  async function tesseract() {
    if (worker) return worker;
    if (!loading) loading = (async () => { await load(TESS); worker = await Tesseract.createWorker('deu'); return worker; })().catch(e => { loading = null; throw e; });
    return loading;
  }
  async function canvasOf(blob, maxEdge = 2000) {
    const src = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const k = Math.min(1, maxEdge / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const g = c.getContext('2d');
    g.filter = 'grayscale(1) contrast(1.4)'; // Kassenbons: Kontrast anheben
    g.drawImage(src, 0, 0, c.width, c.height);
    src.close?.();
    return c;
  }
  async function pdfText(blob) {
    await load(PDFJS);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFW;
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    let text = '';
    for (let n = 1; n <= Math.min(doc.numPages, 3); n++) {
      const page = await doc.getPage(n), tc = await page.getTextContent();
      // Textstücke nach Zeilen (y-Position) ordnen
      const lines = new Map();
      for (const it of tc.items) { const y = Math.round(it.transform[5]); lines.set(y, (lines.get(y) || '') + ' ' + it.str); }
      text += [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, s]) => s.trim()).join('\n') + '\n';
    }
    if (text.replace(/\s/g, '').length >= 30) return text;
    // gescanntes PDF ohne Textebene: erste Seite als Bild erkennen
    const page = await doc.getPage(1), vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return (await (await tesseract()).recognize(c)).data.text;
  }
  async function read(blob) {
    if (blob.type === 'application/pdf') return pdfText(blob);
    return (await (await tesseract()).recognize(await canvasOf(blob))).data.text;
  }

  /* ---------- Auswertung deutscher Belege ---------- */
  const KAT = [
    ['bahn', /deutsche bahn|db fernverkehr|db regio|bahn\.de|fahrkarte|ice\s|ic\/ec|bahncard|flexpreis|sparpreis/],
    ['flug', /lufthansa|eurowings|condor|ryanair|easyjet|boarding|flugschein|airline|flug\s?nr|ticketnummer.*flug/],
    ['taxi', /taxi|ö?pnv|rheinbahn|vrr|bvg|mvv|hvv|kvb|uber|free\s?now|einzelfahrschein|tageskarte|deutschlandticket/],
    ['mietwagen', /sixt|europcar|avis|hertz|enterprise|autovermietung|mietwagen|rent a car/],
    ['kraftstoff', /aral|shell|esso|\bjet\b|totalenergies|total tankstelle|agip|avia|tankstelle|diesel|super e10|super e5|kraftstoff|liter|zapfs/],
    ['parken', /parkhaus|parken|parkschein|parkgeb|contipark|apcoa|q-park|ein-?\s?ausfahrt|maut|toll/],
    ['hotel', /hotel|übernachtung|logis|motel one|ibis|b&b|booking\.com|zimmer|check-?in|frühstück.*inkl|city tax|beherbergung/],
    ['bewirtung', /restaurant|gaststätte|gaststatte|gastst|gasthaus|bewirtung|ristorante|pizzeria|trattoria|bistro|brauhaus|café|cafe|speisen|getränke|getranke|tisch\s?-?\s?n?r?\.?:?\s?\d|bedienung|bedient|kellner|trinkgeld/]
  ];
  const GENERIC = /^(rechnung|quittung|beleg|kassenbon|bon|invoice|receipt|seite|page|kopie|original|duplikat|steuernummer|ust-?id|datum|tel|fax|www\.|http)/i;
  const toCent = s => Math.round(Number(s.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) * 100);
  function parse(text) {
    const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const low = text.toLowerCase();
    const out = {};
    // Datum: erstes plausibles Datum (nicht in der Zukunft, höchstens drei Jahre alt)
    const today = new Date(), min = new Date(today.getFullYear() - 3, 0, 1);
    const MON = { jan: 1, feb: 2, mär: 3, mar: 3, mrz: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
    const dates = [];
    for (const m of text.matchAll(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4}|\d{2})(?!\d)|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[.\- ]?([A-Za-zÄä]{3})[a-zä]*[.\- ]?(\d{4}|\d{2})(?!\d)/g)) {
      let y, mo, d;
      if (m[4]) [y, mo, d] = [Number(m[4]), Number(m[5]), Number(m[6])];
      else if (m[8]) { mo = MON[m[8].toLowerCase()]; if (!mo) continue; d = Number(m[7]); y = m[9].length === 2 ? 2000 + Number(m[9]) : Number(m[9]); }
      else [y, mo, d] = [m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1])];
      const dt = new Date(y, mo - 1, d);
      if (dt.getMonth() !== mo - 1 || dt > new Date(today.getTime() + 86400000) || dt < min) continue;
      dates.push(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    if (dates.length) out.datum = dates[0];

    // Beträge: „12,50“ und „12.50“; Tausenderpunkt erlaubt
    const AMT = /(?<![\d.,])(\d{1,3}(?:[.\s]\d{3})+|\d{1,5})[,.](\d{2})(?![\d%])/g;
    const amounts = l => [...l.matchAll(AMT)].map(m => toCent(m[1] + ',' + m[2])).filter(c => c > 0 && c < 1000000);
    // Endbetrag: Zeile mit „Total“, „Summe“ … – steht der Betrag in der Zeile darunter, auch diese
    const SKIP = /rückgeld|gegeben|netto|zwischensumme|mwst|ust\b|steuer|trinkgeld/i;
    const pick = re => lines.flatMap((l, i) => {
      if (!re.test(l.toLowerCase()) || SKIP.test(l)) return [];
      const a = amounts(l);
      return a.length ? a : (lines[i + 1] && !SKIP.test(lines[i + 1]) ? amounts(lines[i + 1]) : []);
    });
    const best = [/total|summe|gesamt|zu zahlen|zahlbetrag|endbetrag|rechnungsbetrag|gesamtbetrag/, /betrag|brutto|ec-?karte|kartenzahlung|girocard|visa|mastercard|unbar|eur\b|€/];
    for (const re of best) { const c = pick(re); if (c.length) { out.brutto = Math.max(...c); break; } }
    if (out.brutto == null) { const all = lines.filter(l => !/rückgeld|gegeben|tel|fax|iban|steuer-?nr/i.test(l)).flatMap(amounts); if (all.length) out.brutto = Math.max(...all); }

    // Trinkgeld (ohne Umsatzsteuer)
    const tipLine = lines.find(l => /trinkgeld|tip\b|service ?charge/i.test(l));
    const tip = tipLine ? Math.max(0, ...amounts(tipLine)) : 0;

    // Umsatzsteuer je Satz: aus Steuertabellen („A= 19.0  16,97  3,23  20,20“) und Zeilen mit „7 %“, „MwSt 19“
    const RATE = /(?:(?<![\d,.])(19|7)(?:[,.]0{1,2})?\s?(?:%|°\/o|0\/0)|(?:mwst|mw\.?-?st|ust|mehrwertsteuer|umsatzsteuer|steuersatz|vat)[^\d\n]{0,12}(19|7)(?![\d,.]\d)|^\s*[A-F]\s*[=:]\s*(19|7)(?:[,.]0{1,2})?(?!\d))/gi;
    const rates = new Set(), parts = { 7: new Set(), 19: new Set() };
    const near = (x, y) => Math.abs(x - y) <= 2; // Rundung auf Kassenbons
    for (const l of lines) {
      const hits = [...l.matchAll(RATE)];
      hits.forEach((h, k) => {
        const r = Number(h[1] || h[2] || h[3]);
        rates.add(r);
        // Beträge zwischen dieser und der nächsten Satzangabe gehören zu diesem Satz
        const seg = l.slice(h.index + h[0].length, k + 1 < hits.length ? hits[k + 1].index : undefined);
        const a = amounts(seg);
        let g = null;
        for (let i = 0; i < a.length && g == null; i++) for (let j = 0; j < a.length && g == null; j++) {
          if (i === j) continue;
          const x = a[i], t = a[j];
          if (near(t, Math.round(x * r / 100))) g = a.find(y => near(y, x + t)) ?? x + t;   // x ist netto: Brutto aus der Zeile oder berechnet
          else if (near(t, x - Math.round(x * 100 / (100 + r)))) g = x;                    // x ist brutto („7 % auf 109,00 = 7,13“)
        }
        if (g != null) parts[r].add(g);
        else if (a.length === 1) { parts[r].add(a[0]); parts[r].add(Math.round(a[0] * (100 + r) / 100)); parts[r].add(Math.round(a[0] * (100 + r) / r)); } // Brutto, Netto oder Steuer
      });
    }
    // ohne Satzangabe: aus dem Steuerbetrag zurückrechnen (Steuer / (Brutto − Steuer) ≈ 0,19 bzw. 0,07)
    if (!rates.size && out.brutto) {
      const base = out.brutto - tip;
      for (const l of lines.filter(l => /mwst|ust\b|steuer|tax|vat/i.test(l))) {
        for (const t of amounts(l)) {
          if (t >= base) continue;
          const r = t / (base - t);
          if (Math.abs(r - 0.19) < 0.006) rates.add(19);
          else if (Math.abs(r - 0.07) < 0.004) rates.add(7);
        }
      }
    }
    // Aufteilung suchen, deren Summe (mit Trinkgeld) den Endbetrag ergibt
    if (out.brutto) {
      const rest = out.brutto - tip, split = [];
      if (rates.has(7) && rates.has(19)) {
        outer: for (const a of parts[7]) for (const b of parts[19]) if (near(a + b, rest)) { split.push({ satz: 7, brutto: a }, { satz: 19, brutto: rest - a }); break outer; }
      } else if (rates.size === 1 && tip) split.push({ satz: [...rates][0], brutto: rest });
      if (split.length && tip) split.push({ satz: 0, brutto: tip });
      if (split.length > 1) out.split = split;
    }
    if (rates.has(7) && rates.has(19)) out.mixed = true;
    else if (rates.size) out.ust = [...rates][0];
    if (tip) out.trinkgeld = tip;

    // Aussteller: bevorzugt die Zeile mit Rechtsform, sonst erste aussagekräftige Zeile oben
    const AMT1 = new RegExp(AMT.source); // ohne „g“, sonst merkt sich test() die Position
    const top = lines.slice(0, 10).filter(l => /[a-zäöüß]{3,}/i.test(l) && !GENERIC.test(l) && !/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/.test(l) && !AMT1.test(l) && !/www\.|\.de\b|\.com\b|@/i.test(l));
    out.aussteller = (top.find(l => /\b(gmbh|ag|kg|ohg|gbr|ug|e\.\s?k\.?|e\.v\.)\b/i.test(l)) || top[0])?.slice(0, 60);
    // Ort: Postleitzahl und Ort aus der Anschrift des Ausstellers (oben auf dem Beleg, nicht die Rechnungsanschrift)
    const PLZ = /(?<!\d)(?:D-?\s?)?(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\- ]{1,40}?)(?=\s{2,}|,|\s+(?:tel|fon|telefon|fax|www|e-?mail|ust|steuer)\b|\s*$)/i;
    for (const l of lines.slice(0, 10)) {
      const m = l.match(PLZ);
      if (m) { out.ort = m[2].replace(/\s+(gmbh|ag|kg|e\.?k\.?)$/i, '').trim(); break; }
    }
    // Kostenart nach Stichwörtern
    let bestKat = null, bestN = 0;
    for (const [k, re] of KAT) { const n = (low.match(new RegExp(re.source, 'g')) || []).length; if (n > bestN) { bestN = n; bestKat = k; } }
    if (bestKat) out.kostenart = bestKat;
    out.text = text;
    return out;
  }
  async function recognize(blob) { return parse(await read(blob)); }

  return { recognize, parse, enabled, setEnabled, ready: () => !!worker };
})();

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
    ['kraftstoff', /aral|shell|esso|jet\b|totalenergies|\btotal\b|agip|avia|tankstelle|diesel|super e10|super e5|kraftstoff|liter|zapfs/],
    ['parken', /parkhaus|parken|parkschein|parkgeb|contipark|apcoa|q-park|ein-?\s?ausfahrt|maut|toll/],
    ['hotel', /hotel|übernachtung|logis|motel one|ibis|b&b|booking\.com|zimmer|check-?in|frühstück.*inkl|city tax|beherbergung/],
    ['bewirtung', /restaurant|gaststätte|gasthaus|bewirtung|ristorante|pizzeria|trattoria|bistro|brauhaus|café|cafe|speisen|getränke|tisch\s?\d|bedienung|kellner/]
  ];
  const GENERIC = /^(rechnung|quittung|beleg|kassenbon|bon|invoice|receipt|seite|page|kopie|original|duplikat|steuernummer|ust-?id|datum|tel|fax|www\.|http)/i;
  const toCent = s => Math.round(Number(s.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) * 100);
  function parse(text) {
    const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const low = text.toLowerCase();
    const out = {};
    // Datum: erstes plausibles Datum (nicht in der Zukunft, höchstens drei Jahre alt)
    const today = new Date(), min = new Date(today.getFullYear() - 3, 0, 1);
    for (const m of text.matchAll(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4}|\d{2})(?!\d)|(\d{4})-(\d{2})-(\d{2})/g)) {
      const [y, mo, d] = m[4] ? [Number(m[4]), Number(m[5]), Number(m[6])] : [m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1])];
      const dt = new Date(y, mo - 1, d);
      if (dt.getMonth() !== mo - 1 || dt > new Date(today.getTime() + 86400000) || dt < min) continue;
      out.datum = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      break;
    }
    // Betrag: bevorzugt Zeilen mit „Summe“, „Gesamt“, „zu zahlen“ …
    const AMT = /(?<![\d.,])(\d{1,3}(?:[.\s]\d{3})+|\d{1,5})[,.](\d{2})(?![\d%])/g;
    const amounts = l => [...l.matchAll(AMT)].map(m => toCent(m[1] + ',' + m[2])).filter(c => c > 0 && c < 1000000);
    const pick = re => lines.filter(l => re.test(l.toLowerCase()) && !/rückgeld|gegeben|netto|zwischensumme|mwst|ust\b|steuer/i.test(l)).flatMap(amounts);
    const best = [/summe|gesamt|total|zu zahlen|zahlbetrag|endbetrag|rechnungsbetrag|gesamtbetrag/, /betrag|brutto|ec-?karte|kartenzahlung|girocard|visa|mastercard|eur\b|€/];
    for (const re of best) { const c = pick(re); if (c.length) { out.brutto = Math.max(...c); break; } }
    if (out.brutto == null) { const all = lines.filter(l => !/rückgeld|gegeben|tel|fax|iban|steuer-?nr/i.test(l)).flatMap(amounts); if (all.length) out.brutto = Math.max(...all); }
    // Umsatzsteuersatz
    const rates = [...text.matchAll(/(\d{1,2})(?:[,.]0{1,2})?\s?%/g)].map(m => Number(m[1])).filter(r => r === 19 || r === 7);
    // beide Sätze (z. B. Hotel mit Frühstück): nicht raten, sondern Hinweis geben
    if (rates.includes(7) && rates.includes(19)) out.mixed = true;
    else if (rates.length) out.ust = rates[0];
    // Aussteller: erste aussagekräftige Zeile oben
    const AMT1 = new RegExp(AMT.source); // ohne „g“, sonst merkt sich test() die Position
    out.aussteller = lines.slice(0, 8).find(l => /[a-zäöüß]{3,}/i.test(l) && !GENERIC.test(l) && !/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/.test(l) && !AMT1.test(l))?.slice(0, 60);
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

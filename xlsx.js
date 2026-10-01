'use strict';
/* =====================================================================
   Excel-Dateien ohne fremde Bibliothek
   - lesen: XLSX (ZIP mit XML) und CSV
   - schreiben: einfache XLSX-Dateien (Vorlage Fahrtenliste, später Exporte)
   ===================================================================== */
const Xlsx = (() => {
  /* ---------- ZIP lesen ---------- */
  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Dieser Browser kann Excel-Dateien nicht entpacken. Bitte als CSV speichern und erneut versuchen.');
    const ds = new DecompressionStream('deflate-raw');
    const out = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function unzip(buf) {
    const b = new Uint8Array(buf), v = new DataView(buf);
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Die Datei ist keine gültige Excel-Datei.');
    const count = v.getUint16(e + 10, true);
    let p = v.getUint32(e + 16, true);
    const files = new Map(), dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
      files.set(name, { method, size, off });
      p += 46 + nl + xl + cl;
    }
    return async name => {
      const f = files.get(name);
      if (!f) return null;
      const start = f.off + 30 + v.getUint16(f.off + 26, true) + v.getUint16(f.off + 28, true);
      const raw = b.subarray(start, start + f.size);
      const data = f.method === 0 ? raw : f.method === 8 ? await inflate(raw) : null;
      if (!data) throw new Error('Nicht unterstütztes Kompressionsverfahren in der Excel-Datei.');
      return new TextDecoder().decode(data);
    };
  }
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const col = ref => { let n = 0; for (const c of ref.replace(/\d+$/, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

  // Erstes Tabellenblatt als Zeilen (Zellen als Text oder Zahl)
  async function readXlsx(buf) {
    const get = await unzip(buf);
    const wb = xml(await get('xl/workbook.xml') || '');
    const first = wb.getElementsByTagName('sheet')[0];
    let path = 'xl/worksheets/sheet1.xml';
    if (first) {
      const rid = first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const rels = xml(await get('xl/_rels/workbook.xml.rels') || '<x/>');
      const rel = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid);
      if (rel) path = 'xl/' + rel.getAttribute('Target').replace(/^\/?xl\//, '');
    }
    const sst = await get('xl/sharedStrings.xml');
    const shared = sst ? [...xml(sst).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
    const sheet = await get(path);
    if (!sheet) throw new Error('Kein Tabellenblatt in der Excel-Datei gefunden.');
    const rows = [];
    let rn = 0;
    for (const r of xml(sheet).getElementsByTagName('row')) {
      const row = [];
      let cn = -1;
      rn = r.getAttribute('r') ? Number(r.getAttribute('r')) : rn + 1;
      for (const c of r.getElementsByTagName('c')) {
        cn = c.getAttribute('r') ? col(c.getAttribute('r')) : cn + 1;
        const t = c.getAttribute('t'), vEl = c.getElementsByTagName('v')[0], txt = vEl ? vEl.textContent : '';
        let val;
        if (t === 's') val = shared[Number(txt)] ?? '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (t === 'str' || t === 'b' || t === 'e') val = txt;
        else val = txt === '' ? '' : Number(txt);
        row[cn] = val;
      }
      rows[rn - 1] = Array.from(row, x => x ?? '');
    }
    return Array.from(rows, x => x || []);
  }
  function readCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '', sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt')) return readCsv(await file.text());
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(await file.arrayBuffer());
    if (name.endsWith('.xls')) throw new Error('Das alte Excel-Format .xls wird nicht unterstützt. Bitte in Excel als .xlsx speichern.');
    throw new Error('Bitte eine Excel-Datei (.xlsx) oder CSV-Datei wählen.');
  }

  /* ---------- ZIP und XLSX schreiben ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files, type = 'application/zip') { // unkomprimiert (Methode „stored“)
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((a, p) => a + p.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type });
  }
  const X = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ref = (r, c) => { let s = '', n = c + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s + (r + 1); };
  // Zellen: Text, Zahl oder { v, s } mit Stil 1 = fett, 2 = Datum, 3 = Betrag, 4 = Hinweis (kursiv)
  function sheetXml({ rows, widths = [], validations = [], colStyles = {}, freeze = false }) {
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${colStyles[i] ? ` style="${colStyles[i]}"` : ''}/>`).join('')}</cols>` : '';
    const data = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
      if (cell === '' || cell == null) return '';
      const o = typeof cell === 'object' ? cell : { v: cell }, s = o.s ? ` s="${o.s}"` : '';
      return typeof o.v === 'number' ? `<c r="${ref(r, c)}"${s}><v>${o.v}</v></c>` : `<c r="${ref(r, c)}" t="inlineStr"${s}><is><t xml:space="preserve">${X(o.v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const pane = freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
    const dv = validations.length ? `<dataValidations count="${validations.length}">${validations.map(v => `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${v.range}"><formula1>${X(v.formula)}</formula1></dataValidation>`).join('')}</dataValidations>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${data}</sheetData>${dv}</worksheet>`;
  }
  function build(sheets) {
    const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns}><sheets>${sheets.map((s, i) => `<sheet name="${X(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="DD.MM.YYYY"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0F2F1"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="4" applyNumberFormat="1"/><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>' },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }))
    ];
    return zip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- Datum aus Excel-Zelle ---------- */
  function toDate(v) {
    const pad = n => String(n).padStart(2, '0');
    if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel-Seriennummer
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    const s = String(v ?? '').trim();
    let m;
    if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/))) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return valid(y, m[2], m[1]); }
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return valid(m[1], m[2], m[3]);
    return null;
    function valid(y, mo, d) { const dt = new Date(Date.UTC(y, mo - 1, d)); return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === Number(d) ? `${y}-${pad(mo)}-${pad(d)}` : null; }
  }

  return { readFile, readXlsx, readCsv, build, zip, download, toDate };
})();

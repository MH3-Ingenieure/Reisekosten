'use strict';
/* =====================================================================
   Belege und Unterschriften
   - Prüfen der Dateitypen (B-01), Verkleinern von Fotos (B-03)
   - SHA-256-Prüfsummen (B-07, P-04)
   - Ablage der Dateien im Gerät (IndexedDB), bis sie in SharePoint liegen
   - Unterschriftsfeld für Finger, Stift und Maus (P-01)
   ===================================================================== */
const Media = (() => {
  const MAX_BYTES = 10 * 1024 * 1024;   // B-03: höchstens 10 MB je Datei
  const MAX_EDGE = 3000;                // längste Bildkante nach dem Verkleinern
  const QUALITY = 0.85;
  const SHRINK_FROM = 3 * 1024 * 1024;  // Fotos ab 3 MB werden neu gespeichert
  const TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif' };

  const ext = name => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  function typeOf(file) {
    const e = ext(file.name), t = (file.type || '').toLowerCase();
    if (e === 'pdf' || t === 'application/pdf') return 'pdf';
    if (['heic', 'heif'].includes(e) || /image\/hei[cf]/.test(t)) return 'heic';
    if (['jpg', 'jpeg'].includes(e) || t === 'image/jpeg') return 'jpg';
    if (e === 'png' || t === 'image/png') return 'png';
    return null;
  }

  async function decode(blob) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* Fallback */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const dims = src => [src.width || src.naturalWidth, src.height || src.naturalHeight];
  function draw(src, maxEdge, background) {
    const [w, h] = dims(src), k = Math.min(1, maxEdge / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  const toBlob = (canvas, type, q) => new Promise((ok, fail) => canvas.toBlob(b => (b ? ok(b) : fail(new Error('Bild konnte nicht gespeichert werden'))), type, q));
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  async function sha256(blob) { return hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())); }
  async function sha256Text(text) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }

  // Datei prüfen und für die Ablage vorbereiten → { blob, name, type, size, sha256, thumb, converted }
  async function prepare(file) {
    const kind = typeOf(file);
    if (!kind) throw new Error(`„${file.name}“: Dieser Dateityp ist nicht zulässig. Erlaubt sind PDF, JPG, PNG und HEIC.`);
    if (kind === 'pdf') {
      if (file.size > MAX_BYTES) throw new Error(`„${file.name}“ ist größer als 10 MB. PDF-Dateien lassen sich in der App nicht verkleinern – bitte kleiner speichern oder einscannen.`);
      return { blob: file, name: file.name, type: TYPES.pdf, size: file.size, sha256: await sha256(file), thumb: null, converted: false };
    }
    let src;
    try { src = await decode(file); }
    catch {
      throw new Error(kind === 'heic'
        ? `„${file.name}“: HEIC-Fotos kann dieses Gerät nicht lesen. Bitte den Beleg direkt mit „Foto aufnehmen“ fotografieren oder als JPEG speichern.`
        : `„${file.name}“ konnte nicht als Bild gelesen werden.`);
    }
    const [w, h] = dims(src);
    let blob = file, name = file.name, type = TYPES[kind], converted = false;
    if (kind === 'heic' || Math.max(w, h) > MAX_EDGE || file.size > SHRINK_FROM) {
      // weißer Hintergrund, damit transparente PNG-Flächen nicht schwarz werden
      blob = await toBlob(draw(src, MAX_EDGE, '#fff'), 'image/jpeg', QUALITY);
      if (blob.size > MAX_BYTES) blob = await toBlob(draw(src, 2400, '#fff'), 'image/jpeg', 0.7);
      name = name.replace(/\.[a-z0-9]+$/i, '') + '.jpg'; type = 'image/jpeg'; converted = true;
    }
    if (blob.size > MAX_BYTES) throw new Error(`„${file.name}“ ist auch verkleinert noch größer als 10 MB.`);
    const thumb = draw(src, 240, '#fff').toDataURL('image/jpeg', 0.7);
    src.close?.();
    return { blob, name, type, size: blob.size, sha256: await sha256(blob), thumb, converted };
  }

  async function thumbOf(blob) {
    try { const src = await decode(blob); const t = draw(src, 240, '#fff').toDataURL('image/jpeg', 0.7); src.close?.(); return t; }
    catch { return null; }
  }

  /* ---------- Unterschrift als Bild aufbereiten (weißer Grund, höchstens 600 × 200) ---------- */
  async function signatureFromFile(file) {
    const kind = typeOf(file);
    if (kind !== 'jpg' && kind !== 'png') throw new Error('Bitte eine Bilddatei im Format JPEG oder PNG wählen.');
    const src = await decode(file);
    return fitSignature(src);
  }
  function fitSignature(src) {
    const [w, h] = dims(src), k = Math.min(1, 600 / w, 200 / h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    let q = 0.85, url = c.toDataURL('image/jpeg', q);
    while (url.length > 40000 && q > 0.4) { q -= 0.15; url = c.toDataURL('image/jpeg', q); } // passt sicher in ein Listenfeld
    return url;
  }

  /* ---------- Unterschriftsfeld ---------- */
  function signaturePad(canvas, onChange) {
    const ctx = canvas.getContext('2d');
    let drawing = false, last = null, ink = false, box = null;
    function size() {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
      ink = false; box = null; onChange?.(false);
    }
    const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const grow = p => { box = box ? { x0: Math.min(box.x0, p.x), y0: Math.min(box.y0, p.y), x1: Math.max(box.x1, p.x), y1: Math.max(box.y1, p.y) } : { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; };
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      drawing = true; last = pos(e); grow(last);
      ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; grow(p);
      if (!ink) { ink = true; onChange?.(true); }
    });
    const end = () => { drawing = false; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    size();
    return {
      clear: size,
      hasInk: () => ink,
      // zugeschnittene Unterschrift als JPEG-Daten-URL
      image() {
        if (!ink || !box) return null;
        const dpr = window.devicePixelRatio || 1, m = 8;
        const x = Math.max(0, (box.x0 - m) * dpr), y = Math.max(0, (box.y0 - m) * dpr);
        const w = Math.min(canvas.width - x, (box.x1 - box.x0 + 2 * m) * dpr), h = Math.min(canvas.height - y, (box.y1 - box.y0 + 2 * m) * dpr);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
        return fitSignature(c);
      }
    };
  }

  /* ---------- Dateiablage im Gerät (IndexedDB) ---------- */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((ok, fail) => {
      const r = indexedDB.open('reisekosten', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((ok, fail) => {
      const t = d.transaction('files', mode), req = fn(t.objectStore('files'));
      t.oncomplete = () => ok(req?.result); t.onerror = () => fail(t.error);
    });
  }
  const put = (id, blob) => tx('readwrite', s => s.put(blob, id));
  const get = id => tx('readonly', s => s.get(id));
  const del = id => tx('readwrite', s => s.delete(id));

  return { prepare, thumbOf, sha256, sha256Text, signatureFromFile, signaturePad, put, get, del, typeOf, ext, MAX_BYTES };
})();

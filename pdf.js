'use strict';
/* =====================================================================
   PDF einer Abrechnung (E-01, E-02) – in jedem Status, im Browser erzeugt:
   Kopf, Positionen, Bewirtungsangaben, Summen, Status mit Signaturen und
   Prüfsumme; danach die Belegfotos (PDF-Belege werden aufgeführt).
   Programmcode (jsPDF) wird beim ersten Mal vom CDN geladen.
   ===================================================================== */
const Pdf = (() => {
  const JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
  const AUTOTABLE = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';
  const ACCENT = [0, 137, 123];
  const load = src => new Promise((ok, fail) => {
    if ([...document.scripts].some(s => s.src === src && s.dataset.ok)) return ok();
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous';
    s.onload = () => { s.dataset.ok = '1'; ok(); };
    s.onerror = () => fail(new Error('Der PDF-Baustein konnte nicht geladen werden (Internetverbindung?).'));
    document.head.appendChild(s);
  });
  const eur = c => ((c || 0) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const safe = s => String(s ?? '').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€„“”‚‘’–—…•]/g, '?'); // Standardschrift kennt nur Windows-1252

  function ustInfo(p) {
    if (isKm(p)) return { satz: '–', betrag: 0 };
    const t = Calc.teile(p);
    return { satz: t.length > 1 ? t.map(x => (x.satz ? x.satz + ' %' : 'TG')).join(' / ') : (Number(p.ust) || 0) + ' %', betrag: Calc.ust(p) };
  }
  function beschreibung(p) {
    if (isKm(p)) return `${p.strecke || ''}\n${String(p.km).replace('.', ',')} km × ${eur(p.kmSatz)}`;
    const parts = [p.bemerkung];
    if (p.ustSplit?.length > 1) parts.push(p.ustSplit.map(t => `${eur(t.brutto)} ${t.satz ? 'zu ' + t.satz + ' %' : 'Trinkgeld'}`).join(' + '));
    return parts.filter(Boolean).join('\n');
  }
  function belegText(p) {
    if (isKm(p)) return '–';
    if (!p.belege.length) return p.eigenbeleg ? 'Eigenbeleg' : 'fehlt';
    const dig = p.belege.filter(b => b.digital).length;
    return `${p.belege.length}${dig ? (dig === p.belege.length ? ' digital' : ` (${dig} digital)`) : ' Papier'}`;
  }
  async function imageData(blob) { // Belegfoto als JPEG (verkleinert), mit Seitenverhältnis
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return { url: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
  }

  async function make(d, { belege = true } = {}) {
    await load(JSPDF); await load(AUTOTABLE);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 15, k = d.kopf, s = sums(d), aus = isAuslage(d);
    const entwurf = editable(d) || d.status === 'Entwurf';
    const T = (txt, x, y, o) => doc.text(safe(txt), x, y, o);

    // Kopfzeile
    doc.setFillColor(...ACCENT); doc.rect(0, 0, W, 4, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(30);
    T(aus ? 'Auslagenabrechnung' : 'Reisekostenabrechnung', M, 16);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    T('MH3 Ingenieure GmbH & Co. KG', M, 22);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(30); doc.setFontSize(11);
    T([d.nr || 'ohne Nummer', 'Status: ' + (d.status || 'Entwurf')].join('   ·   '), W - M, 16, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
    T('erstellt am ' + new Date().toLocaleString('de-DE'), W - M, 22, { align: 'right' });
    if (entwurf) { doc.setTextColor(200, 40, 40); doc.setFontSize(9); T('ENTWURF – nicht eingereicht, ohne Prüfung und Freigabe', W - M, 27, { align: 'right' }); }

    // Angaben zur Abrechnung
    const wer = d.erstellerName || Data.user()?.name || '';
    const rows = aus
      ? [['Art', artName(d)], ['Mitarbeiter', wer], ['Wofür', k.zweck], ['Projekt / Kostenstelle', k.kostenstelle], ['Belegdatum', whenText(d)]]
      : [['Art', artName(d)], ['Mitarbeiter', wer], ['Reisezweck', k.zweck], ['Projekt / Kostenstelle', k.kostenstelle],
        ['Reiseziel', [k.ort, k.land].filter(Boolean).join(', ')], ['Beginn', fmtDT(k.beginn)], ['Ende', fmtDT(k.ende)]];
    if (k.vorschuss) rows.push(['Vorschuss', eur(k.vorschuss)]);
    doc.autoTable({
      startY: 31, body: rows.map(r => r.map(safe)), theme: 'plain', margin: { left: M, right: M },
      styles: { fontSize: 9.5, cellPadding: { top: 0.8, bottom: 0.8, left: 0, right: 2 } },
      columnStyles: { 0: { cellWidth: 45, textColor: 110 }, 1: { fontStyle: 'bold' } }
    });

    // Positionen
    const body = d.positionen.map((p, i) => {
      const u = ustInfo(p);
      return [i + 1, fmtDate(p.datum), KA(p.kostenart).name, beschreibung(p), projektOf(d, p), isKm(p) ? 'privat' : (ZAHLUNG[p.zahlungsart] || ''), u.satz, u.betrag ? eur(u.betrag) : '–', eur(betrag(p)), belegText(p)].map(safe);
    });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 5, margin: { left: M, right: M },
      head: [['Nr', 'Datum', 'Kostenart', 'Beschreibung', 'Projekt', 'Zahlung', 'USt', 'darin USt', 'Brutto', 'Beleg']],
      body: body.length ? body : [['', '', 'keine Positionen', '', '', '', '', '', '', '']],
      styles: { fontSize: 8, cellPadding: 1.4, valign: 'top' }, headStyles: { fillColor: ACCENT, textColor: 255 },
      columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 17 }, 2: { cellWidth: 22 }, 3: { cellWidth: 'auto' }, 4: { cellWidth: 18 }, 5: { cellWidth: 14 },
        6: { cellWidth: 19 }, 7: { cellWidth: 17, halign: 'right' }, 8: { cellWidth: 18, halign: 'right' }, 9: { cellWidth: 14 } }
    });

    // Bewirtungen (Pflichtangaben)
    const bew = d.positionen.map((p, i) => [p, i]).filter(([p]) => isBew(p));
    if (bew.length) {
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 4, margin: { left: M, right: M },
        head: [['Nr', 'Bewirtung: Anlass', 'Teilnehmer', 'Ort']],
        body: bew.map(([p, i]) => [i + 1, p.bewirtung?.anlass, p.bewirtung?.teilnehmer, p.bewirtung?.ort].map(safe)),
        styles: { fontSize: 8, cellPadding: 1.4 }, headStyles: { fillColor: [120, 144, 156], textColor: 255 }, columnStyles: { 0: { cellWidth: 7 } }
      });
    }
    const eigen = d.positionen.map((p, i) => [p, i]).filter(([p]) => p.eigenbeleg);
    if (eigen.length) {
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 4, margin: { left: M, right: M }, head: [['Nr', 'Eigenbeleg: Begründung']],
        body: eigen.map(([p, i]) => [i + 1, p.eigenbelegGrund].map(safe)),
        styles: { fontSize: 8, cellPadding: 1.4 }, headStyles: { fillColor: [239, 108, 0], textColor: 255 }, columnStyles: { 0: { cellWidth: 7 } }
      });
    }

    // Summen
    const sumRows = [['Auslagen gesamt', eur(s.auslagen)]];
    if (s.firmenkarte) sumRows.push(['davon mit Firmenkarte bezahlt (wird nicht erstattet)', '- ' + eur(s.firmenkarte)]);
    if (s.steuer) sumRows.push(['darin enthaltene Umsatzsteuer', eur(s.steuer)]);
    sumRows.push(['Kilometergeld', eur(s.km)]);
    if (s.vorschuss) sumRows.push(['Erhaltener Vorschuss', '- ' + eur(s.vorschuss)]);
    sumRows.push([s.auszahlung < 0 ? 'Rückzahlung an die Firma' : 'Auszahlungsbetrag', eur(Math.abs(s.auszahlung))]);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 5, margin: { left: W - M - 100, right: M }, body: sumRows.map(r => r.map(safe)), theme: 'plain',
      styles: { fontSize: 9.5, cellPadding: 0.9 }, columnStyles: { 1: { halign: 'right', cellWidth: 30 } },
      didParseCell: c => { if (c.row.index === sumRows.length - 1) { c.cell.styles.fontStyle = 'bold'; c.cell.styles.fontSize = 11; } }
    });

    // Status, Prüfung, Signaturen
    let y = doc.lastAutoTable.finalY + 8;
    const need = h => { if (y + h > 285) { doc.addPage(); y = 18; } };
    const info = [];
    if (d.eingereicht) info.push(['Eingereicht', fmtTs(d.eingereicht)]);
    if (d.originale) info.push(['Originalbelege', 'liegen vor' + (d.ablageort ? ' – Ablage: ' + d.ablageort : '')]);
    if (d.freigabedatum) info.push(['Freigegeben', fmtTs(d.freigabedatum)]);
    if (d.auszahlungsdatum) info.push(['Ausgezahlt', fmtDate(d.auszahlungsdatum)]);
    if (d.rueckweisung && d.status === 'Zurückgewiesen') info.push(['Zurückgewiesen', d.rueckweisung]);
    if (d.storno) info.push(['Storno', d.storno]);
    if (d.pruefsumme) info.push(['Prüfsumme (SHA-256)', d.pruefsumme]);
    if (info.length) {
      need(20);
      doc.autoTable({ startY: y, body: info.map(r => r.map(safe)), theme: 'plain', margin: { left: M, right: M },
        styles: { fontSize: 8.5, cellPadding: 0.8 }, columnStyles: { 0: { cellWidth: 45, textColor: 110 } } });
      y = doc.lastAutoTable.finalY + 6;
    }
    const sigs = d.signaturen || [];
    if (sigs.length) {
      need(40);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30); T('Unterschriften', M, y); y += 3;
      const bw = (W - 2 * M - 10) / 3;
      sigs.slice(0, 3).forEach((g, i) => {
        const x = M + i * (bw + 5);
        doc.setDrawColor(200); doc.rect(x, y, bw, 30);
        if (g.bild && /^data:image\/(png|jpe?g)/.test(g.bild)) { try { doc.addImage(g.bild, x + 2, y + 2, bw - 4, 16, undefined, 'FAST'); } catch { /* Bild nicht lesbar */ } }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); T(g.rolle, x + 2, y + 22);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); T(`${g.name || ''}, ${g.zeit ? fmtTs(g.zeit) : ''}`, x + 2, y + 26);
      });
      y += 34;
    }

    // Belege anhängen (Fotos als Bild, PDF-Belege nur aufgeführt)
    const notIncluded = [];
    if (belege) {
      for (const [i, p] of d.positionen.entries()) {
        for (const b of p.belege) {
          if (!/^image\//.test(b.type)) { notIncluded.push(`Position ${i + 1}: ${b.name} (PDF)`); continue; }
          let blob = null;
          try { blob = (await Media.get(b.id).catch(() => null)) || await Data.fileOf(d, b); } catch { blob = null; }
          if (!blob) { notIncluded.push(`Position ${i + 1}: ${b.name} (nicht verfügbar)`); continue; }
          try {
            const im = await imageData(blob);
            doc.addPage();
            doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30);
            T(`Beleg zu Position ${i + 1}: ${KA(p.kostenart).name}, ${fmtDate(p.datum)}, ${eur(betrag(p))}`, M, 14);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120);
            T(`${b.name} · SHA-256 ${b.sha256 || ''}${b.digital ? ' · digitales Original' : ''}`, M, 19);
            const maxW = W - 2 * M, maxH = 297 - 26 - M, r = Math.min(maxW / im.w, maxH / im.h);
            doc.addImage(im.url, 'JPEG', M, 24, im.w * r, im.h * r, undefined, 'FAST');
          } catch { notIncluded.push(`Position ${i + 1}: ${b.name} (Bild nicht lesbar)`); }
        }
      }
    }
    if (notIncluded.length) {
      doc.addPage(); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30);
      T('Weitere Belege (nicht als Bild enthalten)', M, 16);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      notIncluded.forEach((t, n) => T('• ' + t, M, 24 + n * 5.5));
    }

    // Fußzeile auf allen Seiten
    const pages = doc.getNumberOfPages();
    for (let n = 1; n <= pages; n++) {
      doc.setPage(n); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(140);
      T(`${d.nr || (aus ? 'Auslage' : 'Reise')} · ${k.zweck || ''}`, M, 292);
      T(`Seite ${n} von ${pages}`, W - M, 292, { align: 'right' });
    }
    const name = `${aus ? 'Auslage' : 'Reisekosten'}_${(d.nr || k.zweck || 'Entwurf').replace(/[^\wäöüÄÖÜß-]+/g, '_').slice(0, 40)}_${(d.status || 'Entwurf').replace(/\s+/g, '_')}.pdf`;
    return { blob: doc.output('blob'), name };
  }

  // Speichern: im Browser als Download; in Teams zusätzlich Öffnen in neuem Fenster (Downloads sind dort teils gesperrt)
  async function save(d) {
    const { blob, name } = await make(d);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    if (Data.inTeams?.()) setTimeout(() => window.open(url, '_blank'), 300);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return name;
  }
  return { make, save };
})();

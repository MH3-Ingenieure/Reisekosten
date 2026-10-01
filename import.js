'use strict';
/* =====================================================================
   Fahrten mit dem Privat-Pkw aus einer Excel-Liste übernehmen
   (z. B. Baustellenfahrten eines Monats, je Fahrt mit Projekt)
   ===================================================================== */
const Import = (() => {
  const COLS = [
    ['datum', /^datum/i], ['projekt', /projekt|kostenstelle/i], ['von', /^von/i], ['nach', /^(nach|bis|ziel)/i],
    ['km', /^km|kilometer/i], ['bemerkung', /bemerk|zweck|anlass|notiz/i]
  ];
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  let result = null;

  /* ---------- Vorlage ---------- */
  function template() {
    const projekte = Data.master().kostenstellen;
    const sheets = [
      {
        name: 'Fahrten', freeze: true, widths: [12, 30, 26, 26, 12, 34], colStyles: { 0: 2 },
        rows: [[{ v: 'Datum', s: 1 }, { v: 'Projekt', s: 1 }, { v: 'von', s: 1 }, { v: 'nach', s: 1 }, { v: 'km', s: 1 }, { v: 'Bemerkung', s: 1 }]],
        validations: projekte.length ? [{ range: 'B2:B1000', formula: `Projekte!$A$1:$A$${projekte.length}` }] : []
      },
      { name: 'Projekte', widths: [40], rows: projekte.map(p => [p]) },
      {
        name: 'Hinweise', widths: [110], rows: [
          [{ v: 'Fahrtenliste Privat-Pkw – so geht es', s: 1 }], [''],
          ['Eine Zeile je Fahrt im Blatt „Fahrten“. Die Spaltenüberschriften nicht ändern.'],
          ['Datum als TT.MM.JJJJ, z. B. 05.10.2026.'],
          ['Projekt in Spalte B über den Auswahlpfeil wählen (Liste aus der Reisekosten-App).'],
          ['von / nach: Start und Ziel, z. B. „Büro Düsseldorf“ und „Baustelle Wilhelmshaven“.'],
          ['km: gefahrene Kilometer dieser Fahrt; bei Hin- und Rückfahrt die Summe (oder zwei Zeilen).'],
          ['Am Monatsende speichern und in der App auf der Startseite „Fahrten aus Excel übernehmen“ wählen.'],
          ['Die App rechnet mit dem Kilometersatz, der am Tag der Fahrt gilt, und legt eine Abrechnung mit einer Position je Fahrt an.'],
          [{ v: 'Bitte vor dem Einreichen in der App prüfen; Fahrten zwischen Wohnung und regelmäßiger Arbeitsstätte sind keine Dienstreisen.', s: 4 }]
        ]
      }
    ];
    Xlsx.download(Xlsx.build(sheets), 'Fahrtenliste_Vorlage.xlsx');
    toast('Vorlage heruntergeladen (Ordner Downloads).');
  }

  /* ---------- Datei lesen und prüfen ---------- */
  function analyse(rows) {
    const h = rows.findIndex(r => r.some(c => /^datum/i.test(String(c).trim())) && r.some(c => /^km|kilometer/i.test(String(c).trim())));
    if (h < 0) throw new Error('In der Datei fehlt die Kopfzeile mit „Datum“ und „km“. Bitte die Vorlage verwenden.');
    const idx = {};
    rows[h].forEach((c, i) => { const name = String(c).trim(); const m = COLS.find(([k, re]) => idx[k] == null && re.test(name)); if (m) idx[m[0]] = i; });
    const known = new Set(Data.master().kostenstellen.map(x => x.toLowerCase()));
    const today = todayStr(), out = [];
    rows.slice(h + 1).forEach((r, n) => {
      const get = k => (idx[k] == null ? '' : r[idx[k]] ?? '');
      if (!COLS.some(([k]) => String(get(k)).trim())) return; // Leerzeile
      const t = { zeile: h + n + 2, errors: [], warns: [] };
      t.datum = Xlsx.toDate(get('datum'));
      t.projekt = String(get('projekt')).trim();
      t.von = String(get('von')).trim(); t.nach = String(get('nach')).trim();
      t.bemerkung = String(get('bemerkung')).trim();
      const kmRaw = get('km');
      t.km = typeof kmRaw === 'number' ? kmRaw : parseNum(kmRaw);
      if (!t.datum) t.errors.push('Datum fehlt oder ungültig');
      if (!(t.km > 0)) t.errors.push('Kilometer fehlen');
      if (!t.von || !t.nach) t.errors.push('von / nach fehlt');
      if (!t.projekt) t.errors.push('Projekt fehlt');
      else if (known.size && !known.has(t.projekt.toLowerCase())) t.warns.push('Projekt nicht in der Projektliste');
      if (t.datum && t.datum > today) t.warns.push('Datum liegt in der Zukunft');
      if (t.km > 1500) t.warns.push('ungewöhnlich viele Kilometer');
      if (!t.errors.length) { t.satz = Data.kmSatz(t.datum); t.betrag = Math.round(t.km * t.satz); }
      out.push(t);
    });
    if (!out.length) throw new Error('Die Datei enthält keine Fahrten.');
    return out.sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
  }
  async function onFile(file) {
    try { result = analyse(await Xlsx.readFile(file)); preview(file.name); }
    catch (e) { toast(e.message, 8000); }
  }

  /* ---------- Vorschau ---------- */
  function preview(name) {
    const ok = result.filter(t => !t.errors.length), bad = result.length - ok.length;
    const sumKm = ok.reduce((a, t) => a + t.km, 0), sumEur = ok.reduce((a, t) => a + t.betrag, 0);
    $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal sheet" role="dialog" aria-label="Fahrten übernehmen">
      <div class="modal-head"><h2>Fahrten übernehmen</h2><button class="icon-btn" data-action="modal-close">${ic('x')}</button></div>
      <div class="modal-body">
        <p style="margin-top:0"><b>${esc(name)}</b>: ${result.length} Zeile${result.length === 1 ? '' : 'n'} gelesen.
          ${ok.length} Fahrt${ok.length === 1 ? '' : 'en'} mit zusammen ${numIn(Math.round(sumKm * 10) / 10)} km = <b>${money(sumEur)}</b>.</p>
        ${bad ? `<div class="banner bad">${ic('warn')}<div>${bad} Zeile${bad === 1 ? '' : 'n'} mit Fehler ${bad === 1 ? 'wird' : 'werden'} nicht übernommen. Bitte in der Excel-Datei korrigieren und erneut hochladen – oder ohne diese Zeilen fortfahren.</div></div>` : ''}
        <div class="imp-wrap"><table class="imp">
          <tr><th>Zeile</th><th>Datum</th><th>Projekt</th><th>Strecke</th><th>km</th><th>Betrag</th><th>Hinweis</th></tr>
          ${result.map(t => `<tr class="${t.errors.length ? 'err' : t.warns.length ? 'warn' : ''}"><td>${t.zeile}</td><td>${t.datum ? fmtDate(t.datum) : '–'}</td><td>${esc(t.projekt || '–')}</td>
            <td>${esc([t.von, t.nach].filter(Boolean).join(' – ') || '–')}</td><td>${Number.isFinite(t.km) ? numIn(t.km) : '–'}</td><td>${t.betrag != null ? money(t.betrag) : '–'}</td>
            <td>${esc([...t.errors, ...t.warns].join('; '))}</td></tr>`).join('')}
        </table></div>
        <p class="muted small">Die App legt daraus eine neue Abrechnung mit einer Position je Fahrt an. Sie können sie danach prüfen, ergänzen und wie gewohnt unterschreiben und einreichen.</p>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn ghost" data-action="modal-close">Abbrechen</button>
        <button class="btn primary" data-action="import-apply"${ok.length ? '' : ' disabled'}>${ok.length} Fahrt${ok.length === 1 ? '' : 'en'} übernehmen</button></div>
    </div></div>`;
  }

  /* ---------- Abrechnung anlegen ---------- */
  function apply() {
    const ok = (result || []).filter(t => !t.errors.length);
    if (!ok.length) return;
    const first = ok[0].datum, last = ok[ok.length - 1].datum;
    const [y1, m1] = first.split('-').map(Number), [y2, m2] = last.split('-').map(Number);
    const zeit = y1 === y2 && m1 === m2 ? `${MONATE[m1 - 1]} ${y1}` : `${fmtDate(first)} – ${fmtDate(last)}`;
    const count = new Map();
    for (const t of ok) count.set(t.projekt, (count.get(t.projekt) || 0) + 1);
    const haupt = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const d = Data.newDraft();
    Object.assign(d.kopf, {
      zweck: `Fahrten mit Privat-Pkw ${zeit}`, kostenstelle: haupt, ort: count.size > 1 ? 'verschiedene Baustellen' : (ok[0].nach || haupt), land: 'Deutschland',
      beginn: first + 'T00:00', ende: last + 'T23:59'
    });
    d.positionen = ok.map(t => ({
      id: uid(), datum: t.datum, kostenart: Data.master().kostenarten.find(k => k.art === 'km')?.key || 'pkw', brutto: t.betrag, ust: 0, zahlungsart: 'privat',
      bemerkung: t.bemerkung, km: t.km, kmSatz: t.satz, strecke: `${t.von} – ${t.nach}`, projekt: t.projekt,
      bewirtung: { anlass: '', teilnehmer: '', ort: '' }, eigenbeleg: false, eigenbelegGrund: '', belege: []
    }));
    Data.touch(d);
    result = null;
    $('#modal-root').innerHTML = '';
    toast(`${ok.length} Fahrten übernommen. Bitte prüfen und dann unterschreiben und einreichen.`, 6000);
    location.hash = '#/reise/' + d.id;
  }

  const actions = {
    'import-template': template,
    'import-pick': () => $('#pick-import').click(),
    'import-apply': apply
  };
  return { actions, onFile, analyse, template };
})();

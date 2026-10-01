'use strict';
/* =====================================================================
   Reisekosten – Oberfläche (Etappe A: Erfassung und Einreichen)
   Anforderungen siehe Pflichtenheft Fassung 2 (F-, B-, P-Nummern)
   ===================================================================== */

/* ---------- Hilfsfunktionen ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const clone = o => JSON.parse(JSON.stringify(o));
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const SIG_KEY = 'reisekosten.unterschrift';

// Beträge werden in Cent gespeichert
function parseMoney(v) {
  let s = String(v ?? '').replace(/[€\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}
function parseNum(v) {
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}
const money = c => ((c || 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const moneyIn = c => (c ? (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const numIn = n => (n ? String(n).replace('.', ',') : '');
const fmtDate = s => (s ? s.slice(0, 10).split('-').reverse().join('.') : '');
const fmtDT = s => (s ? fmtDate(s) + ' ' + s.slice(11, 16) : '');
const fmtTs = ts => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtSize = b => (b >= 1048576 ? (b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

const { KA, isKm, isBew, betrag, projektOf, sums, validate, inhalt, pruefsumme } = Calc; // Rechenregeln: calc.js
const ZAHLUNG = { privat: 'privat', firmenkarte: 'Firmenkarte', bar: 'bar' };

/* ---------- Symbole ---------- */
const P = {
  plus: '<path d="M12 5v14M5 12h14"/>', back: '<path d="M15 6l-6 6 6 6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  clip: '<path d="M8 12.5l6.5-6.5a3 3 0 0 1 4.2 4.2L10 19a5 5 0 0 1-7-7l8-8"/>', warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17h.01"/>',
  check: '<path d="M5 12l5 5 9-10"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', pen: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;

/* ---------- Zustand der Oberfläche ---------- */
const UI = { ready: false, errors: null, pos: null, pendingRender: false };
const STATUS_CLASS = { 'Entwurf': 'st-draft', 'Zurückgewiesen': 'st-bad', 'Wird eingereicht': 'st-wait', 'Eingereicht': 'st-in', 'Geprüft': 'st-in', 'Freigegeben': 'st-ok', 'Ausgezahlt': 'st-ok', 'Storniert': 'st-bad', 'Wird verarbeitet': 'st-wait', 'Status ungültig': 'st-bad' };
const chip = s => `<span class="status ${STATUS_CLASS[s] || ''}">${esc(s)}</span>`;
const editable = d => d && (d.status === 'Entwurf' || d.status === 'Zurückgewiesen');

/* =====================================================================
   Ansichten
   ===================================================================== */
function route() { return (location.hash || '#/').slice(1).split('/').filter(Boolean); }

function render() {
  const v = $('#view');
  if (!UI.ready) { v.innerHTML = '<div class="page"><p class="muted">Lädt …</p></div>'; return; }
  const u = Data.user();
  $('#user-name').textContent = u?.name || '';
  $('#user-avatar').textContent = (u?.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const [r, id] = route();
  renderTabs(r);
  if (r === 'reise') {
    const d = Data.draft(id), c = !d && Data.claim(id);
    v.innerHTML = d ? tripView(d) : c ? Review.claimView(c) : '<div class="page"><p>Diese Abrechnung gibt es auf diesem Gerät nicht (mehr). <a href="#/">Zur Übersicht</a></p></div>';
    if (c) Review.after(c);
  } else if (r === 'pruefung' || r === 'freigabe') v.innerHTML = Review.listView(r);
  else if (r === 'rollen') { v.innerHTML = Review.rolesView(); Review.loadRoles(); }
  else if (r === 'profil') v.innerHTML = profileView();
  else if (r === 'hilfe') v.innerHTML = helpView();
  else v.innerHTML = homeView();
  UI.pendingRender = false;
}
// Reiter für Prüfung, Freigabe und Rollen (nur wer eine Rolle hat)
function renderTabs(r) {
  const R = Data.roles(), nav = $('#tabs');
  const open = s => Data.inbox().filter(c => c.status === s && !Data.pendingFor(c).length).length;
  const tabs = [['', 'Meine Reisekosten', 'list', 0]];
  if (R.pruefung) tabs.push(['pruefung', 'Prüfung', 'shield', open('Eingereicht') + open('Freigegeben')]);
  if (R.freigabe) tabs.push(['freigabe', 'Freigabe', 'check', open('Geprüft')]);
  if (R.admin) tabs.push(['rollen', 'Verwaltung', 'users', 0]);
  nav.hidden = tabs.length < 2;
  const cur = r === 'reise' ? UI.lastTab || '' : ['pruefung', 'freigabe', 'rollen'].includes(r) ? r : '';
  if (r !== 'reise') UI.lastTab = cur;
  nav.innerHTML = tabs.map(([k, l, i, n]) => `<a href="#/${k}" class="tab${k === cur ? ' on' : ''}">${ic(i)}<span>${l}</span>${n ? `<b class="cnt">${n}</b>` : ''}</a>`).join('');
}
// Neuaufbau nach Abgleich – nicht mitten in eine Eingabe hinein
function renderSoft() {
  const a = document.activeElement;
  if ($('#modal-root').childElementCount || (a && $('#view').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { UI.pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => { if (UI.pendingRender) renderSoft(); }, 50));

const localBanner = () => Data.cloud
  ? (Data.problem() ? `<div class="banner bad">${ic('warn')}<div><b>Verbindung zu SharePoint gestört.</b> ${esc(Data.problem())} Ihre Eingaben bleiben auf diesem Gerät gespeichert.</div></div>` : '')
  : `<div class="banner info">${ic('help')}<div><b>Lokaler Testbetrieb.</b> Ohne Microsoft-365-Anbindung bleiben alle Daten nur auf diesem Gerät. Einreichen, Prüfung und Freigabe werden mit denselben Regeln nachgebildet wie später im Flow; Sie haben hier alle Rollen. Für das Vier-Augen-Prinzip vor der Freigabe unter <a href="#/profil">Profil</a> einen anderen Namen eintragen.</div></div>`;

function tripCard(d, { who = false } = {}) {
  const k = d.kopf, s = sums(d), busy = Data.pendingFor(d).length;
  const when = k.beginn ? fmtDate(k.beginn) + (k.ende && k.ende.slice(0, 10) !== k.beginn.slice(0, 10) ? ' – ' + fmtDate(k.ende) : '') : 'Datum offen';
  const meta = [d.nr, who ? d.erstellerName : '', k.ort, when].filter(Boolean).join(' · ');
  return `<a class="trip" href="#/reise/${esc(d.id)}">
    <div class="trip-main"><div class="trip-title">${esc(k.zweck || 'Ohne Reisezweck')}</div>
      <div class="muted">${esc(meta)} · ${d.positionen.length} Position${d.positionen.length === 1 ? '' : 'en'}</div></div>
    <div class="trip-side"><b>${money(s.auszahlung)}</b>${busy ? chip('Wird verarbeitet') : chip(Data.valid(d) ? d.status : 'Status ungültig')}</div></a>`;
}
function homeView() {
  const drafts = Data.drafts(), claims = Data.claims(), card = d => tripCard(d);
  return `<div class="page">
    ${localBanner()}
    <div class="page-head"><h1>Meine Reisekosten</h1><button class="btn primary" data-action="new">${ic('plus')} NEUE REISE</button></div>
    <div class="home-tools"><button class="btn ghost small" data-action="import-pick">${ic('file')} Fahrten aus Excel übernehmen</button>
      <button class="link small" data-action="import-template">Excel-Vorlage für Fahrten herunterladen</button></div>
    ${drafts.length ? `<h2 class="sec">In Bearbeitung</h2><div class="trips">${drafts.map(d => card(d)).join('')}</div>` : ''}
    ${claims.length ? `<h2 class="sec">Eingereicht</h2><div class="trips">${claims.map(c => card(c)).join('')}</div>` : ''}
    ${!drafts.length && !claims.length ? `<div class="empty"><p><b>Noch keine Reise erfasst.</b></p><p class="muted">Mit „Neue Reise“ anlegen, Kosten mit Beleg erfassen und zum Schluss unterschreiben und einreichen.</p></div>` : ''}
    <p class="foot"><a href="#/hilfe">${ic('help')} Hilfe</a></p>
  </div>`;
}

function field(label, key, value, { type = 'text', err, list, ph = '', mode, wide } = {}) {
  return `<label class="fld${wide ? ' wide' : ''}${err ? ' err' : ''}"><span>${label}</span>
    <input type="${type}" data-k="${key}" value="${esc(value)}" placeholder="${esc(ph)}"${list ? ` list="${list}"` : ''}${mode ? ` inputmode="${mode}"` : ''} autocomplete="off"></label>`;
}

function tripView(d) {
  const k = d.kopf, ro = !editable(d), errs = UI.errors?.id === d.id ? UI.errors.keys : new Set();
  const E = key => errs.has(key);
  const usedKs = [...new Set([...Data.master().kostenstellen, ...Data.drafts().map(x => x.kopf.kostenstelle), ...Data.claims().map(x => x.kopf.kostenstelle)].filter(Boolean))];
  const head = ro
    ? `<div class="card"><div class="card-head">Reise</div><div class="card-body">${readHead(d)}</div></div>`
    : `<div class="card"><div class="card-head">Reise</div><div class="card-body grid">
      ${field('Reisezweck', 'zweck', k.zweck, { err: E('zweck'), ph: 'z. B. Baubesprechung Neubau Uniper', wide: true })}
      ${field('Projekt / Kostenstelle', 'kostenstelle', k.kostenstelle, { err: E('kostenstelle'), list: 'dl-ks' })}
      ${field('Reiseziel (Ort)', 'ort', k.ort, { err: E('ort') })}
      ${field('Land', 'land', k.land, { err: E('land'), list: 'dl-land' })}
      ${field('Beginn', 'beginn', k.beginn, { type: 'datetime-local', err: E('beginn') })}
      ${field('Ende', 'ende', k.ende, { type: 'datetime-local', err: E('ende') })}
      ${field('Erhaltener Vorschuss (€)', 'vorschuss', moneyIn(k.vorschuss), { mode: 'decimal', ph: '0,00' })}
      <datalist id="dl-ks">${usedKs.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-land">${['Deutschland', 'Österreich', 'Schweiz', 'Niederlande', 'Belgien', 'Luxemburg', 'Frankreich', 'Dänemark', 'Polen', 'Italien', 'Spanien', 'Vereinigtes Königreich'].map(x => `<option value="${x}">`).join('')}</datalist>
    </div></div>`;
  const rows = d.positionen.map((p, i) => posRow(d, p, i, errs.has('p:' + p.id), ro)).join('');
  const hint = (d.hinweis ? `<div class="banner bad">${ic('warn')}<div>${esc(d.hinweis)}</div></div>` : '')
    + (d.status === 'Zurückgewiesen' && d.rueckweisung ? `<div class="banner bad">${ic('warn')}<div><b>Zurückgewiesen${d.nr ? ' (' + esc(d.nr) + ')' : ''}:</b> ${esc(d.rueckweisung)}<br><span class="small">Bitte korrigieren und erneut unterschreiben und einreichen. Hinweise der Prüfung stehen bei den Positionen.</span></div></div>` : '')
    + (d.status === 'Wird eingereicht' ? `<div class="banner wait">${ic('lock')}<div><b>Wird eingereicht.</b> Die Abrechnung ist unterschrieben und gesperrt. Die Übernahme dauert meist ein bis fünf Minuten; danach erscheint sie mit Abrechnungsnummer.</div></div>` : '');
  return `<div class="page narrow">
    <div class="page-head"><a class="back" href="#/">${ic('back')} Übersicht</a></div>
    <div class="page-head"><h1 id="trip-title">${esc(k.zweck || 'Neue Reise')}</h1>${chip(d.status)}</div>
    ${Data.cloud ? localBanner() : ''}${hint}
    ${UI.errors?.id === d.id ? `<div class="banner bad">${ic('warn')}<div>Vor dem Einreichen fehlen noch Angaben – die Felder sind rot markiert.</div></div>` : ''}
    ${head}
    <div class="card${E('positionen') ? ' err-card' : ''}"><div class="card-head">Kostenpositionen<span class="grow"></span>
      ${ro ? '' : `<button class="btn primary small" data-action="add-pos">${ic('plus')} Position</button>`}</div>
      <div class="pos-list">${rows || `<p class="muted pad">Noch keine Position. ${ro ? '' : 'Mit „+ Position“ Kosten erfassen.'}</p>`}</div></div>
    <div class="card"><div class="card-head">Summen</div><div class="card-body" id="sums">${sumsHTML(d)}</div></div>
    ${ro ? '' : `<div class="actions">
      <button class="btn danger-ghost" data-action="del-draft">${ic('trash')} Entwurf löschen</button><span class="grow"></span>
      <span class="muted save-hint">Wird automatisch gespeichert</span>
      <button class="btn primary big" data-action="submit">${ic('pen')} UNTERSCHREIBEN UND EINREICHEN</button></div>`}
  </div>`;
}
function readHead(d) {
  const k = d.kopf;
  const row = (l, v) => `<div class="rd"><span>${l}</span><b>${esc(v || '–')}</b></div>`;
  return `<div class="rd-grid">${row('Reisezweck', k.zweck)}${row('Projekt / Kostenstelle', k.kostenstelle)}${row('Reiseziel', [k.ort, k.land].filter(Boolean).join(', '))}
    ${row('Beginn', fmtDT(k.beginn))}${row('Ende', fmtDT(k.ende))}${row('Vorschuss', money(k.vorschuss))}</div>`;
}
function posRow(d, p, i, err, ro) {
  const ka = KA(p.kostenart);
  const sub = isKm(p) ? `${esc(p.strecke || '')} · ${numIn(p.km)} km × ${money(p.kmSatz)}`
    : isBew(p) ? esc([p.bewirtung?.anlass, p.bemerkung].filter(Boolean).join(' · ')) : esc(p.bemerkung || '');
  const dig = p.belege.filter(b => b.digital).length;
  const bel = isKm(p) ? '' : p.belege.length ? `<span class="belcount">${ic('clip')}${p.belege.length}${dig ? ` · ${dig === p.belege.length ? 'digital' : dig + ' digital'}` : ''}</span>`
    : p.eigenbeleg ? '<span class="belcount eigen">Eigenbeleg</span>' : `<span class="belcount miss">${ic('warn')}kein Beleg</span>`;
  const proj = projektOf(d, p), projNote = proj && proj !== String(d.kopf.kostenstelle || '').trim() ? `<span class="pos-sub">Projekt: ${esc(proj)}</span>` : '';
  const eigen = p.eigenbeleg && ro ? `<span class="pos-note warn">Eigenbeleg: ${esc(p.eigenbelegGrund || '')}</span>` : ''; // B-06: in der Prüfung sichtbar
  const note = d.pruefung?.[p.id]?.kommentar ? `<span class="pos-note">Prüfung: ${esc(d.pruefung[p.id].kommentar)}</span>` : '';
  return `<button class="pos-row${err ? ' err' : ''}" data-action="${ro ? 'view-pos' : 'edit-pos'}" data-id="${esc(p.id)}">
    <span class="pos-n">${i + 1}</span>
    <span class="pos-main"><b>${esc(ka.name)}</b> <span class="muted">${fmtDate(p.datum)}</span>${sub ? `<span class="pos-sub">${sub}</span>` : ''}${projNote}${eigen}${note}</span>
    <span class="pos-side"><b>${money(betrag(p))}</b><span class="muted small">${isKm(p) ? 'Kilometergeld' : esc(ZAHLUNG[p.zahlungsart] || '')}</span>${bel}</span></button>`;
}
function sumsHTML(d) {
  const s = sums(d);
  return `<table class="sums">
    <tr><td>Auslagen gesamt</td><td>${money(s.auslagen)}</td></tr>
    ${s.firmenkarte ? `<tr class="muted"><td>davon mit Firmenkarte bezahlt (wird nicht erstattet)</td><td>− ${money(s.firmenkarte)}</td></tr>` : ''}
    ${s.steuer ? `<tr class="muted"><td>darin enthaltene Umsatzsteuer (herausgerechnet)</td><td>${money(s.steuer)}</td></tr>` : ''}
    <tr><td>Kilometergeld</td><td>${money(s.km)}</td></tr>
    ${s.vorschuss ? `<tr><td>Erhaltener Vorschuss</td><td>− ${money(s.vorschuss)}</td></tr>` : ''}
    <tr class="total"><td>${s.auszahlung < 0 ? 'Rückzahlung an die Firma' : 'Auszahlungsbetrag'}</td><td>${money(Math.abs(s.auszahlung))}</td></tr></table>`;
}

function profileView() {
  const u = Data.user(), sig = localStorage.getItem(SIG_KEY);
  return `<div class="page narrow">
    <div class="page-head"><a class="back" href="#/">${ic('back')} Übersicht</a></div>
    <div class="page-head"><h1>Profil</h1></div>
    <div class="card"><div class="card-head">Benutzer</div><div class="card-body">
      ${Data.cloud ? `<p style="margin-top:0"><b>${esc(u?.name)}</b><br><span class="muted">${esc(u?.mail)}</span></p>
        <p class="muted">${esc(Data.statusText())}</p>
        <div class="row"><button class="btn ghost small" data-action="sync">Jetzt abgleichen</button><button class="btn ghost small" data-action="logout">Abmelden</button></div>`
      : `<label class="fld"><span>Name (Testbetrieb)</span><input data-action-input="local-name" value="${esc(u?.name)}"></label>`}
    </div></div>
    <div class="card"><div class="card-head">Hinterlegte Unterschrift</div><div class="card-body">
      <p class="muted" style="margin-top:0">Wird beim Einreichen als Unterschrift angeboten (P-01). Sie liegt nur auf diesem Gerät.</p>
      ${sig ? `<img class="sig-img" src="${sig}" alt="Hinterlegte Unterschrift">` : '<p>Keine Unterschrift hinterlegt.</p>'}
      <div class="row"><button class="btn ghost small" data-action="sig-draw">${ic('pen')} Unterschrift zeichnen</button>
        <button class="btn ghost small" data-action="sig-upload">${ic('file')} Bild hochladen (JPEG, PNG)</button>
        ${sig ? `<button class="btn danger-ghost small" data-action="sig-del">${ic('trash')} Entfernen</button>` : ''}</div>
    </div></div>
    <div class="card"><div class="card-head">Belegerkennung</div><div class="card-body">
      <label class="check" style="margin:0"><input type="checkbox" data-action-input="ocr-toggle"${Ocr.enabled() ? ' checked' : ''}> Belege automatisch auslesen (Kostenart, Betrag, Datum, Umsatzsteuer)</label>
      <p class="muted small" style="margin-bottom:0">Die Erkennung läuft auf diesem Gerät; Belege werden dafür nicht verschickt. Beim ersten Foto lädt sie einmalig einige Megabyte. Auf langsamen Geräten kann sie hier abgeschaltet werden.</p>
    </div></div>
    ${Teams.cardHTML()}
    <div class="card"><div class="card-head">Version ${esc(APP_VERSION)}</div><div class="card-body">
      ${APP_CHANGES.map(c => `<p style="margin:0 0 4px"><b>${esc(c.v)}</b> <span class="muted">(${esc(c.d)})</span></p><ul class="changes">${c.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
    </div></div>
  </div>`;
}

function helpView() {
  return `<div class="page narrow">
    <div class="page-head"><a class="back" href="#/">${ic('back')} Übersicht</a></div>
    <div class="page-head"><h1>Hilfe</h1></div>
    <div class="card"><div class="card-body help">
      <h3>So rechnen Sie eine Reise ab</h3>
      <ol><li><b>Neue Reise</b> antippen und Reisezweck, Projekt, Ziel sowie Beginn und Ende eintragen.</li>
        <li>Für jede Ausgabe <b>+ Position</b>: am schnellsten zuerst den Beleg fotografieren – die App liest Kostenart, Betrag, Datum und Umsatzsteuer aus. Werte prüfen, speichern.</li>
        <li>Baustellenfahrten eines Monats: Startseite → <b>Excel-Vorlage für Fahrten herunterladen</b>, im Laufe des Monats je Fahrt eine Zeile mit Projekt ausfüllen, am Monatsende <b>Fahrten aus Excel übernehmen</b>.</li>
        <li>Fahrten mit dem eigenen Pkw als <b>Privat-Pkw (Kilometer)</b> erfassen – der Betrag wird aus den Kilometern berechnet, ein Beleg ist nicht nötig.</li>
        <li>Zum Schluss <b>Unterschreiben und einreichen</b>. Die App prüft vorher, ob alle Pflichtangaben vorhanden sind.</li></ol>
      <h3>Gut zu wissen</h3>
      <ul><li>Alles wird automatisch gespeichert. Sie können am Smartphone anfangen und am PC weitermachen.</li>
        <li>Belege: PDF, JPG, PNG oder HEIC, höchstens 10 MB. Große Fotos verkleinert die App selbst.</li>
        <li>Beleg verloren? Bei der Position „Eigenbeleg“ ankreuzen und begründen.</li>
        <li>Rechnung nur digital erhalten (z. B. PDF per E-Mail)? Beim Beleg „digitales Original“ ankreuzen – dann wird kein Papier im Büro erwartet. Bei PDF-Dateien ist das vorbelegt.</li>
        <li>Der Betrag ist immer der Bruttobetrag laut Beleg. Die Umsatzsteuer ist darin enthalten; die App rechnet sie für die Buchhaltung heraus.</li>
        <li>Gehört eine Ausgabe zu einem anderen Projekt als die Reise, bei der Position das Projekt ändern.</li>
        <li>Bewirtungen brauchen Anlass, Teilnehmer und Ort.</li>
        <li>Mit Firmenkarte bezahlte Beträge werden mit abgerechnet, aber nicht an Sie ausgezahlt.</li>
        <li>Nach dem Einreichen kann die Abrechnung nicht mehr geändert werden. Die Originalbelege bitte im Büro abgeben.</li></ul>
    </div></div></div>`;
}

/* =====================================================================
   Position erfassen (Dialog)
   ===================================================================== */
function blankPos(d) {
  const last = d.positionen[d.positionen.length - 1];
  return {
    id: uid(), datum: last?.datum || (d.kopf.beginn || '').slice(0, 10) || todayStr(), kostenart: '', brutto: 0, ust: 19, zahlungsart: 'privat', bemerkung: '',
    km: 0, kmSatz: 0, strecke: '', projekt: last?.projekt || d.kopf.kostenstelle || '', bewirtung: { anlass: '', teilnehmer: '', ort: '' }, eigenbeleg: false, eigenbelegGrund: '', belege: []
  };
}
function openPos(d, p, ro = false) {
  const isNew = !p;
  const w = clone(p || blankPos(d));
  w.bewirtung = w.bewirtung || { anlass: '', teilnehmer: '', ort: '' };
  if (w.projekt === undefined) w.projekt = d.kopf.kostenstelle || '';
  UI.pos = { draftId: d.id, p: w, isNew, ro, added: [], removed: [], busy: 0, raw: { brutto: moneyIn(w.brutto), km: numIn(w.km) }, ocr: null, touched: {} };
  renderPos();
  if (isNew) setTimeout(() => $('.ka-grid button')?.focus(), 50);
}
// Umsatzsteuer ist im Bruttobetrag enthalten und wird herausgerechnet
function ustText(p, raw) {
  const b = parseMoney(raw), s = Number(p.ust) || 0;
  if (Number.isNaN(b) || !b) return '';
  const net = Math.round(b / (1 + s / 100));
  return s ? `darin ${money(b - net)} Umsatzsteuer (${s} %), netto ${money(net)}` : 'ohne Umsatzsteuer';
}
function belegeHTML(p, ro, s) {
  return `<div class="belege">
    ${p.belege.map(b => `<div class="bel"><button type="button" class="bel-open" data-action="bel-open" data-id="${esc(b.id)}" title="${esc(b.name)}">
      ${b.thumb ? `<img src="${b.thumb}" alt="">` : `<span class="bel-ic">${ic('file')}<small>${b.type === 'application/pdf' ? 'PDF' : 'Bild'}</small></span>`}</button>
      <span class="bel-name">${esc(b.name)} · ${fmtSize(b.size)}</span>
      ${ro ? (b.digital ? '<span class="bel-tag">digitales Original</span>' : '<span class="bel-tag paper">Papierbeleg</span>')
        : `<label class="bel-dig" title="Ankreuzen, wenn es keinen Papierbeleg gibt (z. B. Rechnung per E-Mail)"><input type="checkbox" data-dig="${esc(b.id)}"${b.digital ? ' checked' : ''}> digitales Original</label>
        <button type="button" class="bel-del" data-action="bel-del" data-id="${esc(b.id)}" aria-label="Beleg entfernen">${ic('x')}</button>`}</div>`).join('')}
    ${s.busy ? `<div class="bel busy"><span class="spinner"></span><span class="bel-name">wird verarbeitet …</span></div>` : ''}
    ${ro ? '' : `<button type="button" class="bel-add" data-action="bel-camera">${ic('camera')}<span>Foto aufnehmen</span></button>
      <button type="button" class="bel-add" data-action="bel-file">${ic('file')}<span>Datei wählen</span></button>`}
  </div>`;
}
function ocrHTML(s) {
  const o = s.ocr;
  if (!o) return '';
  if (o.state === 'run') return `<div class="ocr run"><span class="spinner"></span><div>Beleg wird gelesen …${o.first ? ' Beim ersten Mal lädt die Erkennung einmalig einige Megabyte.' : ''}</div></div>`;
  if (o.state === 'err') return `<div class="ocr bad">${ic('warn')}<div>Beleg konnte nicht gelesen werden: ${esc(o.msg)}</div></div>`;
  const f = o.found, parts = [];
  if (f.kostenart) parts.push(KA(f.kostenart).name);
  if (f.brutto) parts.push(money(f.brutto));
  if (f.datum) parts.push(fmtDate(f.datum));
  if (f.ust != null) parts.push(f.ust + ' % USt');
  if (f.aussteller) parts.push(f.aussteller);
  return `<div class="ocr ok">${ic('check')}<div>${parts.length ? 'Aus dem Beleg übernommen: <b>' + esc(parts.join(' · ')) + '</b>. Bitte prüfen.' : 'Auf dem Beleg wurden keine Angaben erkannt – bitte von Hand eintragen.'}
    <button type="button" class="link" data-action="ocr-run">erneut lesen</button>
    ${f.mixed ? '<br><b>Achtung:</b> Der Beleg enthält 7 % und 19 % Umsatzsteuer (z. B. Übernachtung und Frühstück). Steuersatz bitte prüfen und den Beleg bei Bedarf auf zwei Positionen aufteilen.' : ''}</div></div>`;
}
function renderPos() {
  const s = UI.pos, p = s.p, ro = s.ro, ka = p.kostenart ? KA(p.kostenart) : null;
  const dis = ro ? ' disabled' : '';
  const inp = (label, f, val, extra = '') => `<label class="fld"><span>${label}</span><input data-p="${f}" value="${esc(val)}"${extra}${dis}></label>`;
  const kas = Data.master().kostenarten.filter(k => k.aktiv !== false || k.key === p.kostenart);
  const projekt = inp('Projekt / Kostenstelle', 'projekt', p.projekt || '', ' list="dl-proj" placeholder="Projekt oder Kostenstelle" autocomplete="off"');
  let body = '';
  // Neue Position ohne Kostenart: zuerst den Beleg erfassen, die App liest Kostenart, Betrag und Datum aus (B-12)
  if (!ka && !ro && Ocr.enabled()) body += `<div class="quick"><div class="quick-t">${ic('camera')}<span><b>Am schnellsten:</b> zuerst den Beleg fotografieren oder die Datei wählen – die App liest Kostenart, Betrag und Datum aus.</span></div>
    ${belegeHTML(p, ro, s)}${ocrHTML(s)}</div>`;
  // Kostenart: Tastenfeld zur Auswahl, danach eingeklappt (wenige Bedienschritte, N-08)
  body += ka && !s.pickKa
    ? `<div class="fld"><span>Kostenart</span><div class="ka-chosen"><b>${esc(ka.name)}</b>${ro ? '' : '<button type="button" class="link" data-action="pos-ka-change">ändern</button>'}</div></div>`
    : `<div class="fld"><span>Kostenart${!ro && !ka ? ' – oder ohne Beleg direkt wählen' : ''}</span><div class="ka-grid">${kas.map(k => `<button type="button" class="ka${k.key === p.kostenart ? ' on' : ''}" data-action="pos-ka" data-key="${esc(k.key)}"${dis}>${esc(k.name)}</button>`).join('')}</div></div>`;
  if (ka) {
    if (ka.art === 'km') {
      const satz = ro ? p.kmSatz : Data.kmSatz(p.datum), km = parseNum(s.raw.km);
      body += `<div class="grid">${inp('Strecke (von – nach)', 'strecke', p.strecke, ' placeholder="z. B. Düsseldorf – Essen und zurück"')}
        ${inp('Kilometer', 'km', s.raw.km, ' inputmode="decimal" placeholder="0"')}
        ${inp('Datum', 'datum', p.datum, ' type="date"')}
        <div class="fld"><span>Kilometergeld</span><div class="calc" id="km-calc">${Number.isNaN(km) ? 'Kilometer ungültig' : `${numIn(km) || 0} km × ${money(satz)} = <b>${money(Math.round(km * satz))}</b>`}</div></div>
        ${projekt}</div>`;
    } else {
      body += `<div class="grid">${inp('Betrag brutto (€)', 'brutto', s.raw.brutto, ' inputmode="decimal" placeholder="0,00" class="big-in"')}
        ${inp('Datum', 'datum', p.datum, ' type="date"')}</div>
        <p class="calc-line" id="ust-calc">${ustText(p, s.raw.brutto)}</p>
        <div class="fld"><span>Belege</span>${belegeHTML(p, ro, s)}</div>${ocrHTML(s)}
        <label class="check"><input type="checkbox" data-p="eigenbeleg"${p.eigenbeleg ? ' checked' : ''}${dis}> Eigenbeleg – der Originalbeleg ist verloren gegangen</label>
        ${p.eigenbeleg ? `<label class="fld"><span>Begründung für den Eigenbeleg</span><textarea data-p="eigenbelegGrund" rows="2"${dis}>${esc(p.eigenbelegGrund)}</textarea></label>` : ''}
        <div class="grid"><label class="fld"><span>Umsatzsteuersatz</span><select data-p="ust"${dis}>${[19, 7, 0].map(v => `<option value="${v}"${Number(p.ust) === v ? ' selected' : ''}>${v} %</option>`).join('')}</select></label>
        <div class="fld"><span>Zahlungsart</span><div class="seg">${Object.entries(ZAHLUNG).map(([k, l]) => `<button type="button" class="${p.zahlungsart === k ? 'on' : ''}" data-action="pos-pay" data-key="${k}"${dis}>${l}</button>`).join('')}</div></div>
        ${projekt}</div>`;
      if (ka.art === 'bewirtung') body += `<div class="sub-card"><div class="sub-title">Bewirtung (Pflichtangaben)</div><div class="grid">
        ${inp('Anlass', 'bew.anlass', p.bewirtung.anlass)}${inp('Ort der Bewirtung', 'bew.ort', p.bewirtung.ort, ' placeholder="Name und Ort des Lokals"')}
        <label class="fld wide"><span>Teilnehmer (Name, Firma)</span><textarea data-p="bew.teilnehmer" rows="3"${dis}>${esc(p.bewirtung.teilnehmer)}</textarea></label></div></div>`;
    }
    body += `<label class="fld" style="margin-top:12px"><span>Bemerkung</span><input data-p="bemerkung" value="${esc(p.bemerkung)}"${dis}></label>`;
  }
  body += `<datalist id="dl-proj">${Data.master().kostenstellen.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
  const scroll = $('.modal-body')?.scrollTop || 0;
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal sheet" role="dialog" aria-label="Position">
    <div class="modal-head"><h2>${ro ? 'Position' : s.isNew ? 'Neue Position' : 'Position bearbeiten'}</h2><button class="icon-btn" data-action="pos-cancel" aria-label="Schließen">${ic('x')}</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">${ro ? '<span class="grow"></span><button class="btn ghost" data-action="pos-cancel">Schließen</button>'
      : `${s.isNew ? '' : `<button class="btn danger-ghost" data-action="pos-delete">${ic('trash')} Löschen</button>`}<span class="grow"></span>
      <button class="btn ghost" data-action="pos-cancel">Abbrechen</button><button class="btn primary" data-action="pos-save"${s.busy || !p.kostenart ? ' disabled' : ''}>Speichern</button>`}</div>
  </div></div>`;
  $('.modal-body').scrollTop = scroll;
}
function posInput(el) {
  const s = UI.pos, p = s.p, f = el.dataset.p;
  if (f === 'eigenbeleg') { p.eigenbeleg = el.checked; renderPos(); return; }
  if (f === 'brutto' || f === 'km') {
    s.raw[f] = el.value;
    if (f === 'km') { const km = parseNum(el.value), satz = Data.kmSatz(p.datum); $('#km-calc').innerHTML = Number.isNaN(km) ? 'Kilometer ungültig' : `${numIn(km) || 0} km × ${money(satz)} = <b>${money(Math.round(km * satz))}</b>`; }
    else if ($('#ust-calc')) $('#ust-calc').textContent = ustText(p, s.raw.brutto);
    return;
  }
  if (f.startsWith('bew.')) { p.bewirtung[f.slice(4)] = el.value; return; }
  p[f] = f === 'ust' ? Number(el.value) : el.value;
  if (f === 'datum' || f === 'ust') s.touched[f] = true; // von Hand gesetzt: Belegerkennung überschreibt das nicht
  if (f === 'ust' && $('#ust-calc')) $('#ust-calc').textContent = ustText(p, s.raw.brutto);
  if (f === 'datum' && isKm(p)) posInput($('[data-p="km"]'));
}
async function addFiles(files) {
  const s = UI.pos;
  if (!s) return;
  const all = [...Data.drafts(), ...Data.claims()].flatMap(d => d.positionen.flatMap(p => p.belege.map(b => ({ b, d }))));
  let neu = null;
  for (const f of files) {
    s.busy++; renderPos();
    try {
      const r = await Media.prepare(f), id = uid();
      await Media.put(id, r.blob);
      const dup = all.find(x => x.b.sha256 === r.sha256) || s.p.belege.find(b => b.sha256 === r.sha256);
      // PDF kommt meist per E-Mail: dann ist die Datei selbst das Original (kein Papierbeleg)
      neu = { id, name: r.name, type: r.type, size: r.size, sha256: r.sha256, thumb: r.thumb, uploaded: false, digital: r.type === 'application/pdf' };
      s.p.belege.push(neu);
      s.added.push(id);
      if (dup) toast(`Hinweis: Diese Datei ist bereits als Beleg erfasst${dup.d ? ` (Reise „${dup.d.kopf.zweck || 'ohne Zweck'}“)` : ''}. Bitte prüfen, ob sie doppelt abgerechnet wird.`, 7000); // B-10
      else if (r.converted) toast(`Foto verkleinert auf ${fmtSize(r.size)}.`);
    } catch (e) { toast(e.message, 8000); }
    finally { if (UI.pos === s) { s.busy--; renderPos(); } }
  }
  // Belegerkennung, solange noch kein Betrag eingetragen ist
  if (neu && UI.pos === s && Ocr.enabled() && !parseMoney(s.raw.brutto)) runOcr(neu, false);
}
async function runOcr(b, force) {
  const s = UI.pos;
  if (!s || !b) return;
  const d = Data.draft(s.draftId) || Data.claim(s.draftId);
  s.ocr = { state: 'run', first: !Ocr.ready() && b.type !== 'application/pdf' };
  renderPos();
  try {
    const blob = (await Media.get(b.id).catch(() => null)) || (d && await Data.fileOf(d, b));
    if (!blob) throw new Error('Datei nicht gefunden.');
    const f = await Ocr.recognize(blob);
    if (UI.pos !== s) return;
    const p = s.p, used = {};
    if (f.kostenart && (!p.kostenart || force)) { const k = KA(f.kostenart); if (k.art !== 'km') { p.kostenart = k.key; p.ust = k.ust; used.kostenart = k.key; } }
    if (f.brutto && (!parseMoney(s.raw.brutto) || force)) { s.raw.brutto = moneyIn(f.brutto); used.brutto = f.brutto; }
    if (f.datum && (!s.touched.datum || force)) { p.datum = f.datum; used.datum = f.datum; }
    if (f.ust != null && (!s.touched.ust || force)) { p.ust = f.ust; used.ust = f.ust; }
    if (f.aussteller && (!p.bemerkung || force)) { p.bemerkung = f.aussteller; used.aussteller = f.aussteller; }
    if (f.mixed) used.mixed = true;
    if (isBew(p) && !p.bewirtung.ort) p.bewirtung.ort = [f.aussteller, d?.kopf.ort].filter(Boolean).join(', ');
    s.ocr = { state: 'ok', found: used };
  } catch (e) {
    if (UI.pos === s) s.ocr = { state: 'err', msg: e.message };
  }
  if (UI.pos === s) renderPos();
}
function closePos() { $('#modal-root').innerHTML = ''; UI.pos = null; if (UI.pendingRender) render(); }
function savePos() {
  const s = UI.pos, d = Data.draft(s.draftId), p = s.p;
  if (!d || s.busy) return;
  p.projekt = String(p.projekt || '').trim() || String(d.kopf.kostenstelle || '').trim();
  if (isKm(p)) {
    const km = parseNum(s.raw.km);
    if (Number.isNaN(km)) return toast('Bitte die Kilometer als Zahl eintragen.');
    Object.assign(p, { km, kmSatz: Data.kmSatz(p.datum), zahlungsart: 'privat', ust: 0, eigenbeleg: false, eigenbelegGrund: '' });
    for (const b of p.belege) s.removed.push(b);
    p.belege = []; p.brutto = betrag(p);
  } else {
    const c = parseMoney(s.raw.brutto);
    if (Number.isNaN(c)) return toast('Bitte den Betrag als Zahl eintragen, z. B. 12,50.');
    Object.assign(p, { brutto: c, km: 0, kmSatz: 0, strecke: '' });
  }
  if (!isBew(p)) p.bewirtung = { anlass: '', teilnehmer: '', ort: '' };
  const i = d.positionen.findIndex(x => x.id === p.id);
  if (i >= 0) d.positionen[i] = p; else d.positionen.push(p);
  dropFiles(d, s.removed);
  Data.touch(d);
  closePos(); render();
}
function dropFiles(d, belege) {
  for (const b of belege) {
    if (b.uploaded && b.datei) (d.removed = d.removed || []).push(b.datei);
    Media.del(b.id).catch(() => {});
  }
}

/* ---------- Belegvorschau (B-05) ---------- */
let previewUrl = null;
async function preview(b, d) {
  const box = document.createElement('div');
  box.className = 'preview';
  box.innerHTML = `<div class="preview-bar"><span class="grow">${esc(b.name)}</span><button class="icon-btn" data-action="preview-close" aria-label="Schließen">${ic('x')}</button></div><div class="preview-body"><span class="spinner"></span></div>`;
  document.body.appendChild(box);
  try {
    const blob = (await Media.get(b.id).catch(() => null)) || (d && await Data.fileOf(d, b));
    if (!blob) throw new Error('Die Datei ist auf diesem Gerät nicht vorhanden.');
    previewUrl = URL.createObjectURL(blob);
    $('.preview-body', box).innerHTML = b.type === 'application/pdf'
      ? `<iframe src="${previewUrl}" title="${esc(b.name)}"></iframe><a class="btn ghost small" href="${previewUrl}" target="_blank" rel="noopener">In neuem Fenster öffnen</a>`
      : `<img src="${previewUrl}" alt="${esc(b.name)}">`;
  } catch (e) { $('.preview-body', box).innerHTML = `<p>${esc(e.message)}</p>`; }
}
function closePreview() { $('.preview')?.remove(); if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }

/* =====================================================================
   Einreichen mit Unterschrift (F-11, P-01)
   ===================================================================== */
function startSubmit(d) {
  const errs = validate(d);
  if (errs.length) {
    UI.errors = { id: d.id, keys: new Set(errs.map(e => e.key)) };
    render();
    $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" role="dialog">
      <div class="modal-head"><h2>Noch nicht vollständig</h2><button class="icon-btn" data-action="modal-close">${ic('x')}</button></div>
      <div class="modal-body"><p style="margin-top:0">Bitte vor dem Einreichen ergänzen:</p><ul class="errlist">
        ${errs.map(e => `<li><button class="link" data-action="goto-err" data-key="${esc(e.key)}" data-pos="${esc(e.pos || '')}">${esc(e.msg)}</button></li>`).join('')}</ul></div>
      <div class="modal-foot"><span class="grow"></span><button class="btn primary" data-action="modal-close">Zur Abrechnung</button></div></div></div>`;
    return;
  }
  UI.errors = null;
  signSubmit(d);
}
let pad_ = null, signJob = null;
// Unterschriftsdialog für Ersteller, Prüfung und Freigabe (P-01, P-04)
function openSign({ title, d, confirm, note = '', button, extra = '', run }) {
  signJob = run;
  const s = sums(d), stored = localStorage.getItem(SIG_KEY), mode = stored ? 'stored' : 'draw';
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-action="modal-close">${ic('x')}</button></div>
    <div class="modal-body">
      <div class="sum-box"><div><b>${esc(d.nr ? d.nr + ' · ' : '')}${esc(d.kopf.zweck)}</b><br><span class="muted">${esc(d.erstellerName ? d.erstellerName + ' · ' : '')}${fmtDT(d.kopf.beginn)} – ${fmtDT(d.kopf.ende)} · ${d.positionen.length} Positionen</span></div>
        <div class="sum-amt"><span class="muted small">${s.auszahlung < 0 ? 'Rückzahlung' : 'Auszahlung'}</span><b>${money(Math.abs(s.auszahlung))}</b></div></div>
      ${extra}
      ${stored ? `<div class="seg sig-mode"><button type="button" class="on" data-action="sig-mode" data-mode="stored">Hinterlegte Unterschrift</button><button type="button" data-action="sig-mode" data-mode="draw">Hier unterschreiben</button></div>` : ''}
      <div id="sig-stored"${mode === 'stored' ? '' : ' hidden'}>${stored ? `<img class="sig-img" src="${stored}" alt="Hinterlegte Unterschrift">` : ''}</div>
      <div id="sig-draw"${mode === 'draw' ? '' : ' hidden'}><div class="sig-wrap"><canvas id="sig-canvas"></canvas><span class="sig-line">Unterschrift</span></div>
        <button type="button" class="link" data-action="sig-clear">Unterschrift löschen</button></div>
      <label class="check strong"><input type="checkbox" id="sig-ok"> ${esc(confirm)}</label>
      ${note ? `<p class="muted small">${esc(note)}</p>` : ''}
    </div>
    <div class="modal-foot"><span class="grow"></span><button class="btn ghost" data-action="modal-close">Abbrechen</button>
      <button class="btn primary" id="sig-go" data-action="sign" data-mode="${mode}" disabled>${esc(button)}</button></div></div></div>`;
  pad_ = Media.signaturePad($('#sig-canvas'), signReady);
  $('#sig-ok').addEventListener('change', signReady);
}
function signReady() {
  const go = $('#sig-go');
  if (!go) return;
  go.disabled = !($('#sig-ok').checked && (go.dataset.mode === 'stored' || pad_?.hasInk()));
}
async function doSign() {
  const go = $('#sig-go');
  const sig = go.dataset.mode === 'stored' ? localStorage.getItem(SIG_KEY) : pad_.image();
  if (!sig || !signJob) return;
  const label = go.textContent;
  go.disabled = true; go.innerHTML = '<span class="spinner"></span> Wird übermittelt …';
  try { await signJob(sig); $('#modal-root').innerHTML = ''; render(); }
  catch (e) { toast(e.message, 8000); go.disabled = false; go.textContent = label; }
}
function signSubmit(d) {
  openSign({
    title: 'Unterschreiben und einreichen', d, confirm: 'Die Angaben sind vollständig und richtig.', button: 'Unterschreiben und einreichen',
    note: 'Nach dem Einreichen ist die Abrechnung gesperrt. Bitte die Originalbelege im Büro abgeben.',
    run: async sig => {
      const aenderungen = Calc.diff(d.vorher, inhalt(d)); // F-17: Abweichungen zum zuletzt eingereichten Stand
      const r = await Data.act('Einreichen', d, { pruefsumme: await pruefsumme(d), unterschrift: sig, bestaetigt: 'Die Angaben sind vollständig und richtig.', aenderungen });
      if (r.local) { toast(`Eingereicht als ${d.nr}.`); location.hash = '#/reise/' + d.id; }
      else { toast('Unterschrieben. Die Abrechnung wird jetzt übernommen – das dauert meist ein bis fünf Minuten.', 6000); location.hash = '#/'; }
    }
  });
}
// Unterschrift im Profil zeichnen
function openSigDraw() {
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" role="dialog">
    <div class="modal-head"><h2>Unterschrift hinterlegen</h2><button class="icon-btn" data-action="modal-close">${ic('x')}</button></div>
    <div class="modal-body"><div class="sig-wrap"><canvas id="sig-canvas"></canvas><span class="sig-line">Unterschrift</span></div>
      <button type="button" class="link" data-action="sig-clear">Unterschrift löschen</button></div>
    <div class="modal-foot"><span class="grow"></span><button class="btn ghost" data-action="modal-close">Abbrechen</button><button class="btn primary" data-action="sig-store">Übernehmen</button></div></div></div>`;
  pad_ = Media.signaturePad($('#sig-canvas'));
}

/* =====================================================================
   Ereignisse
   ===================================================================== */
let kopfTimer = null;
const current = () => { const [r, id] = route(); return r === 'reise' ? Data.draft(id) : null; };

const ACTIONS = {
  nav: el => { location.hash = el.dataset.to; },
  new: () => { const d = Data.newDraft(); location.hash = '#/reise/' + d.id; },
  sync: () => Data.cloud ? (Data.signedIn() ? Data.sync() : Data.login()) : null,
  login: () => Data.login(),
  logout: () => Data.logout(),
  'add-pos': () => { const d = current(); if (editable(d)) openPos(d); },
  'edit-pos': el => { const d = current(); if (d) openPos(d, d.positionen.find(p => p.id === el.dataset.id), !editable(d)); },
  'view-pos': el => { const [, id] = route(); const d = Data.draft(id) || Data.claim(id); if (d) openPos(d, d.positionen.find(p => p.id === el.dataset.id), true); },
  'pos-ka': el => {
    const p = UI.pos.p, ka = KA(el.dataset.key);
    p.kostenart = ka.key; p.ust = ka.ust; UI.pos.pickKa = false;
    if (ka.art === 'km') p.zahlungsart = 'privat';
    if (ka.art === 'bewirtung' && !p.bewirtung.ort) { const d = Data.draft(UI.pos.draftId); p.bewirtung.ort = d?.kopf.ort || ''; } // meist der Ort der Reise
    renderPos();
    setTimeout(() => $(ka.art === 'km' ? '[data-p="strecke"]' : '[data-p="brutto"]')?.focus(), 30);
  },
  'pos-ka-change': () => { UI.pos.pickKa = true; renderPos(); },
  'pos-pay': el => { UI.pos.p.zahlungsart = el.dataset.key; renderPos(); },
  'pos-save': savePos,
  'pos-cancel': () => { if (UI.pos && !UI.pos.ro) for (const id of UI.pos.added) Media.del(id).catch(() => {}); closePos(); },
  'pos-delete': () => {
    const s = UI.pos, d = Data.draft(s.draftId);
    if (!confirm('Diese Position löschen?')) return;
    const orig = d.positionen.find(p => p.id === s.p.id);
    d.positionen = d.positionen.filter(p => p.id !== s.p.id);
    dropFiles(d, [...(orig?.belege || []), ...s.p.belege.filter(b => s.added.includes(b.id))]);
    Data.touch(d); closePos(); render();
  },
  'ocr-run': () => { const s = UI.pos; if (s?.p.belege.length) runOcr(s.p.belege[s.p.belege.length - 1], true); },
  'bel-camera': () => $('#pick-camera').click(),
  'bel-file': () => $('#pick-file').click(),
  'bel-del': el => {
    const s = UI.pos, b = s.p.belege.find(x => x.id === el.dataset.id);
    s.p.belege = s.p.belege.filter(x => x !== b);
    if (s.added.includes(b.id)) { Media.del(b.id).catch(() => {}); s.added = s.added.filter(x => x !== b.id); } else s.removed.push(b);
    renderPos();
  },
  'bel-open': el => { const s = UI.pos; preview(s.p.belege.find(b => b.id === el.dataset.id), Data.draft(s.draftId) || Data.claim(s.draftId)); },
  'preview-close': closePreview,
  'del-draft': async () => { const d = current(); if (d && confirm('Diesen Entwurf mit allen Positionen und Belegen löschen?')) { await Data.removeDraft(d); location.hash = '#/'; } },
  submit: () => { const d = current(); if (editable(d)) startSubmit(d); },
  'modal-close': () => { $('#modal-root').innerHTML = ''; if (UI.pendingRender) render(); },
  'goto-err': el => {
    $('#modal-root').innerHTML = '';
    const d = current();
    if (el.dataset.pos) { openPos(d, d.positionen.find(p => p.id === el.dataset.pos)); return; }
    const inp = $(`[data-k="${el.dataset.key}"]`);
    if (inp) { inp.focus(); inp.scrollIntoView({ block: 'center' }); }
    else if (el.dataset.key === 'positionen') ACTIONS['add-pos']();
  },
  'sig-mode': el => {
    $$('.sig-mode button').forEach(b => b.classList.toggle('on', b === el));
    $('#sig-stored').hidden = el.dataset.mode !== 'stored'; $('#sig-draw').hidden = el.dataset.mode !== 'draw';
    $('#sig-go').dataset.mode = el.dataset.mode;
    if (el.dataset.mode === 'draw') pad_ = Media.signaturePad($('#sig-canvas'), signReady);
    signReady();
  },
  'sig-clear': () => { pad_?.clear(); signReady(); },
  sign: () => doSign(),
  'sig-draw': openSigDraw,
  'sig-store': () => {
    const img = pad_?.image();
    if (!img) return toast('Bitte zuerst im Feld unterschreiben.');
    localStorage.setItem(SIG_KEY, img); $('#modal-root').innerHTML = ''; render(); toast('Unterschrift hinterlegt.');
  },
  'sig-upload': () => $('#pick-signature').click(),
  'teams-package': () => Teams.download(),
  'sig-del': () => { if (confirm('Hinterlegte Unterschrift entfernen?')) { localStorage.removeItem(SIG_KEY); render(); } }
};
Object.assign(ACTIONS, Review.actions, Import.actions); // Prüfung, Freigabe, Verwaltung (review.js), Fahrtenimport (import.js)

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.p !== undefined && UI.pos) return posInput(el);
  if ((el.dataset.rv !== undefined || el.dataset.rf !== undefined) && el.type !== 'checkbox' && el.tagName !== 'SELECT') { if (el.dataset.rv !== 'datum') Review.onInput(el); return; }
  if (el.dataset.actionInput === 'ocr-toggle') { Ocr.setEnabled(el.checked); toast(el.checked ? 'Belegerkennung eingeschaltet.' : 'Belegerkennung ausgeschaltet.'); return; }
  if (el.dataset.dig && UI.pos) { const b = UI.pos.p.belege.find(x => x.id === el.dataset.dig); if (b) b.digital = el.checked; return; }
  if (el.dataset.actionInput === 'local-name') { Data.setLocalName(el.value); $('#user-name').textContent = el.value; return; }
  if (el.dataset.k) {
    const d = current();
    if (!editable(d)) return;
    const k = el.dataset.k;
    if (k === 'vorschuss') { const c = parseMoney(el.value); if (!Number.isNaN(c)) d.kopf.vorschuss = c; }
    else d.kopf[k] = el.value;
    if (k === 'zweck') $('#trip-title').textContent = el.value || 'Neue Reise';
    el.closest('.fld')?.classList.remove('err');
    $('#sums').innerHTML = sumsHTML(d);
    clearTimeout(kopfTimer);
    kopfTimer = setTimeout(() => Data.touch(d), 500);
  }
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.p !== undefined && UI.pos) {
    if (el.dataset.p === 'datum' || el.dataset.p === 'eigenbeleg') return;
    if (el.tagName === 'SELECT') return posInput(el);
  }
  if ((el.dataset.rv !== undefined && el.type === 'checkbox') || el.dataset.rf === 'status') return Review.onInput(el);
  if (el.dataset.proj) return Review.toggleProject(el);
  if (el.dataset.k === 'vorschuss') { const d = current(); if (d) el.value = moneyIn(d.kopf.vorschuss); }
  if (el.id === 'pick-camera' || el.id === 'pick-file') { const files = [...el.files]; el.value = ''; await addFiles(files); }
  if (el.id === 'pick-import') { const f = el.files[0]; el.value = ''; if (f) await Import.onFile(f); }
  if (el.id === 'pick-signature') {
    const f = el.files[0]; el.value = '';
    if (!f) return;
    try { localStorage.setItem(SIG_KEY, await Media.signatureFromFile(f)); render(); toast('Unterschrift hinterlegt.'); }
    catch (err) { toast(err.message, 6000); }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('.preview')) closePreview(); else if (UI.pos) ACTIONS['pos-cancel'](); else if ($('#modal-root').childElementCount) ACTIONS['modal-close'](); }
});
window.addEventListener('hashchange', () => { closePreview(); $('#modal-root').innerHTML = ''; UI.pos = null; window.scrollTo(0, 0); render(); });
window.addEventListener('beforeunload', () => { clearTimeout(kopfTimer); const d = current(); if (d && editable(d)) Data.persist(); });

/* ---------- Meldungen, Anmeldung ---------- */
let toastTimer = null;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function showLogin(teams, url) {
  if ($('#login-screen')) return;
  const d = document.createElement('div');
  d.id = 'login-screen';
  d.innerHTML = `<div class="login-card">
    <picture><source media="(prefers-color-scheme: dark)" srcset="icons/logo-quer-weiss.png"><img class="login-brand" src="icons/logo-quer-schwarz.png" alt="MH3 Ingenieure"></picture>
    <h1>Reisekosten</h1><p>Bitte mit Ihrem Microsoft-365-Firmenkonto anmelden.</p>
    <button class="btn primary" data-action="login">MIT MICROSOFT ANMELDEN</button>
    ${teams ? `<p class="muted" style="margin:14px 0 0">Klappt die Anmeldung in Teams nicht? <a href="${esc(url)}" target="_blank" rel="noopener">Im Browser öffnen</a></p>` : ''}</div>`;
  document.body.appendChild(d);
}

window.App = {
  ready: () => { UI.ready = true; render(); },
  renderSoft, toast, showLogin, hideLogin: () => $('#login-screen')?.remove()
};
// Kurzzugriff für Tests
window.RK = { validate, sums, pruefsumme, inhalt, parseMoney };

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
Data.init();

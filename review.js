'use strict';
/* =====================================================================
   Prüfung, Freigabe, Auszahlung, Storno und Rollen (Etappe B)
   Anforderungen: P-02 bis P-09, F-13, F-14, F-18, B-09, N-04
   Die Oberfläche bietet nur an, was die Rolle darf; durchgesetzt werden
   die Regeln im Flow (bzw. im Testbetrieb in Data.Flow).
   ===================================================================== */
const Review = (() => {
  const R = () => Data.roles();
  const me = () => (Data.user()?.mail || '').toLowerCase();
  const filt = { pruefung: { q: '', status: 'offen' }, freigabe: { q: '', status: 'offen' } };
  const OPEN = { pruefung: ['Eingereicht', 'Freigegeben'], freigabe: ['Geprüft'] };
  const STATI = ['Eingereicht', 'Geprüft', 'Freigegeben', 'Ausgezahlt', 'Zurückgewiesen', 'Storniert'];
  let reasonJob = null;
  const roleData = {};

  /* ---------- Listen (F-13, F-18) ---------- */
  function listView(kind) {
    const f = filt[kind], q = f.q.trim().toLowerCase();
    let list = Data.inbox().filter(c => (f.status === 'offen' ? OPEN[kind].includes(c.status) : f.status === 'alle' || c.status === f.status));
    if (q) list = list.filter(c => [c.nr, c.kopf.zweck, c.erstellerName, c.kopf.kostenstelle, c.kopf.ort].join(' ').toLowerCase().includes(q));
    const section = (title, items) => items.length ? `<h2 class="sec">${title}</h2><div class="trips">${items.map(c => tripCard(c, { who: true })).join('')}</div>` : '';
    let body;
    if (f.status === 'offen' && kind === 'pruefung') body = section('Zu prüfen', list.filter(c => c.status === 'Eingereicht')) + section('Freigegeben – Auszahlung erfassen', list.filter(c => c.status === 'Freigegeben'));
    else if (f.status === 'offen') body = section('Zur Freigabe', list);
    else body = section(`${list.length} Abrechnung${list.length === 1 ? '' : 'en'}`, list);
    return `<div class="page">
      ${localBanner()}
      <div class="page-head"><h1>${kind === 'pruefung' ? 'Kaufmännische Prüfung' : 'Finale Freigabe'}</h1></div>
      <div class="filters">
        <input type="search" data-rf="q" data-kind="${kind}" value="${esc(f.q)}" placeholder="Suchen: Nummer, Person, Reisezweck, Kostenstelle">
        <select data-rf="status" data-kind="${kind}">
          <option value="offen"${f.status === 'offen' ? ' selected' : ''}>Offene Vorgänge</option>
          <option value="alle"${f.status === 'alle' ? ' selected' : ''}>Alle</option>
          ${STATI.map(s => `<option value="${s}"${f.status === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      ${body || `<div class="empty"><p><b>${f.status === 'offen' ? 'Keine offenen Vorgänge.' : 'Keine Abrechnungen gefunden.'}</b></p></div>`}
    </div>`;
  }

  /* ---------- Einzelne Abrechnung ---------- */
  function claimView(c) {
    const r = R(), busy = Data.pendingFor(c).length > 0, st = c.status, valid = Data.valid(c);
    const can = {
      check: r.pruefung && st === 'Eingereicht' && valid && !busy,
      release: r.freigabe && st === 'Geprüft' && valid && !busy,
      pay: r.pruefung && st === 'Freigegeben' && valid && !busy,
      storno: r.freigabe && st === 'Freigegeben' && valid && !busy
    };
    const rv = Data.review(c.id);
    const back = UI.lastTab ? '#/' + UI.lastTab : '#/';
    const banners = [
      !valid ? `<div class="banner bad">${ic('warn')}<div><b>Status nicht bestätigt.</b> Diese Abrechnung ist nicht durch den Ablauf gesperrt; der angezeigte Status ist ungültig. Bitte den Administrator informieren.</div></div>` : '',
      busy ? `<div class="banner wait">${ic('clock')}<div><b>Wird verarbeitet.</b> Ihr Auftrag ist übermittelt; das Ergebnis erscheint meist nach ein bis fünf Minuten.</div></div>` : '',
      ...Data.notes(c.id).slice(0, 3).map(n => `<div class="banner bad">${ic('warn')}<div>${esc(n.text)} <span class="muted small">(${fmtTs(n.zeit)})</span></div></div>`),
      st === 'Storniert' ? `<div class="banner bad">${ic('warn')}<div><b>Storniert:</b> ${esc(c.storno)}</div></div>` : '',
      st === 'Zurückgewiesen' ? `<div class="banner bad">${ic('warn')}<div><b>Zurückgewiesen:</b> ${esc(c.rueckweisung)}</div></div>` : ''
    ].join('');
    const rows = c.positionen.map((p, i) => (can.check ? reviewRow(c, p, i, rv) : posRow(c, p, i, false, true))).join('');
    return `<div class="page narrow">
      <div class="page-head"><a class="back" href="${back}">${ic('back')} Zurück</a></div>
      <div class="page-head"><h1>${esc(c.kopf.zweck)}</h1>${chip(valid ? st : 'Status ungültig')}</div>
      <p class="muted">${esc(c.nr)} · ${esc(c.erstellerName)} · eingereicht am ${c.eingereicht ? fmtTs(c.eingereicht) : '–'}${c.freigabedatum ? ' · freigegeben am ' + fmtTs(c.freigabedatum) : ''}${c.auszahlungsdatum ? ' · ausgezahlt am ' + fmtDate(c.auszahlungsdatum) : ''}</p>
      ${banners}<div id="sum-warn"></div>
      <div class="card"><div class="card-head">${isAuslage(c) ? 'Auslage' : 'Reise'}</div><div class="card-body">${readHead(c)}</div></div>
      <div class="card"><div class="card-head">Kostenpositionen${can.check ? '<span class="grow"></span><span class="muted small">Jede Position prüfen und abhaken (B-09)</span>' : ''}</div><div class="pos-list">${rows}</div></div>
      <div class="card"><div class="card-head">Summen</div><div class="card-body">${sumsHTML(c)}</div></div>
      ${can.check ? checkPanel(c, rv) : ''}
      ${can.release ? releasePanel(c) : ''}
      ${can.pay || can.storno ? payPanel(c, can) : ''}
      ${['Geprüft', 'Freigegeben', 'Ausgezahlt', 'Storniert'].includes(st) ? `<div class="card"><div class="card-head">Prüfvermerk</div><div class="card-body">
        <p style="margin:0">${c.originale ? `${ic('check')} <b>Alle Belege liegen im Original vor.</b>` : `${ic('warn')} Originalbelege nicht bestätigt`}<br>
        <span class="muted">Ablageort der Originale: ${esc(c.ablageort || '–')}</span></p></div></div>` : ''}
      <div class="card"><div class="card-head">Signaturen</div><div class="card-body">${sigList(c)}</div></div>
      ${r.pruefung || r.freigabe ? `<div class="card"><div class="card-head">Änderungsprotokoll</div><div class="card-body" id="proto"><span class="muted">lädt …</span></div></div>` : ''}
    </div>`;
  }
  function reviewRow(c, p, i, rv) {
    const v = rv.vermerke[p.id] || {};
    return `<div class="rv-row${v.geprueft ? ' ok' : ''}">${posRow(c, p, i, false, true)}
      <div class="rv-bar"><label class="check"><input type="checkbox" data-rv="geprueft" data-pos="${esc(p.id)}"${v.geprueft ? ' checked' : ''}> geprüft</label>
        <input class="rv-note" data-rv="kommentar" data-pos="${esc(p.id)}" value="${esc(v.kommentar || '')}" placeholder="Auffälligkeit oder Kommentar (optional)"></div></div>`;
  }
  const allChecked = (c, rv) => c.positionen.length > 0 && c.positionen.every(p => rv.vermerke[p.id]?.geprueft);
  function checkPanel(c, rv) {
    const n = c.positionen.filter(p => rv.vermerke[p.id]?.geprueft).length, all = allChecked(c, rv);
    const belege = c.positionen.flatMap(p => p.belege), dig = belege.filter(b => b.digital).length, papier = belege.length - dig;
    return `<div class="card panel"><div class="card-head">${ic('shield')} Kaufmännische Prüfung</div><div class="card-body">
      <p style="margin-top:0" id="rv-count">${n} von ${c.positionen.length} Positionen geprüft.</p>
      <p class="muted small">${papier} Papierbeleg${papier === 1 ? '' : 'e'} im Original erwartet${dig ? `; ${dig} Beleg${dig === 1 ? ' ist ein digitales' : 'e sind digitale'} Original${dig === 1 ? '' : 'e'} (liegen in der App, kein Papier)` : ''}.</p>
      <label class="fld"><span>Ablageort der Originalbelege (Ordner, Fach) – Pflichtfeld</span><input data-rv="ablageort" value="${esc(rv.ablageort || '')}" placeholder="z. B. Ordner Reisekosten 2026, Fach 3"></label>
      <label class="check strong"><input type="checkbox" data-rv="originale"${all ? '' : ' disabled'}${all && rv.originale ? ' checked' : ''}> Alle Belege liegen im Original vor (Papierbelege im Büro, digitale Originale in der App).</label>
      ${all ? '' : '<p class="muted small">Das Häkchen lässt sich setzen, sobald jede Position als geprüft markiert ist (P-02).</p>'}
      <p class="muted small">Ist ein Betrag zu korrigieren, bitte mit Begründung zurückweisen; der Ersteller korrigiert und unterschreibt neu (P-06).</p>
      <div class="actions"><button class="btn danger-ghost" data-action="rv-reject">Zurückweisen</button><span class="grow"></span>
        <button class="btn primary" id="rv-go" data-action="rv-check"${ready(c, rv) ? '' : ' disabled'}>${ic('pen')} Prüfung abschließen und unterschreiben</button></div>
    </div></div>`;
  }
  const ready = (c, rv) => allChecked(c, rv) && rv.originale && String(rv.ablageort || '').trim().length > 0;
  function releasePanel(c) {
    const pruefer = c.signaturen.find(s => s.rolle === 'Kaufmännische Prüfung');
    const block = !c.originale ? 'Freigabe gesperrt: Die Prüfung hat nicht bestätigt, dass alle Originalbelege vorliegen.'
      : c.pruefer && c.pruefer === me() ? 'Vier-Augen-Prinzip: Sie haben diese Abrechnung selbst geprüft und dürfen sie nicht freigeben.' : '';
    return `<div class="card panel"><div class="card-head">${ic('check')} Finale Freigabe</div><div class="card-body">
      <p style="margin-top:0">Geprüft von <b>${esc(pruefer?.name || c.pruefer || '–')}</b>${pruefer ? ' am ' + fmtTs(Date.parse(pruefer.zeit)) : ''}.</p>
      ${block ? `<div class="banner bad">${ic('lock')}<div>${esc(block)}</div></div>` : ''}
      <div class="actions"><button class="btn danger-ghost" data-action="rv-reject">Zurückweisen</button><span class="grow"></span>
        <button class="btn primary" data-action="rv-release"${block ? ' disabled' : ''}>${ic('pen')} Freigeben und unterschreiben</button></div>
    </div></div>`;
  }
  function payPanel(c, can) {
    return `<div class="card panel"><div class="card-head">Auszahlung</div><div class="card-body">
      ${can.pay ? `<div class="row" style="align-items:flex-end;margin-top:0"><label class="fld" style="margin:0"><span>Auszahlungsdatum</span><input type="date" data-rv="datum" value="${todayStr()}"></label>
        <button class="btn primary" data-action="rv-pay">Auszahlung erfassen</button></div>` : '<p class="muted" style="margin-top:0">Die Auszahlung erfasst die kaufmännische Prüfung.</p>'}
      ${can.storno ? `<div class="actions"><span class="grow"></span><button class="btn danger-ghost" data-action="rv-storno">Stornieren …</button></div>` : ''}
    </div></div>`;
  }
  function sigList(c) {
    if (!c.signaturen.length) return '<p class="muted" style="margin:0">Keine gültigen Signaturen.</p>';
    return c.signaturen.map(s => `<div class="sig-row"><img src="${s.bild}" alt="Unterschrift ${esc(s.name)}"><div><b>${esc(s.rolle)}: ${esc(s.name)}</b><br>
      <span class="muted">${fmtTs(Date.parse(s.zeit))} · Prüfsumme ${esc(String(s.pruefsumme).slice(0, 16))}…</span><br><span class="chk" data-sum="${esc(s.pruefsumme)}">wird geprüft …</span></div></div>`).join('');
  }

  // P-04: Prüfsumme bei jeder Anzeige nachrechnen; Protokoll nachladen
  async function after(c) {
    const now = await Calc.pruefsumme(c);
    for (const el of $$('.chk')) {
      const ok = el.dataset.sum === now;
      el.className = 'chk ' + (ok ? 'ok' : 'bad');
      el.innerHTML = ok ? `${ic('check')} Inhalt unverändert seit der Unterschrift` : `${ic('warn')} Inhalt weicht vom unterschriebenen Stand ab`;
    }
    if (c.pruefsumme && now !== c.pruefsumme && $('#sum-warn')) $('#sum-warn').innerHTML = `<div class="banner bad">${ic('warn')}<div><b>Achtung:</b> Der Inhalt weicht vom eingereichten Stand ab. Nicht prüfen oder freigeben; Administrator informieren.</div></div>`;
    const box = $('#proto');
    if (!box) return;
    try {
      const list = await Data.protokoll(c);
      if (!$('#proto')) return;
      $('#proto').innerHTML = list.length ? `<table class="proto">${list.map(e => `<tr><td>${fmtTs(e.zeit)}</td><td>${esc(e.person)}</td><td>${esc(e.text || e.aktion)}</td></tr>`).join('')}</table>` : '<span class="muted">Keine Einträge.</span>';
    } catch (e) { if ($('#proto')) $('#proto').innerHTML = `<span class="muted">Protokoll nicht verfügbar: ${esc(e.message)}</span>`; }
  }

  /* ---------- Eingaben ---------- */
  const current = () => { const [r, id] = route(); return r === 'reise' ? Data.claim(id) : null; };
  function onInput(el) {
    const c = current();
    if (el.dataset.rf) { // Filter der Listen
      filt[el.dataset.kind][el.dataset.rf] = el.value;
      if (el.dataset.rf === 'status') render();
      else { clearTimeout(onInput.t); onInput.t = setTimeout(() => { const pos = el.selectionStart; render(); const n = $('[data-rf="q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); }
      return true;
    }
    if (!c) return true;
    const rv = Data.review(c.id), k = el.dataset.rv;
    if (k === 'geprueft') { (rv.vermerke[el.dataset.pos] = rv.vermerke[el.dataset.pos] || {}).geprueft = el.checked; if (!allChecked(c, rv)) rv.originale = false; Data.persist(); render(); return true; }
    if (k === 'kommentar') { (rv.vermerke[el.dataset.pos] = rv.vermerke[el.dataset.pos] || {}).kommentar = el.value; Data.persist(); return true; }
    if (k === 'originale') { rv.originale = el.checked && allChecked(c, rv); Data.persist(); }
    if (k === 'ablageort') { rv.ablageort = el.value; Data.persist(); }
    const go = $('#rv-go');
    if (go) go.disabled = !ready(c, rv);
    return true;
  }

  /* ---------- Begründung abfragen ---------- */
  function openReason({ title, label, button, run }) {
    reasonJob = run;
    $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-action="modal-close">${ic('x')}</button></div>
      <div class="modal-body"><label class="fld"><span>${esc(label)}</span><textarea id="reason" rows="4"></textarea></label></div>
      <div class="modal-foot"><span class="grow"></span><button class="btn ghost" data-action="modal-close">Abbrechen</button>
        <button class="btn primary" id="reason-go" data-action="reason-ok" disabled>${esc(button)}</button></div></div></div>`;
    const t = $('#reason');
    t.addEventListener('input', () => { $('#reason-go').disabled = !t.value.trim(); });
    setTimeout(() => t.focus(), 30);
  }
  function done(r, msg) {
    if (r?.local) toast(msg);
    else toast('Auftrag übermittelt. Das Ergebnis erscheint meist nach ein bis fünf Minuten; die nächste Person wird per Teams und E-Mail benachrichtigt.', 7000);
  }

  const actions = {
    'rv-check': () => {
      const c = current(), rv = Data.review(c.id);
      if (!ready(c, rv)) return;
      openSign({
        title: 'Prüfung abschließen', d: c, button: 'Prüfen und unterschreiben',
        confirm: 'Ich habe die Abrechnung geprüft. Alle Belege liegen im Original vor.',
        extra: `<p class="muted" style="margin-top:0">Ablageort der Originale: <b>${esc(rv.ablageort)}</b></p>`,
        run: async sig => {
          const r = await Data.act('Pruefen', c, { pruefsumme: await Calc.pruefsumme(c), unterschrift: sig, originale: true, ablageort: rv.ablageort.trim(), vermerke: rv.vermerke });
          Data.clearReview(c.id); done(r, 'Geprüft. Die Abrechnung liegt jetzt bei der Freigabe.');
        }
      });
    },
    'rv-reject': () => {
      const c = current(), rv = Data.review(c.id);
      openReason({
        title: 'Zurückweisen', label: 'Begründung (Pflicht) – der Ersteller sieht sie zusammen mit Ihren Kommentaren zu den Positionen', button: 'Zurückweisen',
        run: async grund => {
          const vermerke = c.status === 'Eingereicht' ? rv.vermerke : c.pruefung;
          const r = await Data.act('Zurueckweisen', c, { grund, vermerke });
          Data.clearReview(c.id); done(r, 'Zurückgewiesen. Der Ersteller kann die Abrechnung korrigieren und neu einreichen.');
        }
      });
    },
    'rv-release': () => {
      const c = current();
      openSign({
        title: 'Final freigeben', d: c, button: 'Freigeben und unterschreiben', confirm: 'Ich gebe die Abrechnung zur Auszahlung frei.',
        run: async sig => done(await Data.act('Freigeben', c, { pruefsumme: await Calc.pruefsumme(c), unterschrift: sig }), 'Freigegeben.')
      });
    },
    'rv-pay': async () => {
      const c = current(), datum = $('[data-rv="datum"]')?.value;
      if (!datum) return toast('Bitte das Auszahlungsdatum eintragen.');
      try { done(await Data.act('Auszahlen', c, { datum }), 'Auszahlung erfasst.'); render(); } catch (e) { toast(e.message, 8000); }
    },
    'rv-storno': () => {
      const c = current();
      openReason({
        title: 'Abrechnung stornieren', label: 'Begründung (Pflicht). Der Ursprungsstand bleibt erhalten und lesbar (P-08).', button: 'Stornieren',
        run: async grund => done(await Data.act('Stornieren', c, { grund }), 'Storniert.')
      });
    },
    'reason-ok': async () => {
      const t = $('#reason'), go = $('#reason-go');
      if (!t.value.trim() || !reasonJob) return;
      go.disabled = true; go.innerHTML = '<span class="spinner"></span> Wird übermittelt …';
      try { await reasonJob(t.value.trim()); $('#modal-root').innerHTML = ''; render(); }
      catch (e) { toast(e.message, 8000); go.disabled = false; go.textContent = 'Erneut versuchen'; }
    },
    'proj-add': async el => {
      const inp = $('#proj-in');
      el.disabled = true;
      try { await Data.addProject(inp.value); inp.value = ''; toast('Projekt hinzugefügt.'); await loadProjects(); }
      catch (e) { toast(e.message, 8000); }
      finally { el.disabled = false; }
    },
    'role-add': async el => {
      const key = el.dataset.key, inp = $('#role-in-' + key);
      el.disabled = true;
      try { await Data.addMember(key, inp.value); inp.value = ''; toast('Hinzugefügt.'); await loadRoles(key); }
      catch (e) { toast(e.message, 8000); }
      finally { el.disabled = false; }
    },
    'role-del': async el => {
      const key = el.dataset.key, u = (roleData[key]?.list || []).find(x => String(x.id) === el.dataset.id);
      if (!u || !confirm(`${u.name} aus „${ROLES[key].title}“ entfernen?`)) return;
      try { await Data.removeMember(key, u.id); await loadRoles(key); } catch (e) { toast(e.message, 8000); }
    }
  };

  /* ---------- Rollen (nur Administratoren, Pflichtenheft Abschnitt 2) ---------- */
  const ROLES = {
    pruefung: { title: 'Kaufmännische Prüfung', group: 'RK Pruefung', text: 'Prüft eingereichte Abrechnungen, bestätigt die Originalbelege und erfasst die Auszahlung.' },
    freigabe: { title: 'Finale Freigabe', group: 'RK Freigabe', text: 'Gibt geprüfte Abrechnungen frei oder storniert sie (Geschäftsführung).' },
    besucher: { title: 'Mitarbeiter mit Zugang', group: 'Besucher der Website', text: 'Alle, die Reisekosten abrechnen. Wer eine der Rollen oben erhält, wird hier automatisch mit eingetragen.' }
  };
  function rolesView() {
    if (!R().admin) return `<div class="page narrow"><div class="page-head"><h1>Verwaltung</h1></div><div class="card"><div class="card-body">Nur Administratoren (Besitzer der SharePoint-Website) verwalten Rollen und Projekte.</div></div></div>`;
    return `<div class="page narrow">
      <div class="page-head"><h1>Verwaltung</h1></div>
      <div class="card"><div class="card-head">Projekte und Kostenstellen</div><div class="card-body">
        <p class="muted" style="margin-top:0">Auswahlliste für Reisen, Positionen und die Excel-Vorlage der Fahrten. Nicht mehr benötigte Projekte bitte deaktivieren statt löschen – bestehende Abrechnungen behalten ihren Projektnamen.</p>
        <div id="proj-list">${projectsHTML()}</div>
        <div class="row"><input class="role-in" id="proj-in" placeholder="Neues Projekt, z. B. 26-014 Uniper Besucherzentrum WHV">
          <button class="btn primary small" data-action="proj-add">Hinzufügen</button></div></div></div>
      ${Data.cloud ? `<h2 class="sec">Rollen</h2>
      <p class="page-hint muted">Die Rollen sind Gruppen der SharePoint-Website „Reisekosten“. Der Flow prüft bei jedem Auftrag, ob die Person in der passenden Gruppe ist. Vier-Augen-Prinzip: Wer prüft, sollte nicht zugleich freigeben.</p>
      ${Object.keys(ROLES).map(k => `<div class="card"><div class="card-head">${esc(ROLES[k].title)} <span class="muted small">(${esc(ROLES[k].group)})</span></div>
        <div class="card-body"><p class="muted" style="margin-top:0">${esc(ROLES[k].text)}</p><div id="role-${k}">${membersHTML(k)}</div>
        <div class="row"><input class="role-in" id="role-in-${k}" type="email" placeholder="E-Mail-Adresse, z. B. k.johannsen@mh3-ingenieure.de">
          <button class="btn primary small" data-action="role-add" data-key="${k}">Hinzufügen</button></div></div></div>`).join('')}
      ${overlapHTML()}` : '<p class="muted">Im lokalen Testbetrieb haben Sie alle Rollen; die Rollenverwaltung steht mit Microsoft-365-Anbindung zur Verfügung.</p>'}
    </div>`;
  }
  let projData = { status: 'loading', list: [] };
  function projectsHTML() {
    if (projData.status === 'loading') return '<span class="muted">lädt …</span>';
    if (projData.status === 'error') return `<span class="muted">Fehler: ${esc(projData.error)}</span>`;
    if (!projData.list.length) return '<span class="muted">Noch keine Projekte eingetragen.</span>';
    const list = [...projData.list].sort((a, b) => (b.aktiv - a.aktiv) || a.name.localeCompare(b.name, 'de'));
    return `<ul class="members">${list.map(p => `<li${p.aktiv ? '' : ' class="off"'}><span><b>${esc(p.name)}</b>${p.aktiv ? '' : ' <span class="muted small">(deaktiviert)</span>'}</span>
      <label class="check" style="margin:0"><input type="checkbox" data-proj="${esc(String(p.id))}"${p.aktiv ? ' checked' : ''}> aktiv</label></li>`).join('')}</ul>`;
  }
  async function loadProjects() {
    try { projData = { status: 'ok', list: await Data.projects() }; }
    catch (e) { projData = { status: 'error', list: [], error: e.message }; }
    const box = $('#proj-list');
    if (box) box.innerHTML = projectsHTML();
  }
  async function toggleProject(el) {
    const p = projData.list.find(x => String(x.id) === el.dataset.proj);
    if (!p) return;
    try { await Data.setProject(p.id, el.checked); await loadProjects(); }
    catch (e) { toast(e.message, 8000); el.checked = !el.checked; }
  }
  function membersHTML(k) {
    const d = roleData[k];
    if (!d || d.status === 'loading') return '<span class="muted">lädt …</span>';
    if (d.status === 'error') return `<span class="muted">Fehler: ${esc(d.error)}</span>`;
    if (!d.list.length) return '<span class="muted">Noch niemand eingetragen.</span>';
    return `<ul class="members">${d.list.map(u => `<li><span><b>${esc(u.name)}</b> <span class="muted">${esc(u.mail)}</span></span>
      <button class="icon-btn" data-action="role-del" data-key="${k}" data-id="${u.id}" aria-label="Entfernen">${ic('trash')}</button></li>`).join('')}</ul>`;
  }
  function overlapHTML() {
    const a = roleData.pruefung?.list || [], b = roleData.freigabe?.list || [];
    const both = a.filter(x => b.some(y => y.id === x.id));
    return both.length ? `<div class="banner bad">${ic('warn')}<div>In beiden Rollen: <b>${esc(both.map(x => x.name).join(', '))}</b>. Die App verhindert trotzdem, dass dieselbe Person eine Abrechnung prüft und freigibt.</div></div>` : '';
  }
  async function loadRoles(only) {
    if (!only && R().admin) loadProjects();
    if (!Data.cloud || !R().admin) return;
    for (const k of only ? [only] : Object.keys(ROLES)) {
      roleData[k] = { status: 'loading', list: roleData[k]?.list || [] };
      try { roleData[k] = { status: 'ok', list: await Data.members(k) }; }
      catch (e) { roleData[k] = { status: 'error', list: [], error: e.message }; }
      const box = $('#role-' + k);
      if (box) box.innerHTML = membersHTML(k);
    }
  }

  return { listView, claimView, after, onInput, actions, rolesView, loadRoles, toggleProject };
})();

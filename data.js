'use strict';
/* =====================================================================
   Datenhaltung
   - Ohne config.js: lokaler Testbetrieb, alles bleibt auf dem Gerät; die
     Flows werden mit denselben Regeln nachgebildet (Flow.run).
   - Mit config.js: Anmeldung mit dem Firmenkonto (Entra ID, MSAL) und
     Abgleich mit der SharePoint-Website „Reisekosten“ (SharePoint-REST).

   Eine Abrechnung ist genau ein Eintrag in RK_Abrechnungen. Solange sie
   Entwurf ist, schreibt der Ersteller selbst (jeder sieht nur eigene
   Einträge, Belege hängen als Anlagen daran). Jede weitere Änderung läuft
   über einen Auftrag in RK_Aktionen, den der Power-Automate-Flow prüft und
   ausführt; beim Einreichen sperrt der Flow den Eintrag für den Ersteller.
   ===================================================================== */
const Data = (() => {
  const cfg = window.APP_CONFIG || {};
  const cloud = !!(cfg.tenantId && cfg.clientId && cfg.siteUrl);
  const KEY = 'reisekosten.v1';
  const SCHEMA = 2; // erhöhen, wenn Listen neue Spalten bekommen

  /* ---------- Stammdaten (Vorbelegung, im Betrieb aus SharePoint) ---------- */
  const KOSTENARTEN = [
    { key: 'bahn', name: 'Bahn', ust: 7 },
    { key: 'flug', name: 'Flug', ust: 19 },
    { key: 'taxi', name: 'Taxi und ÖPNV', ust: 7 },
    { key: 'mietwagen', name: 'Mietwagen', ust: 19 },
    { key: 'kraftstoff', name: 'Kraftstoff', ust: 19 },
    { key: 'parken', name: 'Parken und Maut', ust: 19 },
    { key: 'hotel', name: 'Hotel', ust: 7 },
    { key: 'bewirtung', name: 'Bewirtung', ust: 19, art: 'bewirtung' },
    { key: 'pkw', name: 'Privat-Pkw (Kilometer)', ust: 0, art: 'km' },
    { key: 'sonstiges', name: 'Sonstiges', ust: 19 }
  ];
  const SAETZE = [{ art: 'km', wert: 30, ab: '2000-01-01' }]; // Cent je km, Stand vor Inbetriebnahme prüfen (F-05)
  // Status, in denen der Ersteller den Eintrag selbst schreiben darf
  const EDITABLE = new Set(['Entwurf', 'Zurückgewiesen', 'Wird eingereicht']);

  function fresh() {
    return {
      user: null, roles: { pruefung: false, freigabe: false, admin: false },
      drafts: [], claims: [], inbox: [], pending: [], notes: [], trash: [], review: {}, seq: {},
      master: { kostenarten: KOSTENARTEN.map((k, i) => ({ ...k, order: i })), saetze: SAETZE.slice(), kostenstellen: [] },
      sync: { spUserId: null, ent: {}, last: 0, schema: 0 }
    };
  }
  let S = load();
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d) { const s = Object.assign(fresh(), d); if (!cloud) s.roles = { pruefung: true, freigabe: true, admin: true }; return s; }
    } catch (e) { console.warn('Laden fehlgeschlagen', e); }
    const s = fresh();
    if (!cloud) s.roles = { pruefung: true, freigabe: true, admin: true }; // Testbetrieb: alle Rollen
    return s;
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { App.toast('Speichern auf dem Gerät fehlgeschlagen: ' + e.message); }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clone = o => JSON.parse(JSON.stringify(o));
  const actor = () => ({ name: S.user?.name || '', mail: (S.user?.mail || '').toLowerCase(), roles: S.roles });

  /* ---------- Entwürfe ---------- */
  function newDraft() {
    const d = {
      id: uid(), spId: null, status: 'Entwurf', created: Date.now(), updated: Date.now(), dirty: true, removed: [],
      kopf: { zweck: '', kostenstelle: '', ort: '', land: 'Deutschland', beginn: '', ende: '', vorschuss: 0 },
      positionen: []
    };
    S.drafts.unshift(d); persist(); changed();
    return d;
  }
  const draft = id => S.drafts.find(d => d.id === id);
  function touch(d) { d.updated = Date.now(); d.dirty = true; persist(); changed(); }
  async function removeDraft(d) {
    S.drafts = S.drafts.filter(x => x !== d);
    if (d.spId) S.trash.push(d.spId);
    for (const p of d.positionen) for (const b of p.belege) Media.del(b.id).catch(() => {});
    persist(); changed();
  }
  // Datei eines Belegs: aus dem Gerät oder aus der Anlage in SharePoint
  async function fileOf(d, b) {
    const local = await Media.get(b.id).catch(() => null);
    if (local) return local;
    if (!cloud || !d.spId || !b.uploaded) return null;
    const blob = await sp(`${L('RK_Abrechnungen')}/items(${d.spId})/AttachmentFiles('${encodeURIComponent(b.datei)}')/$value`, { binary: true });
    await Media.put(b.id, blob).catch(() => {});
    if (!b.thumb && /^image\//.test(b.type)) { b.thumb = await Media.thumbOf(blob); persist(); }
    return blob;
  }

  /* ---------- Abrechnungen (eingereicht) ---------- */
  const claim = id => S.claims.find(c => c.id === id) || S.inbox.find(c => c.id === id);
  // Ein Status jenseits des Entwurfs gilt nur, wenn der Flow den Eintrag gesperrt hat (eigene Rechte).
  // So kann niemand einen Status in seinem eigenen Entwurf selbst eintragen.
  const valid = c => EDITABLE.has(c.status) || !!c.locked;
  const pendingFor = c => S.pending.filter(p => p.itemId === c.id);

  /* =====================================================================
     Aufträge an den Flow (Pflichtenheft Abschnitt 7)
     Einreichen, Pruefen, Zurueckweisen, Freigeben, Auszahlen, Stornieren
     ===================================================================== */
  async function act(aktion, item, daten) {
    daten = { ...daten, zeit: new Date().toISOString(), version: APP_VERSION };
    if (!cloud) {
      const r = Flow.run(aktion, item, daten, actor());
      if (!r.ok) throw new Error(r.grund);
      arrangeLocal(); persist();
      return { local: true, item };
    }
    if (aktion === 'Einreichen') return submitCloud(item, daten);
    const it = await createItem('RK_Aktionen', {
      Title: `${aktion} ${item.nr || ''}`.trim(), Aktion: aktion, Bezug: item.nr || item.id, AbrechnungId: item.spId,
      Daten: JSON.stringify(daten), Ergebnis: 'offen'
    });
    S.pending.push({ id: it.Id, itemId: item.id, aktion, zeit: daten.zeit });
    persist(); fastPoll();
    return { pending: true };
  }
  async function submitCloud(d, daten) {
    const before = d.status, hinweis = d.hinweis, vorher = d.vorher;
    d.status = 'Wird eingereicht'; d.hinweis = ''; d.vorher = null; touch(d); // Vergleichsstand wird mit dem Einreichen verbraucht
    try {
      await syncNow();
      if (d.dirty || !d.spId || d.positionen.some(p => p.belege.some(b => !b.uploaded))) throw new Error('Der Entwurf konnte nicht vollständig nach SharePoint übertragen werden. Bitte Verbindung prüfen und erneut einreichen.');
      const it = await createItem('RK_Aktionen', {
        Title: 'Einreichen ' + (d.kopf.zweck || '').slice(0, 200), Aktion: 'Einreichen', Bezug: d.nr || d.id, AbrechnungId: d.spId,
        Daten: JSON.stringify(daten), Ergebnis: 'offen'
      });
      S.pending.push({ id: it.Id, itemId: d.id, aktion: 'Einreichen', zeit: daten.zeit });
      persist(); fastPoll();
      return { pending: true };
    } catch (e) {
      d.status = before; d.hinweis = hinweis; d.vorher = vorher; touch(d);
      throw e;
    }
  }

  /* ---------- Nachbildung der Flows (Testbetrieb) – dieselben Regeln baut der Power-Automate-Flow nach ---------- */
  const Flow = {
    run(aktion, it, d, a) {
      const fail = grund => ({ ok: false, grund });
      const now = d.zeit || new Date().toISOString();
      const log = text => (it.protokoll = it.protokoll || []).push({ zeit: now, person: a.name, aktion, text });
      const sig = rolle => ({ rolle, name: a.name, mail: a.mail, zeit: now, pruefsumme: d.pruefsumme, bild: d.unterschrift, stand: it.stand });
      const R = a.roles;
      switch (aktion) {
        case 'Einreichen': {
          if (it.erstellerMail && it.erstellerMail !== a.mail) return fail('Nur der Ersteller kann die Abrechnung einreichen.');
          if (!EDITABLE.has(it.status)) return fail('Die Abrechnung ist bereits eingereicht.');
          if (!d.pruefsumme || !d.unterschrift) return fail('Unterschrift oder Prüfsumme fehlt.');
          const erneut = (it.stand || 0) > 0;
          it.stand = (it.stand || 0) + 1;
          if (!it.nr) { const y = new Date().getFullYear(); S.seq[y] = (S.seq[y] || 0) + 1; it.nr = `RK-${y}-${String(S.seq[y]).padStart(4, '0')}`; }
          Object.assign(it, {
            status: 'Eingereicht', pruefsumme: d.pruefsumme, pruefung: {}, originale: false, ablageort: '', pruefer: '', rueckweisung: '', hinweis: '',
            eingereicht: now, erstellerName: a.name, erstellerMail: a.mail, locked: true, vorher: null
          });
          it.signaturen = [sig('Ersteller')];
          log(erneut ? 'Erneut eingereicht' + (d.aenderungen ? '. Änderungen: ' + d.aenderungen : '') : 'Eingereicht');
          return { ok: true };
        }
        case 'Pruefen': {
          if (!R.pruefung) return fail('Nur die kaufmännische Prüfung darf prüfen.');
          if (it.status !== 'Eingereicht' || !it.locked) return fail('Die Abrechnung wartet nicht auf die Prüfung.');
          if (d.pruefsumme !== it.pruefsumme) return fail('Der Inhalt weicht vom eingereichten Stand ab.');
          if (d.originale !== true) return fail('Das Häkchen „Alle Belege liegen im Original vor“ fehlt.');
          if (!String(d.ablageort || '').trim()) return fail('Der Ablageort der Originale fehlt.');
          const v = d.vermerke || {};
          if (!it.positionen.every(p => v[p.id]?.geprueft === true)) return fail('Nicht alle Positionen sind als geprüft markiert.');
          Object.assign(it, { status: 'Geprüft', pruefung: v, originale: true, ablageort: d.ablageort.trim(), pruefer: a.mail });
          it.signaturen.push(sig('Kaufmännische Prüfung'));
          log(`Geprüft, Originalbelege bestätigt, Ablage: ${it.ablageort}`);
          return { ok: true };
        }
        case 'Zurueckweisen': {
          const darf = (R.pruefung && it.status === 'Eingereicht') || (R.freigabe && it.status === 'Geprüft');
          if (!darf || !it.locked) return fail('Zurückweisen ist in diesem Status für Sie nicht möglich.');
          if (!String(d.grund || '').trim()) return fail('Die Begründung fehlt.');
          Object.assign(it, { status: 'Zurückgewiesen', rueckweisung: d.grund.trim(), pruefung: d.vermerke || it.pruefung || {}, originale: false, signaturen: [], locked: false });
          log('Zurückgewiesen: ' + it.rueckweisung);
          return { ok: true };
        }
        case 'Freigeben': {
          if (!R.freigabe) return fail('Nur die finale Freigabe darf freigeben.');
          if (it.status !== 'Geprüft' || !it.locked) return fail('Die Abrechnung ist nicht geprüft.');
          if (it.originale !== true) return fail('Freigabe gesperrt: Die Prüfung hat nicht bestätigt, dass alle Originalbelege vorliegen.');
          if (it.pruefer && it.pruefer === a.mail) return fail('Vier-Augen-Prinzip: Wer geprüft hat, darf nicht auch freigeben.');
          if (d.pruefsumme !== it.pruefsumme) return fail('Der Inhalt weicht vom eingereichten Stand ab.');
          Object.assign(it, { status: 'Freigegeben', freigabedatum: now });
          it.signaturen.push(sig('Finale Freigabe'));
          log('Freigegeben');
          return { ok: true };
        }
        case 'Auszahlen': {
          if (!R.pruefung) return fail('Nur die kaufmännische Prüfung erfasst die Auszahlung.');
          if (it.status !== 'Freigegeben') return fail('Die Abrechnung ist nicht freigegeben.');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d.datum || '')) return fail('Das Auszahlungsdatum fehlt.');
          Object.assign(it, { status: 'Ausgezahlt', auszahlungsdatum: d.datum });
          log('Auszahlung erfasst am ' + d.datum.split('-').reverse().join('.'));
          return { ok: true };
        }
        case 'Stornieren': {
          if (!R.freigabe) return fail('Nur die finale Freigabe darf stornieren.');
          if (it.status !== 'Freigegeben') return fail('Nur freigegebene Abrechnungen lassen sich stornieren.');
          if (!String(d.grund || '').trim()) return fail('Die Begründung fehlt.');
          Object.assign(it, { status: 'Storniert', storno: d.grund.trim() });
          log('Storniert: ' + it.storno);
          return { ok: true };
        }
      }
      return fail('Unbekannte Aktion');
    }
  };
  // Testbetrieb: bearbeitbare Abrechnungen sind Entwürfe, alle übrigen eingereicht
  function arrangeLocal() {
    const all = [...S.drafts, ...S.claims];
    S.drafts = all.filter(x => EDITABLE.has(x.status));
    S.claims = all.filter(x => !EDITABLE.has(x.status));
    for (const d of S.drafts) if (d.status === 'Zurückgewiesen' && !d.vorher) d.vorher = Calc.inhalt(d);
  }

  /* =====================================================================
     Microsoft 365
     ===================================================================== */
  let pca = null, account = null, state = 'init', message = '', syncing = false, again = false, timer = null, setupOk = false, pollTimer = null;
  const LOGIN = ['User.Read'];
  const host = () => new URL(cfg.siteUrl).hostname;
  // FullControl wird für Gruppen, Rechtestufe und Listenrechte bei der Einrichtung gebraucht;
  // die App kann trotzdem nie mehr, als der angemeldete Benutzer in SharePoint darf
  const SPS = () => [`https://${host()}/AllSites.FullControl`];
  const base = () => cfg.siteUrl.replace(/\/+$/, '');
  const baseUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '');
  const L = t => `web/lists/getbytitle('${t}')`;

  const STATES = {
    init: ['Verbinde …', 'Verbinde'], ok: ['Gespeichert und abgeglichen', 'Synchron'], syncing: ['Gleiche mit SharePoint ab …', 'Sync …'],
    pending: ['Änderungen werden übertragen', 'Ausstehend'], offline: ['Offline – Änderungen bleiben auf dem Gerät und werden später übertragen', 'Offline'],
    login: ['Anmeldung erforderlich – hier tippen', 'Anmelden'], error: ['Fehler', 'Fehler']
  };
  function setState(s, msg = '') {
    const wasErr = state === 'error';
    state = s; message = msg; paint();
    if (wasErr !== (s === 'error') && window.App) App.renderSoft();
  }
  function paint() {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.hidden = !cloud;
    if (!cloud) return;
    const [long, short] = STATES[state];
    el.className = 'sync-status s-' + state;
    el.title = long + (message ? ': ' + message : '');
    el.innerHTML = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/></svg><span>${short}</span>`;
  }

  /* ---------- Teams ---------- */
  const TEAMS_JS = 'https://cdn.jsdelivr.net/npm/@microsoft/teams-js@2.34.0/dist/umd/MicrosoftTeams.min.js';
  const TEAMS_SRI = 'sha384-brW9AazbKR2dYw2DucGgWCCcmrm2oBFV4HQidyuyZRI/TnAkmOOnTARSTdps3Hwt';
  let teamsMode = false, teamsHint = '';
  const loadScript = (src, integrity) => new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.integrity = integrity; s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
  async function initTeams() {
    if (!(new URLSearchParams(location.search).has('teams') || window.parent !== window)) return false;
    try {
      await loadScript(TEAMS_JS, TEAMS_SRI);
      await Promise.race([microsoftTeams.app.initialize(), sleep(5000).then(() => { throw new Error('Teams antwortet nicht'); })]);
      const ctx = await microsoftTeams.app.getContext();
      teamsHint = ctx?.user?.loginHint || ctx?.user?.userPrincipalName || '';
      microsoftTeams.app.notifySuccess?.();
      return true;
    } catch (e) { console.warn('Kein Teams-Kontext', e); return false; }
  }

  /* ---------- Anmeldung ---------- */
  async function init() {
    if (!cloud) {
      if (!S.user) { S.user = { id: 'lokal', name: 'Testbenutzer', mail: 'testbenutzer@lokal' }; persist(); }
      App.ready(); return;
    }
    paint();
    if (typeof msal === 'undefined') { setState('offline', 'Anmeldebibliothek nicht geladen'); if (S.user) App.ready(); return; }
    teamsMode = await initTeams();
    try {
      const auth = { clientId: cfg.clientId, authority: 'https://login.microsoftonline.com/' + cfg.tenantId };
      if (teamsMode) {
        pca = await msal.createNestablePublicClientApplication({ auth: { ...auth, supportsNestedAppAuth: true }, cache: { cacheLocation: 'localStorage' } });
        account = pca.getActiveAccount() || pca.getAllAccounts()[0] || null;
        if (!account) {
          try { account = (await pca.ssoSilent({ scopes: LOGIN, loginHint: teamsHint })).account; }
          catch (e) { console.warn('Stille Teams-Anmeldung nicht möglich', e); }
        }
      } else {
        pca = new msal.PublicClientApplication({ auth: { ...auth, redirectUri: baseUrl(), navigateToLoginRequestUrl: false }, cache: { cacheLocation: 'localStorage' } });
        await pca.initialize();
        const res = await pca.handleRedirectPromise();
        if (res?.account) account = res.account;
      }
    } catch (e) { console.error(e); setState('error', e.message); }
    if (/[#&](code|error|state)=/.test(location.hash)) history.replaceState(null, '', baseUrl() + '#/');
    account = account || pca?.getActiveAccount() || pca?.getAllAccounts()[0] || null;
    if (!account) { setState('login'); App.showLogin(teamsMode, baseUrl()); return; }
    start();
  }
  let started = false;
  function start() {
    pca.setActiveAccount(account);
    const id = account.localAccountId || account.idTokenClaims?.oid;
    if (S.user && S.user.id !== id) { // anderer Benutzer auf diesem Gerät: lokale Daten verwerfen
      for (const d of S.drafts) for (const p of d.positionen) for (const b of p.belege) Media.del(b.id).catch(() => {});
      S = fresh();
    }
    S.user = { id, name: account.name || account.username, mail: (account.username || '').toLowerCase() };
    persist();
    App.ready();
    const quiet = () => sync().catch(() => {}); // Fehler zeigt die Statusanzeige
    quiet();
    if (started) return;
    started = true;
    setInterval(() => { if (!document.hidden) quiet(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) quiet(); });
    window.addEventListener('online', quiet);
  }
  async function token(scopes) {
    try { return (await pca.acquireTokenSilent({ scopes, account })).accessToken; }
    catch (e) {
      if (e instanceof msal.InteractionRequiredAuthError || /interaction_required|login_required|consent_required|no_tokens_found/.test(e.errorCode || '')) {
        const err = new Error('Anmeldung erforderlich'); err.login = true; throw err;
      }
      throw e;
    }
  }
  async function login() {
    if (!pca) return location.reload();
    if (teamsMode) {
      try { account = (await pca.acquireTokenPopup({ scopes: [...LOGIN, ...SPS()], loginHint: teamsHint || undefined })).account; App.hideLogin(); start(); }
      catch (e) { App.toast('Anmeldung in Teams fehlgeschlagen: ' + (e.errorMessage || e.message)); }
      return;
    }
    if (account) pca.acquireTokenRedirect({ scopes: SPS(), account });
    else pca.loginRedirect({ scopes: LOGIN, extraScopesToConsent: SPS(), prompt: 'select_account' });
  }
  async function logout() {
    const open = S.drafts.filter(d => d.dirty).length;
    if (!await ask(open ? `Abmelden? ${open} Entwurf/Entwürfe sind noch nicht übertragen und gehen dabei verloren.` : 'Abmelden?', 'Abmelden', !!open)) return;
    const a = account;
    S = fresh(); persist();
    if (teamsMode) { await pca.clearCache?.(); location.reload(); return; }
    await pca.logoutRedirect({ account: a, postLogoutRedirectUri: baseUrl() });
  }

  /* ---------- SharePoint-REST ---------- */
  async function sp(path, { method = 'GET', body, merge = false, del = false, raw, binary = false } = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const t = await token(SPS());
      const headers = { Authorization: 'Bearer ' + t, Accept: 'application/json;odata=nometadata' };
      if (raw !== undefined) headers['Content-Type'] = 'application/octet-stream';
      else if (body !== undefined) headers['Content-Type'] = 'application/json;odata=verbose';
      if (merge) { headers['X-HTTP-Method'] = 'MERGE'; headers['IF-MATCH'] = '*'; }
      if (del) { headers['X-HTTP-Method'] = 'DELETE'; headers['IF-MATCH'] = '*'; }
      const res = await fetch(base() + '/_api/' + path, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
      if (res.status === 429 || res.status === 503) { await sleep((Number(res.headers.get('Retry-After')) || 2 ** attempt) * 1000); continue; }
      if (res.ok && binary) return res.blob();
      if (res.status === 204 || (res.ok && (merge || del))) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(data?.['odata.error']?.message?.value || data?.error?.message?.value || data?.error?.message || 'HTTP ' + res.status);
        err.status = res.status; throw err;
      }
      return data;
    }
    throw new Error('SharePoint ist gerade ausgelastet');
  }
  async function getAll(path) {
    const out = [];
    let d = await sp(path);
    out.push(...d.value);
    while (d['odata.nextLink']) {
      d = await sp(d['odata.nextLink'].replace(/^.*?\/_api\//, ''));
      out.push(...d.value);
    }
    return out;
  }
  const createItem = (t, fields) => sp(`${L(t)}/items`, { method: 'POST', body: { __metadata: { type: S.sync.ent[t] }, ...fields } });
  const updateItem = (t, id, fields) => sp(`${L(t)}/items(${id})`, { method: 'POST', merge: true, body: { __metadata: { type: S.sync.ent[t] }, ...fields } });

  /* ---------- Listen, Gruppen und Rechte (legt ein Administrator beim ersten Öffnen an) ---------- */
  const F = (n, t) => ({ n, t });
  const GROUPS = { pruefung: 'RK Pruefung', freigabe: 'RK Freigabe' };
  const READ_ALL = { name: 'RK Alle lesen', desc: 'Reisekosten: alle Einträge lesen (Prüfung, Freigabe)', kinds: [1, 6, 7, 9, 13, 17, 18, 28, 37, 38] }; // 9 = Listenverhalten außer Kraft setzen
  const LISTS = {
    // perm: own = Mitarbeiter schreiben eigene Einträge; claims = dazu lesen Prüfung und Freigabe alles; roles = nur Prüfung und Freigabe lesen
    RK_Abrechnungen: {
      desc: 'Reisekosten: Abrechnungen – Entwürfe schreibt der Ersteller, ab dem Einreichen nur noch der Flow', perm: 'claims',
      fields: [F('EntwurfId', 'Text'), F('Status', 'Text'), F('Daten', 'Note'), F('Nr', 'Text'), F('Stand', 'Number'), F('Pruefsumme', 'Text'),
        F('Signaturen', 'Note'), F('Pruefung', 'Note'), F('Originale', 'Bool0'), F('Ablageort', 'Text'), F('Pruefer', 'Text'), F('Rueckweisung', 'Note'),
        F('Storno', 'Note'), F('Eingereicht', 'DateTime'), F('Freigabedatum', 'DateTime'), F('Auszahlungsdatum', 'DateTime'),
        F('ErstellerName', 'Text'), F('ErstellerMail', 'Text'), F('Kostenstelle', 'Text'), F('Betrag', 'Number')]
    },
    RK_Aktionen: {
      desc: 'Reisekosten: Aufträge an den Flow (Einreichen, Prüfen, Freigeben …)', perm: 'own',
      fields: [F('Aktion', 'Text'), F('Bezug', 'Text'), F('AbrechnungId', 'Number'), F('Daten', 'Note'), F('Ergebnis', 'Text'), F('Grund', 'Note')]
    },
    RK_Signaturen: {
      desc: 'Reisekosten: alle Signaturen (schreibt nur der Flow)', perm: 'roles',
      fields: [F('AbrechnungId', 'Number'), F('Nr', 'Text'), F('Stand', 'Number'), F('Rolle', 'Text'), F('Person', 'Text'), F('Mail', 'Text'), F('Zeit', 'DateTime'), F('Pruefsumme', 'Text'), F('Bild', 'Note')]
    },
    RK_Protokoll: {
      desc: 'Reisekosten: Änderungsprotokoll (schreibt nur der Flow)', perm: 'roles',
      fields: [F('AbrechnungId', 'Number'), F('Nr', 'Text'), F('Zeit', 'DateTime'), F('Person', 'Text'), F('Aktion', 'Text'), F('Text', 'Note')]
    },
    RK_Kostenarten: {
      desc: 'Reisekosten: Kostenarten (Stammdaten)', fields: [F('Schluessel', 'Text'), F('UStStandard', 'Number'), F('Art', 'Text'), F('Reihenfolge', 'Number'), F('Aktiv', 'Boolean')],
      seed: () => KOSTENARTEN.map((k, i) => ({ Title: k.name, Schluessel: k.key, UStStandard: k.ust, Art: k.art || '', Reihenfolge: (i + 1) * 10, Aktiv: true }))
    },
    RK_Saetze: {
      desc: 'Reisekosten: Sätze mit „gültig ab“ (Kilometersatz in Euro je km)', fields: [F('Art', 'Text'), F('Wert', 'Number'), F('GueltigAb', 'DateOnly')],
      seed: () => [{ Title: 'Kilometersatz Privat-Pkw', Art: 'km', Wert: 0.3, GueltigAb: '2000-01-01T00:00:00Z' }]
    },
    RK_Kostenstellen: { desc: 'Reisekosten: Projekte und Kostenstellen (Auswahlliste)', fields: [F('Aktiv', 'Boolean')] }
  };
  function fieldXml({ n, t }) {
    const a = `Name="${n}" StaticName="${n}" DisplayName="${n}"`;
    if (t === 'Note') return `<Field Type="Note" ${a} NumLines="6" RichText="FALSE" UnlimitedLengthInDocumentLibrary="TRUE"/>`;
    if (t === 'DateOnly') return `<Field Type="DateTime" Format="DateOnly" ${a}/>`;
    if (t === 'DateTime') return `<Field Type="DateTime" Format="DateTime" ${a}/>`;
    if (t === 'Boolean') return `<Field Type="Boolean" ${a}><Default>1</Default></Field>`;
    if (t === 'Bool0') return `<Field Type="Boolean" ${a}><Default>0</Default></Field>`;
    return `<Field Type="${t}" ${a}/>`;
  }
  function mask(kinds) {
    let lo = 0n, hi = 0n;
    for (const k of kinds) { const b = BigInt(k - 1); if (b < 32n) lo |= 1n << b; else hi |= 1n << (b - 32n); }
    return { High: hi.toString(), Low: lo.toString() };
  }
  async function canManage() {
    try { const p = await sp('web/effectivebasepermissions'); return (Number(p.Low) & (1 << 11)) !== 0; } // ManageLists
    catch { return false; }
  }
  async function addField(t, f) {
    await sp(`${L(t)}/fields/createfieldasxml`, { method: 'POST', body: { parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' }, SchemaXml: fieldXml(f), Options: 16 } } });
  }
  async function ensureGroups() {
    const have = (await sp(`web/sitegroups?$select=Id,Title&$filter=startswith(Title,'RK ')`)).value;
    const out = {};
    for (const [k, title] of Object.entries(GROUPS)) {
      let g = have.find(x => x.Title === title);
      if (!g) g = await sp('web/sitegroups', { method: 'POST', body: { __metadata: { type: 'SP.Group' }, Title: title, Description: k === 'pruefung' ? 'Reisekosten: kaufmännische Prüfung' : 'Reisekosten: finale Freigabe' } });
      out[k] = g.Id;
    }
    return out;
  }
  async function ensureReadAll() {
    const defs = (await sp('web/roledefinitions?$select=Id,Name')).value;
    const d = defs.find(x => x.Name === READ_ALL.name);
    if (d) return d.Id;
    return (await sp('web/roledefinitions', { method: 'POST', body: { __metadata: { type: 'SP.RoleDefinition' }, Name: READ_ALL.name, Description: READ_ALL.desc, Order: 190, BasePermissions: { __metadata: { type: 'SP.BasePermissions' }, ...mask(READ_ALL.kinds) } } })).Id;
  }
  async function applyPerms(t, kind, ctx) {
    if (kind !== 'roles') await sp(L(t), { method: 'POST', merge: true, body: { __metadata: { type: 'SP.List' }, ReadSecurity: 2, WriteSecurity: 2 } });
    await sp(`${L(t)}/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=true)`, { method: 'POST' });
    if (kind === 'roles') { // Mitarbeiter (Besucher) sehen diese Listen nicht
      try { await sp(`${L(t)}/roleassignments/getbyprincipalid(${ctx.visitors})/deleteobject()`, { method: 'POST' }); } catch (e) { if (e.status !== 404) throw e; }
    } else await sp(`${L(t)}/roleassignments/addroleassignment(principalid=${ctx.visitors},roledefid=${ctx.contribute})`, { method: 'POST' });
    if (kind !== 'own') for (const gid of Object.values(ctx.groups)) await sp(`${L(t)}/roleassignments/addroleassignment(principalid=${gid},roledefid=${ctx.readAll})`, { method: 'POST' });
  }
  async function createList(t) {
    const def = LISTS[t];
    await sp('web/lists', { method: 'POST', body: { __metadata: { type: 'SP.List' }, Title: t, Description: def.desc, BaseTemplate: 100, EnableVersioning: true } });
    for (const f of def.fields) await addField(t, f);
    S.sync.ent[t] = (await sp(`${L(t)}?$select=ListItemEntityTypeFullName`)).ListItemEntityTypeFullName;
    if (def.seed) for (const row of def.seed()) await createItem(t, row);
  }
  async function ensureSetup() {
    if (setupOk) return;
    const have = new Set((await sp(`web/lists?$select=Title&$filter=startswith(Title,'RK_')`)).value.map(l => l.Title));
    const missing = Object.keys(LISTS).filter(t => !have.has(t));
    S.roles.admin = await canManage();
    if (missing.length && !S.roles.admin) throw new Error('Die SharePoint-Website ist noch nicht für die Reisekosten eingerichtet. Ein Administrator muss die App einmal öffnen.');
    if (S.roles.admin && (missing.length || S.sync.schema !== SCHEMA)) {
      setState('syncing', 'Richte SharePoint ein');
      for (const t of missing) await createList(t);
      for (const t of Object.keys(LISTS).filter(t => !missing.includes(t))) { // neue Spalten nach Updates ergänzen
        const cols = new Set((await sp(`${L(t)}/fields?$select=InternalName`)).value.map(f => f.InternalName));
        for (const f of LISTS[t].fields) if (!cols.has(f.n)) await addField(t, f);
      }
      // Gruppen, Rechtestufe und Listenrechte – nur wo noch nicht gesetzt
      const ctx = {
        groups: await ensureGroups(), readAll: await ensureReadAll(),
        visitors: (await sp('web/associatedvisitorgroup?$select=Id')).Id,
        contribute: (await sp('web/roledefinitions/getbytype(3)?$select=Id')).Id
      };
      for (const [t, def] of Object.entries(LISTS)) {
        if (!def.perm) continue;
        const info = await sp(`${L(t)}?$select=HasUniqueRoleAssignments`);
        if (!info.HasUniqueRoleAssignments) await applyPerms(t, def.perm, ctx);
      }
      S.sync.schema = SCHEMA;
    }
    for (const t of Object.keys(LISTS)) {
      if (!S.sync.ent[t]) S.sync.ent[t] = (await sp(`${L(t)}?$select=ListItemEntityTypeFullName`)).ListItemEntityTypeFullName;
    }
    if (!S.sync.spUserId) S.sync.spUserId = (await sp('web/currentuser?$select=Id')).Id;
    setupOk = true; persist();
  }
  async function pullRoles() {
    const g = new Set((await sp('web/currentuser/groups?$select=Title')).value.map(x => x.Title));
    S.roles.pruefung = g.has(GROUPS.pruefung);
    S.roles.freigabe = g.has(GROUPS.freigabe);
  }

  /* ---------- Rollen verwalten (nur Administratoren) ---------- */
  const groupPath = key => (key === 'besucher' ? 'web/associatedvisitorgroup' : `web/sitegroups/getbyname('${GROUPS[key]}')`);
  async function members(key) {
    return (await sp(`${groupPath(key)}/users?$select=Id,Title,Email`)).value.map(u => ({ id: u.Id, name: u.Title, mail: (u.Email || '').toLowerCase() }));
  }
  async function addMember(key, mail) {
    mail = mail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(mail)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
    const user = { __metadata: { type: 'SP.User' }, LoginName: 'i:0#.f|membership|' + mail };
    if (key !== 'besucher') await sp(`${groupPath('besucher')}/users`, { method: 'POST', body: user }); // braucht Zugang zur Website
    await sp(`${groupPath(key)}/users`, { method: 'POST', body: user });
  }
  async function removeMember(key, id) { await sp(`${groupPath(key)}/users/removebyid(${id})`, { method: 'POST' }); }

  /* ---------- Stammdaten lesen ---------- */
  async function pullMaster() {
    const ka = await getAll(`${L('RK_Kostenarten')}/items?$select=Title,Schluessel,UStStandard,Art,Reihenfolge,Aktiv&$top=500`);
    if (ka.length) S.master.kostenarten = ka.filter(k => k.Schluessel)
      .map(k => ({ key: k.Schluessel, name: k.Title, ust: Number(k.UStStandard) || 0, art: k.Art || '', order: Number(k.Reihenfolge) || 0, aktiv: k.Aktiv !== false }))
      .sort((a, b) => a.order - b.order);
    const sz = await getAll(`${L('RK_Saetze')}/items?$select=Art,Wert,GueltigAb&$top=500`);
    if (sz.length) S.master.saetze = sz.map(s => ({ art: s.Art, wert: Math.round(Number(s.Wert) * 100), ab: (s.GueltigAb || '2000-01-01').slice(0, 10) }));
    const ks = await getAll(`${L('RK_Kostenstellen')}/items?$select=Title,Aktiv&$top=1000`);
    S.master.kostenstellen = ks.filter(k => k.Aktiv !== false).map(k => k.Title).sort((a, b) => a.localeCompare(b, 'de'));
  }

  /* ---------- Abrechnungen abgleichen ---------- */
  const extOf = type => (type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg');
  const SELECT = 'Id,EntwurfId,Status,Daten,Nr,Stand,Pruefsumme,Signaturen,Pruefung,Originale,Ablageort,Pruefer,Rueckweisung,Storno,Eingereicht,Freigabedatum,Auszahlungsdatum,ErstellerName,ErstellerMail,AuthorId,HasUniqueRoleAssignments';
  function toServer(d) {
    return { id: d.id, created: d.created, updated: d.updated, kopf: d.kopf, positionen: d.positionen.map(p => ({ ...p, belege: p.belege.map(({ thumb, uploaded, ...b }) => b) })), vorher: d.vorher || null };
  }
  function fromServer(it, loc) {
    let srv = {};
    try { srv = JSON.parse(it.Daten || '{}'); } catch { /* beschädigt */ }
    const j = (s, def) => { try { return s ? JSON.parse(s) : def; } catch { return def; } };
    const oldB = new Map((loc?.positionen || []).flatMap(p => p.belege).map(b => [b.id, b]));
    return {
      id: it.EntwurfId || srv.id || 'sp' + it.Id, spId: it.Id, status: it.Status || 'Entwurf', created: srv.created, updated: srv.updated,
      kopf: srv.kopf || { zweck: '', kostenstelle: '', ort: '', land: '', beginn: '', ende: '', vorschuss: 0 },
      positionen: (srv.positionen || []).map(p => ({ ...p, belege: (p.belege || []).map(b => ({ ...b, uploaded: true, thumb: oldB.get(b.id)?.thumb || null })) })),
      vorher: srv.vorher || null,
      nr: it.Nr || '', stand: Number(it.Stand) || 0, pruefsumme: it.Pruefsumme || '', signaturen: j(it.Signaturen, []), pruefung: j(it.Pruefung, {}),
      originale: !!it.Originale, ablageort: it.Ablageort || '', pruefer: (it.Pruefer || '').toLowerCase(), rueckweisung: it.Rueckweisung || '', storno: it.Storno || '',
      eingereicht: it.Eingereicht || null, freigabedatum: it.Freigabedatum || null, auszahlungsdatum: (it.Auszahlungsdatum || '').slice(0, 10) || null,
      erstellerName: it.ErstellerName || '', erstellerMail: (it.ErstellerMail || '').toLowerCase(), authorId: it.AuthorId, locked: !!it.HasUniqueRoleAssignments,
      hinweis: loc?.hinweis || '', dirty: false, removed: []
    };
  }
  async function pullOwn() {
    const items = await getAll(`${L('RK_Abrechnungen')}/items?$select=${SELECT}&$filter=AuthorId eq ${S.sync.spUserId}&$top=500`);
    const seen = new Set(), claims = [];
    let changed = false;
    for (const it of items) {
      const id = it.EntwurfId || 'sp' + it.Id;
      seen.add(id);
      const i = S.drafts.findIndex(d => d.id === id), loc = S.drafts[i];
      if (EDITABLE.has(it.Status || 'Entwurf')) {
        if (loc?.dirty) { loc.spId = it.Id; continue; }             // lokal geändert → wird hochgeladen
        let next = fromServer(it, loc);
        if (next.status === 'Zurückgewiesen' && !next.vorher) next.vorher = Calc.inhalt(next); // Stand vor der Überarbeitung (F-17)
        if (loc && loc.updated === next.updated && loc.status === next.status && loc.rueckweisung === next.rueckweisung) { loc.spId = it.Id; Object.assign(loc, { stand: next.stand, nr: next.nr, pruefung: next.pruefung, locked: next.locked }); continue; }
        if (i >= 0) S.drafts[i] = next; else S.drafts.push(next);
        changed = true;
      } else {
        claims.push(fromServer(it, S.claims.find(c => c.id === id)));
        if (i >= 0) { S.drafts.splice(i, 1); changed = true; }      // vom Flow übernommen
      }
    }
    for (const d of [...S.drafts]) {
      if (!d.spId || d.dirty || seen.has(d.id)) continue;
      S.drafts = S.drafts.filter(x => x !== d);                     // anderswo gelöscht
      for (const p of d.positionen) for (const b of p.belege) Media.del(b.id).catch(() => {});
      changed = true;
    }
    if (JSON.stringify(claims.map(c => [c.id, c.status, c.locked])) !== JSON.stringify(S.claims.map(c => [c.id, c.status, c.locked]))) changed = true;
    S.claims = claims.sort((a, b) => String(b.eingereicht).localeCompare(String(a.eingereicht)));
    S.drafts.sort((a, b) => b.created - a.created);
    return changed;
  }
  async function pullInbox() {
    if (!S.roles.pruefung && !S.roles.freigabe) { const had = S.inbox.length; S.inbox = []; return had > 0; }
    const items = await getAll(`${L('RK_Abrechnungen')}/items?$select=${SELECT}&$filter=Status ne 'Entwurf' and Status ne 'Wird eingereicht'&$top=500`);
    const next = items.map(it => fromServer(it, S.inbox.find(c => c.spId === it.Id))).filter(valid)
      .sort((a, b) => String(b.eingereicht).localeCompare(String(a.eingereicht)));
    const changed = JSON.stringify(next.map(c => [c.id, c.status])) !== JSON.stringify(S.inbox.map(c => [c.id, c.status]));
    S.inbox = next;
    return changed;
  }
  async function pushDrafts() {
    for (const spId of [...S.trash]) {
      try { await sp(`${L('RK_Abrechnungen')}/items(${spId})/recycle`, { method: 'POST' }); }
      catch (e) { if (e.status !== 404) throw e; }
      S.trash = S.trash.filter(x => x !== spId); persist();
    }
    for (const d of S.drafts.filter(d => d.dirty)) {
      const stamp = d.updated;
      const fields = () => ({
        Title: (d.kopf.zweck || 'Neue Reise').slice(0, 250), EntwurfId: d.id, Status: d.status, Daten: JSON.stringify(toServer(d)),
        ErstellerName: S.user.name, ErstellerMail: S.user.mail, Kostenstelle: (d.kopf.kostenstelle || '').slice(0, 250), Betrag: Calc.sums(d).auszahlung / 100
      });
      if (!d.spId) { d.spId = (await createItem('RK_Abrechnungen', fields())).Id; persist(); }
      for (const p of d.positionen) for (const b of p.belege) {
        if (b.uploaded) continue;
        b.datei = b.datei || `${b.id}.${extOf(b.type)}`;
        const blob = await Media.get(b.id);
        if (!blob) continue; // Datei fehlt auf diesem Gerät (sollte nicht vorkommen)
        try { await sp(`${L('RK_Abrechnungen')}/items(${d.spId})/AttachmentFiles/add(FileName='${encodeURIComponent(b.datei)}')`, { method: 'POST', raw: blob }); }
        catch (e) { if (!/exist|bereits/i.test(e.message)) throw e; }
        b.uploaded = true; persist();
      }
      for (const name of [...(d.removed || [])]) {
        try { await sp(`${L('RK_Abrechnungen')}/items(${d.spId})/AttachmentFiles/getByFileName('${encodeURIComponent(name)}')`, { method: 'POST', del: true }); }
        catch (e) { if (e.status !== 404) throw e; }
        d.removed = d.removed.filter(x => x !== name); persist();
      }
      await updateItem('RK_Abrechnungen', d.spId, fields());
      if (d.updated === stamp) d.dirty = false;
      persist();
    }
  }
  // Ergebnis der Aufträge nachlesen (der Flow setzt „erledigt“ oder „abgelehnt“)
  async function pollPending() {
    let changed = false;
    for (const p of [...S.pending]) {
      let it;
      try { it = await sp(`${L('RK_Aktionen')}/items(${p.id})?$select=Ergebnis,Grund`); }
      catch (e) { if (e.status === 404) { S.pending = S.pending.filter(x => x !== p); continue; } throw e; }
      if (it.Ergebnis !== 'erledigt' && it.Ergebnis !== 'abgelehnt') continue;
      S.pending = S.pending.filter(x => x !== p);
      changed = true;
      if (it.Ergebnis === 'abgelehnt') {
        const text = `${AKTION_TEXT[p.aktion] || p.aktion} abgelehnt: ${it.Grund || 'ohne Angabe von Gründen'}`;
        S.notes.unshift({ zeit: Date.now(), itemId: p.itemId, text });
        App.toast(text, 8000);
        const d = draft(p.itemId);
        if (p.aktion === 'Einreichen' && d && d.status === 'Wird eingereicht') { d.status = 'Entwurf'; d.hinweis = text; touch(d); }
      }
    }
    persist();
    return changed;
  }
  const AKTION_TEXT = { Einreichen: 'Einreichen', Pruefen: 'Prüfung', Zurueckweisen: 'Zurückweisen', Freigeben: 'Freigabe', Auszahlen: 'Auszahlung', Stornieren: 'Storno' };
  function fastPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!S.pending.length) clearInterval(pollTimer); else sync().catch(() => {}); }, 20000);
  }

  async function sync() {
    if (!cloud || !account) return;
    if (syncing) { again = true; return; }
    if (!navigator.onLine) { setState('offline'); return; }
    syncing = true; setState('syncing');
    let changedAny = false;
    const rolesBefore = JSON.stringify(S.roles);
    try {
      await ensureSetup();
      await pullRoles();
      changedAny = JSON.stringify(S.roles) !== rolesBefore; // Reiter und Rechte neu anzeigen
      await pullMaster();
      changedAny = (await pullOwn()) || changedAny;
      await pushDrafts();
      const done = await pollPending();
      if (done) await pullOwn();                                     // Ergebnis des Flows gleich anzeigen
      changedAny = (await pullInbox()) || done || changedAny;
      S.sync.last = Date.now(); persist();
      setState(S.drafts.some(d => d.dirty) || S.trash.length ? 'pending' : 'ok');
    } catch (e) {
      if (e.login) setState('login');
      else if (!navigator.onLine || e instanceof TypeError) setState('offline');
      else { console.warn(e); setState('error', e.message); }
      throw e;
    } finally {
      syncing = false;
      if (changedAny) App.renderSoft();
      if (again) { again = false; setTimeout(() => sync().catch(() => {}), 300); }
    }
  }
  async function syncNow() {
    while (syncing) await sleep(200);
    await sync();
  }
  function changed() {
    if (!cloud || !account) return;
    if (!syncing && state !== 'login') setState(navigator.onLine ? 'pending' : 'offline');
    clearTimeout(timer);
    timer = setTimeout(() => sync().catch(() => {}), 1500);
  }

  /* ---------- Projektliste (RK_Kostenstellen), pflegt der Administrator ---------- */
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  function localMaster() { S.master.kostenstellen = (S.localProjects || []).filter(p => p.aktiv).map(p => p.name).sort((a, b) => a.localeCompare(b, 'de')); }
  async function projects() {
    if (!cloud) return (S.localProjects || []).slice().sort(byName);
    return (await getAll(`${L('RK_Kostenstellen')}/items?$select=Id,Title,Aktiv&$top=2000`)).map(i => ({ id: i.Id, name: i.Title || '', aktiv: i.Aktiv !== false })).sort(byName);
  }
  async function addProject(name) {
    name = String(name || '').trim();
    if (!name) throw new Error('Bitte einen Projektnamen eingeben.');
    if ((await projects()).some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error(`„${name}“ steht schon in der Projektliste.`);
    if (!cloud) { (S.localProjects = S.localProjects || []).push({ id: uid(), name, aktiv: true }); localMaster(); persist(); return; }
    await createItem('RK_Kostenstellen', { Title: name.slice(0, 250), Aktiv: true });
    await pullMaster(); persist();
  }
  async function setProject(id, aktiv) {
    if (!cloud) { const p = (S.localProjects || []).find(x => x.id === id); if (p) p.aktiv = aktiv; localMaster(); persist(); return; }
    await updateItem('RK_Kostenstellen', id, { Aktiv: !!aktiv });
    await pullMaster(); persist();
  }

  /* ---------- Protokoll einer Abrechnung ---------- */
  async function protokoll(c) {
    if (!cloud) return (c.protokoll || []).slice().reverse();
    const items = await getAll(`${L('RK_Protokoll')}/items?$select=Zeit,Person,Aktion,Text&$filter=AbrechnungId eq ${c.spId}&$top=500`);
    return items.map(i => ({ zeit: i.Zeit, person: i.Person, aktion: i.Aktion, text: i.Text })).sort((a, b) => String(b.zeit).localeCompare(String(a.zeit)));
  }

  /* ---------- Sätze ---------- */
  function kmSatz(datum) {
    const s = S.master.saetze.filter(x => x.art === 'km' && x.ab <= (datum || '9999')).sort((a, b) => b.ab.localeCompare(a.ab))[0];
    return s ? s.wert : 30;
  }

  return {
    cloud, init, login, logout, sync: () => sync().catch(() => {}), statusText: () => STATES[state][0] + (message ? ' – ' + message : ''),
    problem: () => (state === 'error' ? message : ''),
    state: () => S, user: () => S.user, roles: () => S.roles, master: () => S.master, kmSatz,
    drafts: () => S.drafts, claims: () => S.claims, inbox: () => (cloud ? S.inbox : S.claims), draft, claim, valid, pendingFor,
    notes: id => S.notes.filter(n => n.itemId === id), review: id => (S.review[id] = S.review[id] || { vermerke: {}, ablageort: '' }),
    clearReview: id => { delete S.review[id]; persist(); },
    newDraft, touch, removeDraft, fileOf, act, protokoll, persist,
    members, addMember, removeMember, GROUPS, projects, addProject, setProject,
    setLocalName: n => { if (!cloud) { S.user.name = n; S.user.mail = n.trim().toLowerCase().replace(/\s+/g, '.') + '@lokal'; persist(); } },
    inTeams: () => teamsMode, signedIn: () => !cloud || !!account, Flow
  };
})();

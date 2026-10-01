'use strict';
/* =====================================================================
   Fachliche Rechenregeln – gemeinsam für Oberfläche, Datenhaltung und
   die Nachbildung der Flows im lokalen Testbetrieb
   ===================================================================== */
const Calc = (() => {
  const KA = key => (typeof Data !== 'undefined' ? Data.master().kostenarten : []).find(k => k.key === key) || { key, name: key || '–', ust: 19, art: '' };
  const isKm = p => KA(p.kostenart).art === 'km';
  const isBew = p => KA(p.kostenart).art === 'bewirtung';
  const betrag = p => (isKm(p) ? Math.round((Number(p.km) || 0) * (p.kmSatz || 0)) : (p.brutto || 0));
  // Die Umsatzsteuer ist im Bruttobetrag enthalten und wird herausgerechnet
  const ust = p => { const b = betrag(p), s = isKm(p) ? 0 : Number(p.ust) || 0; return b - Math.round(b / (1 + s / 100)); };
  const projektOf = (d, p) => String(p.projekt || d.kopf.kostenstelle || '').trim();

  /* F-09: Summen. Firmenkarte zahlt die Firma direkt, sie wird nicht erstattet. */
  function sums(d) {
    let auslagen = 0, firmenkarte = 0, km = 0, steuer = 0;
    for (const p of d.positionen) {
      const b = betrag(p);
      if (isKm(p)) km += b;
      else { auslagen += b; steuer += ust(p); if (p.zahlungsart === 'firmenkarte') firmenkarte += b; }
    }
    const vorschuss = d.kopf.vorschuss || 0;
    return { auslagen, firmenkarte, km, vorschuss, steuer, auszahlung: auslagen - firmenkarte + km - vorschuss };
  }

  /* F-08, F-11, B-06: Pflichtfeldprüfung vor dem Einreichen */
  function validate(d) {
    const k = d.kopf, out = [];
    const need = (v, key, msg) => { if (!String(v ?? '').trim()) out.push({ key, msg }); };
    need(k.zweck, 'zweck', 'Reisezweck fehlt.');
    need(k.kostenstelle, 'kostenstelle', 'Projekt oder Kostenstelle fehlt.');
    need(k.ort, 'ort', 'Reiseziel (Ort) fehlt.');
    need(k.land, 'land', 'Reiseziel (Land) fehlt.');
    need(k.beginn, 'beginn', 'Beginn der Reise (Datum und Uhrzeit) fehlt.');
    need(k.ende, 'ende', 'Ende der Reise (Datum und Uhrzeit) fehlt.');
    if (k.beginn && k.ende && k.ende <= k.beginn) out.push({ key: 'ende', msg: 'Das Ende der Reise muss nach dem Beginn liegen.' });
    if (!d.positionen.length) out.push({ key: 'positionen', msg: 'Es ist noch keine Kostenposition erfasst.' });
    d.positionen.forEach((p, i) => {
      const pre = `Position ${i + 1} (${KA(p.kostenart).name}): `, pk = 'p:' + p.id;
      const add = msg => out.push({ key: pk, pos: p.id, msg: pre + msg });
      if (!p.datum) add('Datum fehlt.');
      if (isKm(p)) {
        if (!(Number(p.km) > 0)) add('Kilometer fehlen.');
        if (!String(p.strecke || '').trim()) add('Strecke (von – nach) fehlt.');
      } else {
        if (!(p.brutto > 0)) add('Betrag fehlt.');
        if (!p.zahlungsart) add('Zahlungsart fehlt.');
        if (isBew(p)) {
          const b = p.bewirtung || {};
          if (!String(b.anlass || '').trim()) add('Anlass der Bewirtung fehlt.');
          if (!String(b.teilnehmer || '').trim()) add('Teilnehmer der Bewirtung fehlen.');
          if (!String(b.ort || '').trim()) add('Ort der Bewirtung fehlt.');
        }
        if (p.eigenbeleg && !String(p.eigenbelegGrund || '').trim()) add('Begründung für den Eigenbeleg fehlt.');
        if (!p.belege.length && !p.eigenbeleg) add('Beleg fehlt. Ohne Beleg nur als Eigenbeleg mit Begründung.');
      }
    });
    return out;
  }

  /* P-04, Pflichtenheft Abschnitt 9: Inhalt, über den die Prüfsumme gebildet wird.
     Prüfvermerke, Häkchen, Ablageort, Status und Signaturen gehören nicht dazu (P-05). */
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v ?? null);
  }
  function inhalt(d) {
    const k = d.kopf, t = s => String(s ?? '').trim();
    return {
      kopf: { zweck: t(k.zweck), kostenstelle: t(k.kostenstelle), ort: t(k.ort), land: t(k.land), beginn: k.beginn, ende: k.ende, vorschuss: k.vorschuss || 0 },
      positionen: d.positionen.map(p => ({
        datum: p.datum, kostenart: p.kostenart, brutto: betrag(p), ust: isKm(p) ? 0 : Number(p.ust), zahlungsart: isKm(p) ? 'privat' : p.zahlungsart,
        bemerkung: t(p.bemerkung), km: isKm(p) ? Number(p.km) : 0, kmSatz: isKm(p) ? p.kmSatz : 0, strecke: isKm(p) ? t(p.strecke) : '',
        bewirtung: isBew(p) ? { anlass: t(p.bewirtung?.anlass), teilnehmer: t(p.bewirtung?.teilnehmer), ort: t(p.bewirtung?.ort) } : null,
        eigenbelegGrund: p.eigenbeleg ? t(p.eigenbelegGrund) : '', belege: isKm(p) ? [] : p.belege.map(b => b.sha256),
        projekt: projektOf(d, p), digital: isKm(p) ? [] : p.belege.map(b => !!b.digital) // seit 0.3.0
      }))
    };
  }
  const pruefsumme = d => Media.sha256Text(stable(inhalt(d)));

  /* F-17: Änderungen gegenüber dem zuletzt eingereichten Stand (für das Protokoll bei erneuter Einreichung) */
  function diff(alt, neu) {
    if (!alt) return '';
    const out = [], money = c => ((c || 0) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €';
    const NAMES = { zweck: 'Reisezweck', kostenstelle: 'Kostenstelle', ort: 'Ort', land: 'Land', beginn: 'Beginn', ende: 'Ende', vorschuss: 'Vorschuss' };
    for (const k of Object.keys(NAMES)) {
      const a = alt.kopf[k], b = neu.kopf[k];
      if (stable(a) !== stable(b)) out.push(`${NAMES[k]}: „${k === 'vorschuss' ? money(a) : a ?? ''}“ → „${k === 'vorschuss' ? money(b) : b ?? ''}“`);
    }
    const n = Math.max(alt.positionen.length, neu.positionen.length);
    for (let i = 0; i < n; i++) {
      const a = alt.positionen[i], b = neu.positionen[i];
      if (!a) out.push(`Position ${i + 1} neu: ${KA(b.kostenart).name} ${money(b.brutto)}`);
      else if (!b) out.push(`Position ${i + 1} entfernt: ${KA(a.kostenart).name} ${money(a.brutto)}`);
      else if (stable(a) !== stable(b)) {
        const parts = [];
        if (a.brutto !== b.brutto) parts.push(`Betrag ${money(a.brutto)} → ${money(b.brutto)}`);
        if (a.kostenart !== b.kostenart) parts.push(`Kostenart ${KA(a.kostenart).name} → ${KA(b.kostenart).name}`);
        if (a.projekt !== b.projekt) parts.push(`Projekt ${a.projekt || '–'} → ${b.projekt || '–'}`);
        if (a.km !== b.km) parts.push(`km ${a.km} → ${b.km}`);
        if (stable(a.belege) !== stable(b.belege)) parts.push('Belege geändert');
        out.push(`Position ${i + 1} geändert${parts.length ? ': ' + parts.join(', ') : ''}`);
      }
    }
    return out.join('; ');
  }

  return { KA, isKm, isBew, betrag, ust, projektOf, sums, validate, stable, inhalt, pruefsumme, diff };
})();

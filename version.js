// Version der App – bei jeder Änderung hier, in CHANGELOG.md und in sw.js (CACHE) mitziehen
const APP_VERSION = '0.3.0';
const APP_CHANGES = [
  {
    v: '0.3.0', d: '01.10.2026', items: [
      'Belegerkennung: Foto oder PDF zuerst – die App liest Kostenart, Betrag, Datum, Umsatzsteuer und Aussteller aus (läuft auf dem Gerät, ohne Lizenz)',
      'Fahrten mit dem Privat-Pkw aus einer Excel-Liste übernehmen; Vorlage mit Projektauswahl zum Herunterladen',
      'Projekt je Position; eigene Projektliste, gepflegt unter „Verwaltung“',
      'Anzeige der im Bruttobetrag enthaltenen Umsatzsteuer je Position und in den Summen',
      'Beleg als „digitales Original“ kennzeichnen (z. B. PDF-Rechnung per E-Mail); die Prüfung sieht, welche Papierbelege erwartet werden',
      'Ort der Bewirtung wird mit dem Reiseziel vorbelegt'
    ]
  },
  {
    v: '0.2.1', d: '01.10.2026', items: [
      'Einrichtung: SharePoint-Berechtigung AllSites.FullControl statt AllSites.Manage, damit die App Gruppen und Listenrechte anlegen kann (Fehler „Access is denied“)'
    ]
  },
  {
    v: '0.2.0', d: '01.10.2026', items: [
      'Etappe B: kaufmännische Prüfung mit Abhaken je Position, Kommentaren, Ablageort und Häkchen „Alle Belege liegen im Original vor“',
      'Finale Freigabe mit Sperre ohne Originalbeleg-Häkchen und Vier-Augen-Prinzip; Zurückweisen mit Begründung, Auszahlung, Storno',
      'Abrechnung wird beim Einreichen gesperrt; nach einer Zurückweisung behält sie ihre Nummer und die Änderungen erscheinen im Protokoll',
      'Rollenverwaltung in der App für Administratoren; Reiter „Prüfung“ und „Freigabe“ mit Zähler und Suche',
      'Signaturen aller drei Stufen mit Prüfsummenkontrolle; Änderungsprotokoll für Prüfung und Freigabe'
    ]
  },
  {
    v: '0.1.0', d: '01.10.2026', items: [
      'Erste Fassung (Etappe A): Reisen anlegen, Positionen mit Kilometergeld und Bewirtungsangaben, Belege per Kamera oder Datei',
      'Fotos werden automatisch verkleinert, jede Belegdatei erhält eine SHA-256-Prüfsumme',
      'Entwürfe werden laufend gespeichert und mit SharePoint abgeglichen',
      'Pflichtfeldprüfung vor dem Einreichen, Unterschrift per Finger, Stift oder hinterlegtem Bild',
      'Teams-App-Paket lässt sich im Profil herunterladen'
    ]
  }
];

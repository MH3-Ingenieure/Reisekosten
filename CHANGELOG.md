# Änderungsprotokoll Reisekosten

## 0.2.1 – 01.10.2026

- SharePoint-Berechtigung AllSites.FullControl statt AllSites.Manage: Ohne sie verweigert SharePoint das Anlegen der Gruppen und Listenrechte beim ersten Start („Access is denied“)

## 0.2.0 – 01.10.2026 (Etappe B: Prüfung und Freigabe)

- Eine Abrechnung ist genau ein Eintrag in RK_Abrechnungen (vorher RK_Entwuerfe); beim Einreichen sperrt der Flow den Eintrag für den Ersteller, bei einer Zurückweisung gibt er ihn wieder frei
- Neue Listen RK_Signaturen und RK_Protokoll, Gruppen „RK Pruefung“ und „RK Freigabe“, Rechtestufe „RK Alle lesen“ – legt die App beim ersten Öffnen durch einen Administrator an
- Kaufmännische Prüfung: Positionen abhaken und kommentieren (B-09), Ablageort (N-04), Häkchen erst nach Prüfung aller Positionen (P-02), Unterschrift
- Finale Freigabe: gesperrt ohne Originalbeleg-Häkchen (P-03), Vier-Augen-Prinzip (P-07), Unterschrift; Storno mit Begründung (P-08)
- Zurückweisen mit Pflichtbegründung durch Prüfung oder Freigabe (F-14), Hinweise der Prüfung bei den Positionen, erneutes Einreichen mit Protokoll der Änderungen (F-17)
- Auszahlung mit Datum durch die Prüfung
- Reiter „Prüfung“ und „Freigabe“ mit Zähler offener Vorgänge, Suche und Statusfilter (F-13, F-18)
- Rollenverwaltung für Administratoren (Gruppen der SharePoint-Website)
- Prüfsumme wird bei jeder Anzeige nachgerechnet; ein Status, der nicht durch den Ablauf gesperrt ist, wird als ungültig angezeigt
- Im lokalen Testbetrieb werden alle Flow-Regeln nachgebildet

## 0.1.0 – 01.10.2026 (Etappe A: Erfassung)

- Reisen anlegen mit Reisezweck, Projekt/Kostenstelle, Reiseziel, Beginn, Ende und Vorschuss (F-02)
- Kostenpositionen mit Kostenart, Datum, Betrag, Umsatzsteuersatz, Zahlungsart und Bemerkung (F-03, F-04)
- Privat-Pkw mit Strecke und Kilometern; der Betrag wird aus dem Kilometersatz mit „gültig ab“ berechnet (F-05, N-11)
- Bewirtung mit Pflichtangaben Anlass, Teilnehmer und Ort (F-08)
- Summen: Auslagen, davon Firmenkarte, Kilometergeld, Vorschuss, Auszahlungsbetrag (F-09)
- Belege per Kamera oder Datei; Prüfung der Dateitypen, Verkleinerung großer Fotos, SHA-256-Prüfsumme, Vorschau, Hinweis auf doppelte Belege (B-01 bis B-07, B-10)
- Eigenbeleg mit Pflichtbegründung (B-06)
- Entwürfe werden laufend gespeichert und mit SharePoint abgeglichen; Belege hängen als Anlagen am Entwurf (F-10, B-08)
- Pflichtfeldprüfung vor dem Einreichen mit Meldung je Feld (F-11)
- Unterschrift per Finger, Stift oder hinterlegtem Bild, Bestätigung der Richtigkeit, Prüfsumme des Abrechnungsstands (P-01, P-04)
- Einreichen über einen Auftrag in RK_Aktionen; ohne config.js wird das Einreichen im lokalen Testbetrieb nachgebildet
- Beim ersten Öffnen durch einen Administrator legt die App die SharePoint-Listen an und belegt die Stammdaten vor
- Teams-App-Paket (mit Kamerafreigabe) lässt sich im Profil herunterladen

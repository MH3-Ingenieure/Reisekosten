// Microsoft-365-Konfiguration der Reisekosten-App
// Alle drei Werte leer lassen = lokaler Testbetrieb: Daten bleiben nur auf diesem Gerät, ohne Anmeldung.
window.APP_CONFIG = {
  tenantId: '49d4e5a0-6134-4e7f-b98a-85e15466994d',  // Verzeichnis-ID (Mandanten-ID) aus der App-Registrierung „MH3 Reisekosten“ in Entra ID
  clientId: '48b1445a-c0e0-4524-854d-cb55ac7a23aa',  // Anwendungs-ID (Client-ID) aus derselben App-Registrierung
  siteUrl: 'https://mh3ingenieurede.sharepoint.com/sites/Reisekosten'    // Adresse der SharePoint-Website, z. B. 'https://mh3ingenieurede.sharepoint.com/sites/Reisekosten'
};

// Microsoft-365-Konfiguration der Reisekosten-App
// Alle drei Werte leer lassen = lokaler Testbetrieb: Daten bleiben nur auf diesem Gerät, ohne Anmeldung.
window.APP_CONFIG = {
  tenantId: '',  // Verzeichnis-ID (Mandanten-ID) aus der App-Registrierung „MH3 Reisekosten“ in Entra ID
  clientId: '',  // Anwendungs-ID (Client-ID) aus derselben App-Registrierung
  siteUrl: ''    // Adresse der SharePoint-Website, z. B. 'https://mh3ingenieurede.sharepoint.com/sites/Reisekosten'
};

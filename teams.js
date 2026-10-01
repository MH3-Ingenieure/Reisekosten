'use strict';
/* =====================================================================
   Teams-App-Paket (manifest.json + zwei Symbole als ZIP) zum Hochladen
   im Teams Admin Center – wie bei der Zeiterfassung
   ===================================================================== */
const Teams = (() => {
  const appBaseUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '');
  const isLocal = () => /^(localhost|127\.)/.test(location.hostname);

  function cardHTML() {
    if (!Data.cloud) return '';
    const local = isLocal();
    return `<div class="card"><div class="card-head">Microsoft Teams</div><div class="card-body">
      <p style="margin-top:0">Die Reisekosten als App in der Teams-Leiste – Anmeldung automatisch über Teams, Kamera für Belege freigegeben.</p>
      <ol class="changes" style="color:inherit">
        <li>In Entra ID bei der App-Registrierung unter <b>Authentifizierung → Single-Page-Anwendung</b> zusätzlich diese Umleitungs-URI eintragen: <code>brk-multihub://${esc(location.host)}</code></li>
        <li>Paket herunterladen und im <b>Teams Admin Center</b> hochladen (Einrichtungsanleitung Kapitel 7).</li>
      </ol>
      <button class="btn primary small" data-action="teams-package"${local ? ' disabled' : ''}>Teams-App-Paket herunterladen</button>
      ${local ? '<p class="muted small">Das Paket lässt sich nur erstellen, wenn die App über ihre veröffentlichte Adresse (https) geöffnet ist.</p>' : ''}
    </div></div>`;
  }

  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function makeZip(files) { // unkomprimiertes ZIP (Methode „stored“) – reicht für Teams
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((a, p) => a + p.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
  }
  async function stableGuid(seed) { // gleiche App-ID bei jedem Herunterladen → Updates statt Duplikate
    const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(seed))).slice(0, 16);
    h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
    const x = [...h].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }
  function outlineIcon() { // 32×32, weiß auf transparent (Vorgabe von Teams): Koffer
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'); g.strokeStyle = '#fff'; g.lineWidth = 2.4; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.roundRect(5, 11, 22, 16, 3); g.stroke();
    g.beginPath(); g.moveTo(12.5, 11); g.lineTo(12.5, 7.5); g.lineTo(19.5, 7.5); g.lineTo(19.5, 11); g.stroke();
    g.beginPath(); g.moveTo(5, 18); g.lineTo(27, 18); g.stroke();
    return new Promise(ok => c.toBlob(b => b.arrayBuffer().then(a => ok(new Uint8Array(a))), 'image/png'));
  }
  async function download() {
    try {
      const base = appBaseUrl(), cfg = window.APP_CONFIG || {};
      const manifest = {
        $schema: 'https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json',
        manifestVersion: '1.17', version: APP_VERSION, // muss bei jedem neuen Paket steigen
        id: await stableGuid('reisekosten-teams|' + cfg.clientId + '|' + base),
        developer: { name: 'MH3 Ingenieure', websiteUrl: base, privacyUrl: base, termsOfUseUrl: base },
        name: { short: 'Reisekosten', full: 'Reisekostenabrechnung MH3' },
        description: { short: 'Reisekosten mit Belegen erfassen und einreichen', full: 'Reisekostenabrechnung mit Belegfotos, Kilometergeld, Unterschrift und Freigabekette. Daten liegen in SharePoint im eigenen Microsoft 365.' },
        icons: { color: 'color.png', outline: 'outline.png' },
        accentColor: '#00897B',
        staticTabs: [{ entityId: 'reisekosten', name: 'Reisekosten', contentUrl: base + '?teams=1#/', websiteUrl: base, scopes: ['personal'] }],
        permissions: ['identity'],
        devicePermissions: ['media'], // Kamera für Belegfotos (B-02)
        validDomains: [location.host]
      };
      const color = new Uint8Array(await (await fetch('icons/icon-192.png', { cache: 'no-store' })).arrayBuffer());
      const zip = makeZip([
        { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
        { name: 'color.png', data: color },
        { name: 'outline.png', data: await outlineIcon() }
      ]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zip); a.download = 'Reisekosten_Teams.zip';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      App.toast('Teams-App-Paket heruntergeladen');
    } catch (e) { App.toast('Paket konnte nicht erstellt werden: ' + e.message); }
  }
  return { cardHTML, download };
})();

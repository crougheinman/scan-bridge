// Minimal eSCL / AirScan client. Works against any eSCL-capable network scanner
// (Brother, HP, Canon, ...). Returns raw page buffers; the caller assembles them
// into a PDF.
import { pageDimensions, esclColorMode } from './config.js';
import { log } from './log.js';

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

const SCAN_NS = 'http://schemas.hp.com/imaging/escl/2011/05/03';
const PWG_NS = 'http://www.pwg.org/schemas/2010/12/sm';

function buildScanSettingsXml(settings) {
  const dpi = Math.max(100, Math.min(600, parseInt(settings.resolution, 10) || 300));
  const color = esclColorMode(settings.colorMode);
  const input = (settings.inputSource || 'Feeder') === 'Platen' ? 'Platen' : 'Feeder';
  const duplex = input === 'Feeder' && !!settings.duplex;
  const { width, height } = pageDimensions(settings.pageSize);

  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="${SCAN_NS}" xmlns:pwg="${PWG_NS}">
  <pwg:Version>2.6</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <pwg:ScanRegions pwg:MustHonor="false">
    <pwg:ScanRegion>
      <pwg:Height>${height}</pwg:Height>
      <pwg:Width>${width}</pwg:Width>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>${input}</pwg:InputSource>
  <scan:Duplex>${duplex ? 'true' : 'false'}</scan:Duplex>
  <scan:ColorMode>${color}</scan:ColorMode>
  <scan:XResolution>${dpi}</scan:XResolution>
  <scan:YResolution>${dpi}</scan:YResolution>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
</scan:ScanSettings>`;
}

/**
 * Probe a scanner for eSCL support / reachability.
 * @returns {Promise<{reachable: boolean, esclSupported: boolean, model: string|null, error: string|null}>}
 */
export async function probe(ip, timeoutMs = 5000) {
  const url = `http://${ip}/eSCL/ScannerCapabilities`;
  const t = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal: t.signal });
    if (!res.ok) {
      return { reachable: true, esclSupported: false, model: null, error: `Capabilities HTTP ${res.status}` };
    }
    const xml = await res.text();
    const m = xml.match(/<pwg:MakeAndModel>([^<]+)<\/pwg:MakeAndModel>/i);
    return { reachable: true, esclSupported: true, model: m ? m[1].trim() : null, error: null };
  } catch (err) {
    return { reachable: false, esclSupported: false, model: null, error: String(err.message || err) };
  } finally {
    t.done();
  }
}

/**
 * Run a scan job and collect all pages.
 * @returns {Promise<Array<{type: string, buf: Buffer}>>}
 */
export async function scan(ip, settings, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  const body = buildScanSettingsXml(settings);

  // 1. Create the scan job.
  const create = withTimeout(15000);
  let location;
  try {
    const res = await fetch(`http://${ip}/eSCL/ScanJobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body,
      signal: create.signal,
    });
    if (res.status !== 201) {
      const text = await res.text().catch(() => '');
      throw new Error(`Scanner rejected the job (HTTP ${res.status}). ${text.slice(0, 200)}`);
    }
    location = res.headers.get('location');
    if (!location) throw new Error('Scanner did not return a job Location header.');
    // Some firmwares return only a path; make it absolute.
    if (location.startsWith('/')) location = `http://${ip}${location}`;
  } finally {
    create.done();
  }

  log.info(`eSCL job created: ${location}`);

  // 2. Pull pages via NextDocument until the scanner says there are no more.
  const pages = [];
  const MAX_PAGES = 100;
  while (pages.length < MAX_PAGES) {
    if (Date.now() > deadline) throw new Error('Scan timed out while fetching pages.');

    const t = withTimeout(Math.max(5000, deadline - Date.now()));
    let res;
    try {
      res = await fetch(`${location}/NextDocument`, { signal: t.signal });
    } finally {
      t.done();
    }

    if (res.status === 404 || res.status === 410) break;      // no more pages
    if (res.status === 503) { await sleep(800); continue; }    // warming up / busy
    if (!res.ok) throw new Error(`NextDocument failed (HTTP ${res.status}).`);

    const type = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) break;
    pages.push({ type, buf });
    log.info(`  page ${pages.length} (${type}, ${buf.length} bytes)`);
  }

  // 3. Best-effort cleanup.
  try { await fetch(location, { method: 'DELETE' }); } catch { /* ignore */ }

  if (pages.length === 0) {
    throw new Error('No pages were produced. Is paper loaded in the feeder?');
  }
  return pages;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

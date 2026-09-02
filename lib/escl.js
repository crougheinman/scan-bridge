// Minimal eSCL / AirScan client. Works against any eSCL-capable network scanner
// (Brother, HP, Canon, ...). Returns raw page buffers; the caller assembles them
// into a PDF.
import { config, pageDimensions, esclColorMode } from './config.js';
import { log } from './log.js';

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Nudge a sleeping scanner awake with a cheap request. Errors are swallowed —
 * this is best-effort; the real call that follows does the retrying.
 */
export async function wake(ip) {
  const t = withTimeout(4000);
  try {
    await fetch(`http://${ip}/eSCL/ScannerStatus`, { signal: t.signal });
  } catch {
    /* ignore — device may be waking */
  } finally {
    t.done();
  }
}

/**
 * Read the scanner's live eSCL ScannerStatus: overall state and ADF (feeder)
 * state. Returns { ok, state, adfState } — adfState is null on devices without
 * an ADF. Used to give a clear "feeder empty" message before a Feeder job.
 */
export async function status(ip, timeoutMs = 8000) {
  const t = withTimeout(timeoutMs);
  try {
    const res = await fetch(`http://${ip}/eSCL/ScannerStatus`, { signal: t.signal });
    if (!res.ok) return { ok: false };
    const xml = await res.text();
    const state = (xml.match(/<(?:[\w]+:)?State>([^<]+)/i) || [])[1];
    const adf = (xml.match(/<(?:[\w]+:)?AdfState>([^<]+)/i) || [])[1];
    return { ok: true, state: state ? state.trim() : null, adfState: adf ? adf.trim() : null };
  } catch {
    return { ok: false };
  } finally {
    t.done();
  }
}

const SCAN_NS = 'http://schemas.hp.com/imaging/escl/2011/05/03';
const PWG_NS = 'http://www.pwg.org/schemas/2010/12/sm';

// Summarize a scanner error response, pulling any eSCL/HP error code out of the
// XML body so logs show something more useful than namespace declarations.
function describeScanError(status, text) {
  // HP/eSCL error bodies start with namespace + version/date boilerplate, so dump
  // a generous slice to capture whatever detail element carries the real reason.
  const body = (text || '').replace(/\s+/g, ' ').trim();
  return `HTTP ${status}. ${body.slice(0, 1500)}`;
}

function buildScanSettingsXml(settings, includeRegion = true) {
  const dpi = Math.max(100, Math.min(600, parseInt(settings.resolution, 10) || 300));
  const color = esclColorMode(settings.colorMode);
  const input = (settings.inputSource || 'Feeder') === 'Platen' ? 'Platen' : 'Feeder';
  const duplex = input === 'Feeder' && !!settings.duplex;
  const { width, height } = pageDimensions(settings.pageSize);

  // An explicit scan region is advisory (MustHonor=false), but some firmwares
  // (notably HP) reject it with a 409 anyway; the caller can omit it to fall
  // back to the device's default region for the chosen source.
  const regionXml = includeRegion ? `
  <pwg:ScanRegions pwg:MustHonor="false">
    <pwg:ScanRegion>
      <pwg:Height>${height}</pwg:Height>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
      <pwg:Width>${width}</pwg:Width>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
    </pwg:ScanRegion>
  </pwg:ScanRegions>` : '';

  // Element order matters: the eSCL ScanSettings XSD defines a strict sequence,
  // and picky firmwares (e.g. Brother) silently ignore an out-of-order element
  // and fall back to its default — notably InputSource, which would otherwise
  // make an "ADF" request scan from the flatbed. Order below follows the spec:
  // Version, Intent, ScanRegions, DocumentFormat(Ext), InputSource, X/YResolution,
  // ColorMode, Duplex.
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="${SCAN_NS}" xmlns:pwg="${PWG_NS}">
  <pwg:Version>2.6</pwg:Version>
  <scan:Intent>Document</scan:Intent>${regionXml}
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
  <pwg:InputSource>${input}</pwg:InputSource>
  <scan:XResolution>${dpi}</scan:XResolution>
  <scan:YResolution>${dpi}</scan:YResolution>
  <scan:ColorMode>${color}</scan:ColorMode>
  <scan:Duplex>${duplex ? 'true' : 'false'}</scan:Duplex>
</scan:ScanSettings>`;
}

/**
 * Probe a scanner for eSCL support / reachability.
 * @returns {Promise<{reachable: boolean, esclSupported: boolean, model: string|null, error: string|null}>}
 */
export async function probe(ip, timeoutMs = config.esclProbeTimeoutMs, retries = config.esclWakeRetries) {
  const url = `http://${ip}/eSCL/ScannerCapabilities`;
  let lastError = 'unknown error';

  // A sleeping scanner answers ping but stalls on the first HTTP call; the call
  // itself wakes it, so a retry usually succeeds.
  for (let attempt = 1; attempt <= Math.max(1, retries); attempt++) {
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
      lastError = String(err.message || err);
      if (attempt < retries) {
        log.info(`Scanner didn't answer (attempt ${attempt}/${retries}) — waking and retrying…`);
        await sleep(config.esclRetryDelayMs);
      }
    } finally {
      t.done();
    }
  }

  return { reachable: false, esclSupported: false, model: null, error: lastError };
}

/**
 * Run a scan job and collect all pages.
 * @returns {Promise<Array<{type: string, buf: Buffer}>>}
 */
export async function scan(ip, settings, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let body = buildScanSettingsXml(settings, true);
  let triedNoRegion = false;
  const wantFeeder = (settings.inputSource || 'Feeder') !== 'Platen';

  // Nudge a sleeping scanner before asking it to scan.
  await wake(ip);

  // An ADF (Feeder) scan with an empty feeder is the most common cause of an
  // immediate 409 on HP devices — check first and fail with a clear message
  // instead of a cryptic conflict.
  if (wantFeeder) {
    const st = await status(ip);
    if (st.ok) {
      log.info(`Scanner status: state=${st.state || '?'} adf=${st.adfState || 'n/a'}`);
      if (st.adfState && /empty/i.test(st.adfState)) {
        throw new Error('The document feeder (ADF) is empty. Load the pages into the feeder and press Scan again.');
      }
    }
  }

  // 1. Create the scan job, retrying through the wake-up window. A thrown error
  // (timeout / connection reset) or a transient 503 means "still waking" — retry.
  // Any other non-201 is a real rejection and is surfaced immediately.
  let location;
  const retries = Math.max(1, config.esclWakeRetries);
  for (let attempt = 1; attempt <= retries; attempt++) {
    const create = withTimeout(20000);
    try {
      const res = await fetch(`http://${ip}/eSCL/ScanJobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body,
        signal: create.signal,
      });

      if (res.status === 201) {
        location = res.headers.get('location');
        if (!location) throw new Error('Scanner did not return a job Location header.');
        // Some firmwares return only a path; make it absolute.
        if (location.startsWith('/')) location = `http://${ip}${location}`;
        break;
      }

      const text = await res.text().catch(() => '');

      // Busy / warming up — wait and retry.
      if (res.status === 503 && attempt < retries) {
        log.info(`Scanner busy/waking (503) on create (attempt ${attempt}/${retries}) — retrying…`);
        await sleep(config.esclRetryDelayMs);
        continue;
      }

      // 409 Conflict (common on HP): a stale/active job, or settings the device
      // won't accept. Log the device's real error, drop the explicit ScanRegions
      // once (a frequent HP 409 cause — it then uses its default region), retry.
      if (res.status === 409 && attempt < retries) {
        log.warn(`Scanner returned 409 on create (attempt ${attempt}/${retries}): ${describeScanError(res.status, text)}`);
        if (!triedNoRegion) {
          triedNoRegion = true;
          body = buildScanSettingsXml(settings, false);
          log.info('Retrying without an explicit scan region (device default).');
        }
        await sleep(config.esclRetryDelayMs);
        continue;
      }

      throw new Error(`Scanner rejected the job (${describeScanError(res.status, text)})`);
    } catch (err) {
      // res.status !== 201 throws above; only retry connection/timeout errors.
      const isHttpReject = /rejected the job|Location header/i.test(String(err.message || ''));
      if (isHttpReject || attempt >= retries) throw err;
      log.info(`Create job didn't answer (attempt ${attempt}/${retries}) — waking and retrying…`);
      await wake(ip);
      await sleep(config.esclRetryDelayMs);
    } finally {
      create.done();
    }
  }

  if (!location) throw new Error('Could not start a scan job after retries.');

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

// HTTP client for the admin scan API. All calls are authenticated with this
// store's bridge key in the X-Scan-Key header; the admin resolves the bridge
// and its store from that key.
import { config } from './config.js';

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

function headers(extra = {}) {
  return { 'X-Scan-Key': config.scanKey, ...extra };
}

async function postJson(path, payload, timeoutMs = 15000) {
  const t = withTimeout(timeoutMs);
  try {
    const res = await fetch(`${config.adminUrl}${path}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: t.signal,
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { ok: res.ok, status: res.status, body };
  } finally {
    t.done();
  }
}

/** Claim the next queued job. Returns the job object or null. */
export async function claim() {
  const { ok, status, body } = await postJson('/api/scan/claim', {
    bridge_id: config.bridgeId,
    store_id: config.storeId,
  });
  if (!ok) throw new Error(`claim failed (HTTP ${status}): ${JSON.stringify(body)}`);
  return body && body.job ? body.job : null;
}

/** Upload a finished scan PDF. */
export async function uploadResult(jobId, bytes, pageCount) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), `scan-${jobId}.pdf`);
  if (pageCount != null) form.append('pages', String(pageCount));

  const t = withTimeout(60000);
  try {
    const res = await fetch(`${config.adminUrl}/api/scan/result/${jobId}`, {
      method: 'POST',
      headers: headers(), // let fetch set the multipart boundary
      body: form,
      signal: t.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`result upload failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    t.done();
  }
}

/** Report a job failure. */
export async function reportFailure(jobId, message) {
  await postJson(`/api/scan/fail/${jobId}`, { error: String(message).slice(0, 1900) }).catch(() => {});
}

/** Send a heartbeat with bridge + scanner status. */
export async function heartbeat(status) {
  return postJson('/api/scan/heartbeat', {
    bridge_id: config.bridgeId,
    store_id: config.storeId,
    label: config.bridgeLabel,
    scanner_ip: status.scannerIp ?? config.scannerIp,
    mode: config.mode,
    scanner_reachable: !!status.scannerReachable,
    escl_supported: status.esclSupported ?? null,
    version: config.version,
    note: status.note ?? null,
  }, 10000).catch((e) => ({ ok: false, error: String(e.message || e) }));
}

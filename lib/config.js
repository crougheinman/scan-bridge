// Loads .env (no external dependency) and exposes a typed-ish config object.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadDotEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const e = (k, d = '') => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const n = (k, d) => {
  const v = parseInt(e(k, ''), 10);
  return Number.isFinite(v) ? v : d;
};

export const config = {
  adminUrl: e('ADMIN_URL').replace(/\/+$/, ''),
  scanKey: e('SCAN_KEY'),
  bridgeId: e('BRIDGE_ID', 'scan-bridge'),
  bridgeLabel: e('BRIDGE_LABEL', ''),
  storeId: e('STORE_ID') ? n('STORE_ID', null) : null,

  mode: e('SCAN_MODE', 'escl').toLowerCase(),

  scannerIp: e('SCANNER_IP'),
  scannerMdnsName: e('SCANNER_MDNS_NAME'),

  naps2Path: e('NAPS2_PATH'),
  naps2Profile: e('NAPS2_PROFILE'),

  pollIntervalMs: n('POLL_INTERVAL_MS', 4000),
  heartbeatIntervalMs: n('HEARTBEAT_INTERVAL_MS', 30000),
  scanTimeoutMs: n('SCAN_TIMEOUT_MS', 120000),

  // Deep-sleep tolerance: a sleeping scanner answers ping but is slow/silent on
  // HTTP. We wake it and retry instead of declaring it unreachable.
  esclProbeTimeoutMs: n('ESCL_PROBE_TIMEOUT_MS', 10000),
  esclWakeRetries: n('ESCL_WAKE_RETRIES', 3),
  esclRetryDelayMs: n('ESCL_RETRY_DELAY_MS', 2000),

  version: '0.1.0',
};

export function validateConfig() {
  const problems = [];
  if (!config.adminUrl) problems.push('ADMIN_URL is required.');
  if (!config.scanKey) problems.push('SCAN_KEY is required (must match scan.bridgeKey in the admin).');
  if (!['escl', 'naps2', 'mock'].includes(config.mode)) {
    problems.push(`SCAN_MODE must be escl | naps2 | mock (got "${config.mode}").`);
  }
  if (config.mode === 'escl' && !config.scannerIp && !config.scannerMdnsName) {
    problems.push('SCAN_MODE=escl needs SCANNER_IP (or SCANNER_MDNS_NAME).');
  }
  if (config.mode === 'naps2' && !config.naps2Path) {
    problems.push('SCAN_MODE=naps2 needs NAPS2_PATH.');
  }
  return problems;
}

// Page sizes in 1/300-inch units (eSCL ScanRegion ContentRegionUnits).
export function pageDimensions(pageSize) {
  switch ((pageSize || 'Letter').toLowerCase()) {
    case 'legal': return { width: 2550, height: 4200 };   // 8.5 x 14 in
    case 'a4':    return { width: 2481, height: 3507 };   // 210 x 297 mm
    case 'letter':
    default:      return { width: 2550, height: 3300 };   // 8.5 x 11 in
  }
}

// Admin color choice -> eSCL ColorMode. JPEG output can't be 1-bit, so
// "BlackAndWhite" is rendered as 8-bit grayscale.
export function esclColorMode(colorMode) {
  switch ((colorMode || 'Gray').toLowerCase()) {
    case 'color': return 'RGB24';
    case 'blackandwhite':
    case 'gray':
    default:      return 'Grayscale8';
  }
}

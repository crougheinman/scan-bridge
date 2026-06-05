// Magic Ops scan bridge — main loop.
// Polls the admin for scan jobs, drives the scanner, uploads the PDF back.
//
// Flags:
//   --probe   probe the scanner and exit (0 = reachable, 2 = not)
//   --once    process at most one queued job, then exit (handy for testing)
import { config, validateConfig } from './lib/config.js';
import { log } from './lib/log.js';
import * as admin from './lib/admin.js';
import * as escl from './lib/escl.js';
import * as naps2 from './lib/naps2.js';
import * as mock from './lib/mock.js';
import { assemblePdf } from './lib/pdf.js';
import { resolveScannerIp } from './lib/discover.js';

const argv = process.argv.slice(2);
const ONCE = argv.includes('--once');
const PROBE_ONLY = argv.includes('--probe');

let currentIp = config.scannerIp;
let lastStatus = { scannerReachable: false, esclSupported: null, scannerIp: currentIp, note: null };

async function refreshScannerStatus() {
  if (config.mode === 'escl') {
    let p = await escl.probe(currentIp);
    // DHCP may have moved the scanner — try mDNS discovery if configured.
    if (!p.reachable && config.scannerMdnsName) {
      const found = await resolveScannerIp(config.scannerMdnsName);
      if (found && found !== currentIp) {
        log.info(`mDNS found scanner at ${found} (was ${currentIp}).`);
        currentIp = found;
        p = await escl.probe(currentIp);
      }
    }
    lastStatus = {
      scannerReachable: p.reachable && p.esclSupported,
      esclSupported: p.esclSupported,
      scannerIp: currentIp,
      note: p.model || p.error,
    };
  } else if (config.mode === 'naps2') {
    lastStatus = { scannerReachable: true, esclSupported: null, scannerIp: null, note: 'NAPS2 mode' };
  } else {
    lastStatus = { scannerReachable: true, esclSupported: null, scannerIp: null, note: 'MOCK mode (no real scanner)' };
  }
  return lastStatus;
}

async function produceScan(job) {
  const settings = job.settings || {};
  if (config.mode === 'mock') return mock.scan(job);
  if (config.mode === 'naps2') return naps2.scan(settings, config.scanTimeoutMs);
  const pages = await escl.scan(currentIp, settings, config.scanTimeoutMs);
  return assemblePdf(pages);
}

async function processJob(job) {
  log.info(`Claimed job #${job.id} — settings ${JSON.stringify(job.settings)}`);
  try {
    const { bytes, pageCount } = await produceScan(job);
    log.info(`Scan produced ${pageCount ?? '?'} page(s), ${bytes.length} bytes. Uploading…`);
    await admin.uploadResult(job.id, bytes, pageCount);
    log.info(`Job #${job.id} done.`);
  } catch (err) {
    log.error(`Job #${job.id} failed: ${err.message}`);
    await admin.reportFailure(job.id, err.message);
  }
}

async function pollOnce() {
  let job;
  try {
    job = await admin.claim();
  } catch (err) {
    log.warn(`claim error: ${err.message}`);
    return false;
  }
  if (!job) return false;
  await processJob(job);
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const problems = validateConfig();
  if (problems.length) {
    problems.forEach((p) => log.error(p));
    process.exit(1);
  }

  log.info(`Scan bridge ${config.version} — mode=${config.mode} bridge=${config.bridgeId} admin=${config.adminUrl}`);

  await refreshScannerStatus();
  log.info(`Scanner: reachable=${lastStatus.scannerReachable} escl=${lastStatus.esclSupported} ip=${lastStatus.scannerIp} note=${lastStatus.note}`);

  if (PROBE_ONLY) process.exit(lastStatus.scannerReachable ? 0 : 2);

  await admin.heartbeat(lastStatus);

  if (ONCE) {
    const did = await pollOnce();
    log.info(did ? 'Processed one job (--once).' : 'No queued jobs (--once).');
    process.exit(0);
  }

  setInterval(async () => {
    try {
      await refreshScannerStatus();
      await admin.heartbeat(lastStatus);
    } catch (e) {
      log.warn(`heartbeat loop: ${e.message}`);
    }
  }, config.heartbeatIntervalMs);

  process.on('SIGINT', () => { log.info('Shutting down…'); process.exit(0); });

  log.info('Polling for scan jobs… (Ctrl+C to stop)');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const did = await pollOnce();
    if (!did) await sleep(config.pollIntervalMs);
  }
}

main().catch((err) => {
  log.error(`fatal: ${err.stack || err.message}`);
  process.exit(1);
});

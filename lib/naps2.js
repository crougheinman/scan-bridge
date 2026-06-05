// NAPS2 Console fallback for USB scanners (or when eSCL is unavailable).
// Requires NAPS2 to be installed on the bridge PC. The most reliable setup is to
// configure a scan profile once in the NAPS2 GUI and reference it via NAPS2_PROFILE.
import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { config } from './config.js';
import { log } from './log.js';

function bitdepth(colorMode) {
  switch ((colorMode || 'Gray').toLowerCase()) {
    case 'color': return 'color';
    case 'blackandwhite': return 'bw';
    default: return 'gray';
  }
}

export async function scan(settings, timeoutMs = 120000) {
  const outPath = join(tmpdir(), `scan-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`);

  const args = ['-o', outPath, '--force'];
  if (config.naps2Profile) {
    args.push('-p', config.naps2Profile);
  } else {
    // Best-effort generic invocation. A configured profile (NAPS2_PROFILE) is
    // far more reliable than these flags, which depend on the NAPS2 version.
    const dpi = Math.max(100, Math.min(600, parseInt(settings.resolution, 10) || 300));
    args.push('--driver', 'wia', '--dpi', String(dpi), '--bitdepth', bitdepth(settings.colorMode));
    if ((settings.inputSource || 'Feeder') === 'Feeder') args.push('--source', 'glass'); // overridden below
  }

  log.info(`NAPS2: ${config.naps2Path} ${args.join(' ')}`);

  await new Promise((resolve, reject) => {
    const child = spawn(config.naps2Path, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('NAPS2 timed out.')); }, timeoutMs);
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`Could not run NAPS2: ${err.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`NAPS2 exited ${code}. ${stderr.slice(0, 300)}`));
    });
  });

  const bytes = await readFile(outPath);
  await unlink(outPath).catch(() => {});
  if (!bytes || bytes.length === 0) throw new Error('NAPS2 produced an empty file (no paper?).');

  let pageCount = null;
  try { pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount(); } catch { /* ignore */ }

  return { bytes: new Uint8Array(bytes), pageCount };
}

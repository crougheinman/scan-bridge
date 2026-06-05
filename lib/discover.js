// Optional mDNS discovery: find the scanner's current IP by its eSCL service
// name when DHCP has moved it. Uses the optional "bonjour-service" dependency;
// if that isn't installed, discovery is simply unavailable (returns null).
import { log } from './log.js';

export async function resolveScannerIp(serviceName, timeoutMs = 4000) {
  if (!serviceName) return null;

  let Bonjour;
  try {
    ({ Bonjour } = await import('bonjour-service'));
  } catch {
    log.warn('mDNS discovery unavailable (optional "bonjour-service" not installed). Run: npm install bonjour-service');
    return null;
  }

  return new Promise((resolve) => {
    const instance = new Bonjour();
    let settled = false;
    const finish = (ip) => {
      if (settled) return;
      settled = true;
      try { browser.stop(); instance.destroy(); } catch { /* ignore */ }
      resolve(ip);
    };

    // eSCL advertises over _uscan._tcp.
    const browser = instance.find({ type: 'uscan', protocol: 'tcp' }, (service) => {
      const name = (service.name || '').toLowerCase();
      if (name.includes(serviceName.toLowerCase())) {
        const ip = (service.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
        if (ip) finish(ip);
      }
    });

    setTimeout(() => finish(null), timeoutMs);
  });
}

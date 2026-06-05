# Magic Ops — Scan Bridge

A small Node agent that runs on a store PC (next to the scanner) and connects the
admin's **Scan** button to the physical scanner. The admin (on the VPS) cannot
reach a scanner on a store's private LAN, so this bridge does the work:

1. Polls the admin for queued scan jobs (`POST /api/scan/claim`).
2. Drives the scanner — over **eSCL/AirScan** (network scanners) or **NAPS2**
   (USB scanners) — and gets a multi-page PDF.
3. Uploads the PDF back (`POST /api/scan/result/{id}`), or reports a failure
   (`POST /api/scan/fail/{id}`).
4. Sends a heartbeat (`POST /api/scan/heartbeat`) so the admin can show whether
   the bridge and scanner are online.

All calls use outbound HTTPS and a shared secret (`X-Scan-Key`) — no inbound
ports, nothing exposed to the internet, same model as the PrintNode bridge.

## Requirements
- Node.js 18+ on the store PC.
- Network line of sight to the scanner (same LAN) for eSCL, **or** a USB scanner
  with NAPS2 installed for the NAPS2 fallback.

## Setup
```bash
cd scan-bridge
npm install
cp .env.example .env      # then edit .env
```

Fill in `.env`:
- `ADMIN_URL` — the admin base URL (VPS).
- `SCAN_KEY` — must equal `scan.bridgeKey` in the admin's `.env`.
- `BRIDGE_ID` / `BRIDGE_LABEL` — identify this PC.
- `SCAN_MODE` — `escl` (network), `naps2` (USB), or `mock` (no scanner, for testing).
- `SCANNER_IP` — for eSCL (e.g. `192.168.0.204`).

## Run
```bash
npm start            # run the bridge (polls forever)
npm run probe        # just check whether the scanner is reachable, then exit
npm run scan-once    # process at most one queued job, then exit (testing)
```
Keep it running with a process manager (Windows Task Scheduler "at logon", `pm2`,
or `nssm` as a service) so it survives reboots.

## Modes

### `escl` (recommended for the networked Brother MFC-L2820DW)
Scans over HTTP to `SCANNER_IP`. **Honest note:** I could not verify from outside
the store LAN that this exact model answers eSCL. Run `npm run probe` on the store
PC — if it prints `reachable=true escl=true`, you're good. If not, use `naps2`.
The bridge requests `image/jpeg` pages and assembles them into one PDF (the most
universal eSCL path).

DHCP: the scanner panel shows *Boot Method = Auto*, so its IP can change. Set a
DHCP reservation on the router, or set `SCANNER_MDNS_NAME` and run
`npm install bonjour-service` so the bridge can rediscover it by name.

### `naps2` (USB scanners, or if eSCL is absent)
Shells out to `NAPS2.Console.exe`. Install NAPS2, then the reliable path is to
configure a **profile** once in the NAPS2 GUI and set `NAPS2_PROFILE` to its name.
Set `NAPS2_PATH` to the console executable.

### `mock` (dry-run, no scanner)
Generates a sample 2-page PDF instead of scanning. Use this to prove the whole
pipeline (Scan button → job → upload → viewable PDF) before any hardware is wired
in. Set `SCAN_MODE=mock` and press **Scan** in the admin.

## Notes
- One job at a time; the admin hands out jobs atomically, so two bridges can't
  grab the same one. A job that's claimed but never finished (bridge crash) is
  returned to the queue automatically after a few minutes.
- A remotely-pressed Scan button cannot load paper — someone at the store must
  load the packet into the feeder first.

// Minimal timestamped logger.
function stamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}
export const log = {
  info: (...a) => console.log(`[${stamp()}]`, ...a),
  warn: (...a) => console.warn(`[${stamp()}] WARN`, ...a),
  error: (...a) => console.error(`[${stamp()}] ERROR`, ...a),
};

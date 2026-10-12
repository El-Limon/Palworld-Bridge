/**
 * Which Takaro WebSocket endpoint to connect to.
 *
 * Production Takaro is the default. TAKARO_WS_URL (TakaroConfig.txt or environment)
 * points the bridge at another Takaro, for example a staging or self-hosted instance.
 * Only ws:// and wss:// URLs are accepted; anything else falls back to the default.
 */
export const DEFAULT_TAKARO_WS_URL = 'wss://connect.takaro.io/';

export function resolveTakaroWsUrl(value: string | undefined): string {
  const raw = (value || '').trim();
  if (!raw) return DEFAULT_TAKARO_WS_URL;
  try {
    const url = new URL(raw);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return url.toString();
  } catch {
    // fall through
  }
  return DEFAULT_TAKARO_WS_URL;
}

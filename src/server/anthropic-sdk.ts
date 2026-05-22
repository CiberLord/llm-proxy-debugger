// Pure helpers for the direct `anthropic` provider (see handleAnthropicDirect).

/**
 * Normalize a configured base URL for the official Anthropic SDK.
 *
 * The SDK always appends `/v1/messages` itself, so its `baseURL` must be the
 * host root. Our env convention keeps the `/v1` segment in
 * `ANTHROPIC_TARGET_BASE_URL` (e.g. `https://api.anthropic.com/v1`), so a
 * trailing `/v1` is stripped here. URLs without it are returned unchanged.
 */
export function anthropicSdkBaseUrl(configured: string): string {
  let b = configured.trim().replace(/\/+$/, "");
  if (/\/v1$/i.test(b)) b = b.slice(0, -3);
  return b.replace(/\/+$/, "");
}

/**
 * Re-encode an Anthropic SDK stream event back to its wire SSE representation:
 * an `event:` line naming the event type plus a JSON `data:` line.
 */
export function serializeAnthropicSSE(event: { type: string }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

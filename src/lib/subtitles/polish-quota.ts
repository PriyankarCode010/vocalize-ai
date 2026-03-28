/** Per-server-instance cooldown after Gemini 429 so we don't hammer the API (and Vercel logs). */
let skipGeminiUntil = 0

const DEFAULT_COOLDOWN_MS = 90_000

export function isSubtitlePolishCoolingDown(): boolean {
  return Date.now() < skipGeminiUntil
}

export function startSubtitlePolishCooldown(ms: number = DEFAULT_COOLDOWN_MS): void {
  skipGeminiUntil = Date.now() + ms
}

export function isGeminiQuotaError(e: unknown): boolean {
  if (typeof e === "object" && e !== null && "status" in e) {
    const s = (e as { status?: number }).status
    if (s === 429) return true
  }
  const msg = e instanceof Error ? e.message : String(e)
  return /\b429\b|Too Many Requests|quota exceeded|Resource exhausted/i.test(msg)
}

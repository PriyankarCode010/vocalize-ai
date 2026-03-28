import { GoogleGenerativeAI } from "@google/generative-ai"
import { NextResponse } from "next/server"
import { buildSubtitlePolishPrompt } from "@/lib/subtitles/polish-prompt"
import {
  isGeminiQuotaError,
  isSubtitlePolishCoolingDown,
  startSubtitlePolishCooldown,
} from "@/lib/subtitles/polish-quota"

const MAX_INPUT = 2000

/** Default model: 1.5-flash often has separate free-tier quota from 2.0-flash. Override with GEMINI_SUBTITLE_MODEL. */
const DEFAULT_MODEL = "gemini-1.5-flash"

/**
 * POST { text: string } → { polished: string, quotaExceeded?: boolean }
 * Server-only GEMINI_API_KEY. If unset, returns input unchanged (no error).
 *
 * Env: GEMINI_API_KEY, GEMINI_SUBTITLE_MODEL (default gemini-1.5-flash)
 */
export async function POST(request: Request) {
  let text = ""
  try {
    const body = await request.json()
    text = typeof body.text === "string" ? body.text : ""
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const trimmed = text.trim()
  if (!trimmed) {
    return NextResponse.json({ polished: "" })
  }
  if (trimmed.length > MAX_INPUT) {
    return NextResponse.json({ error: `Text too long (max ${MAX_INPUT})` }, { status: 413 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.log("[subtitles/polish] no GEMINI_API_KEY — passthrough (in === out):", JSON.stringify(trimmed))
    return NextResponse.json({ polished: trimmed })
  }

  if (isSubtitlePolishCoolingDown()) {
    return NextResponse.json({
      polished: trimmed,
      quotaExceeded: true,
      skippedReason: "server_cooldown",
    })
  }

  const modelName = process.env.GEMINI_SUBTITLE_MODEL?.trim() || DEFAULT_MODEL

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0.15,
      },
    })

    const result = await model.generateContent(buildSubtitlePolishPrompt(trimmed))
    const response = result.response
    let out = response.text().trim()
    out = out.replace(/^["'`]+|["'`]+$/g, "").trim()
    const polished = out || trimmed
    console.log("[subtitles/polish] model:", modelName)
    console.log("[subtitles/polish] IN :", trimmed)
    console.log("[subtitles/polish] OUT:", polished)
    return NextResponse.json({ polished })
  } catch (e) {
    if (isGeminiQuotaError(e)) {
      startSubtitlePolishCooldown()
      console.warn(
        "[subtitles/polish] Gemini quota/rate limit (429) — passthrough for ~90s. Try GEMINI_SUBTITLE_MODEL=gemini-1.5-flash-8b or enable billing:",
        modelName
      )
      return NextResponse.json({ polished: trimmed, quotaExceeded: true })
    }
    console.error("[api/subtitles/polish] error, returning raw input:", e instanceof Error ? e.message : e)
    return NextResponse.json({ polished: trimmed })
  }
}

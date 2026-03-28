import { GoogleGenerativeAI } from "@google/generative-ai"
import { NextResponse } from "next/server"
import { buildSubtitlePolishPrompt } from "@/lib/subtitles/polish-prompt"

const MAX_INPUT = 2000

/**
 * POST { text: string } → { polished: string }
 * Server-only GEMINI_API_KEY. If unset, returns input unchanged (no error).
 *
 * Optional env: GEMINI_SUBTITLE_MODEL (default gemini-2.0-flash)
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

  const modelName = process.env.GEMINI_SUBTITLE_MODEL || "gemini-2.0-flash"

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
    console.error("[api/subtitles/polish] error, returning raw input:", e)
    console.log("[subtitles/polish] IN (fallback):", trimmed)
    return NextResponse.json({ polished: trimmed })
  }
}

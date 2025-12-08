import { NextResponse } from "next/server"

type MockSequence = {
  prediction: string
  confidence: number
  streak: number
  history: string[]
}

const SAMPLE_GESTURES = ["Hello", "Thank You", "Yes", "No", "Please", "Goodbye", "Sorry", "Help"]

function generateMockPrediction(frames: number[][]): { prediction: string; confidence: number; sequence: MockSequence | null } {
  const frameCount = Math.max(frames.length, 1)
  const flattenedPoints = frames.reduce((sum, frame) => sum + frame.length, 0)
  const baseIndex = flattenedPoints % SAMPLE_GESTURES.length
  const prediction = SAMPLE_GESTURES[baseIndex]

  const confidence = Number(Math.min(0.95, 0.45 + frameCount * 0.04).toFixed(2))

  if (frameCount < 4) {
    return { prediction, confidence, sequence: null }
  }

  const historyLength = Math.min(frameCount, 6)
  const history = Array.from({ length: historyLength }, (_, idx) => SAMPLE_GESTURES[(baseIndex + idx + 1) % SAMPLE_GESTURES.length])

  return {
    prediction,
    confidence,
    sequence: {
      prediction,
      confidence: Number(Math.min(0.99, confidence + 0.05).toFixed(2)),
      streak: Math.min(frameCount, 10),
      history,
    },
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { landmarks } = body ?? {}

    if (!Array.isArray(landmarks) || landmarks.length === 0) {
      return NextResponse.json({ error: "Invalid landmarks payload" }, { status: 400 })
    }

    const mockResult = generateMockPrediction(landmarks)
    return NextResponse.json(mockResult)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: "Prediction failed", details: message }, { status: 500 })
  }
}

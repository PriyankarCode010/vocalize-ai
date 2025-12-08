// src/app/api/process-hand/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { landmarks } = body;

    if (!landmarks) {
      return NextResponse.json({ prediction: "No landmarks received" });
    }

    // 🔥 Here, you can call Python model using fetch/child_process later
    // For demo, just return number of landmarks
    return NextResponse.json({
      prediction: `Received ${landmarks.length} landmarks`,
    });
  } catch (err: unknown) {
    console.error("Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ prediction: "Error processing landmarks", error: message }, { status: 500 });
  }
}

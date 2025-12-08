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
  } catch (err: any) {
    console.error("Error:", err);
    return NextResponse.json({ prediction: "Error processing landmarks" });
  }
}

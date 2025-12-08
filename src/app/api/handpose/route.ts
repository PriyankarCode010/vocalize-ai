import { NextResponse } from "next/server";
import { spawn } from "child_process";

export async function POST(req: Request) {
  const start = Date.now(); // ⏱️ Start time
  try {
    const body = await req.json();
    const { landmarks } = body;

    if (!landmarks || !Array.isArray(landmarks)) {
      return NextResponse.json({ prediction: "Invalid landmarks" }, { status: 400 });
    }

    // Call Python script
    const result: any = await new Promise((resolve, reject) => {
      const py = spawn("python", ["src/python/predict.py"]);
      let data = "";
      let error = "";

      py.stdout.on("data", (chunk) => (data += chunk.toString()));
      py.stderr.on("data", (chunk) => (error += chunk.toString()));

      py.on("close", (code) => {
        const duration = Date.now() - start; // ⏱️ End time

        if (code !== 0) {
          console.error(`❌ Python failed after ${duration}ms:`, error);
          reject(error || `Python exited with code ${code}`);
        } else {
          try {
            const parsed = JSON.parse(data);
            console.log(`✅ Prediction: ${parsed.prediction} | ⏳ Took: ${duration}ms | Landmarks count: ${landmarks.length}`);
            resolve(parsed);
          } catch (err) {
            reject(`Invalid JSON from Python: ${data}`);
          }
        }
      });

      // Send JSON to Python via stdin
      py.stdin.write(JSON.stringify({ landmarks }));
      py.stdin.end();
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const duration = Date.now() - start;
    console.error(`❌ API error after ${duration}ms:`, error);
    return NextResponse.json(
      { prediction: "Error processing landmarks", error: error.toString() },
      { status: 500 }
    );
  }
}

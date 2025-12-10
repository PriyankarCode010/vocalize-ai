"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Camera, Cpu, PlayCircle, Square } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

type Detection = {
  x1: number
  y1: number
  x2: number
  y2: number
  confidence: number
  class: number
  name: string
}

const FALLBACK_API_BASE = "http://localhost:8000"

export default function Yolo11CameraDemo() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const runningRef = useRef(false)

  const [cameraReady, setCameraReady] = useState(false)
  const [isCameraLoading, setIsCameraLoading] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [latency, setLatency] = useState<number | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [detections, setDetections] = useState<Detection[]>([])

  const detectEndpoint = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_YOLO_API_URL || FALLBACK_API_BASE
    return `${base.replace(/\/$/, "")}/detect`
  }, [])

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }
    setCameraReady(false)
  }, [])

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined") {
      setCameraError("Camera is not available in this environment.")
      return null
    }

    try {
      setIsCameraLoading(true)
      setCameraError(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      cameraStreamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play()
      }
      setCameraReady(true)
      return stream
    } catch (error) {
      console.error("Unable to start camera", error)
      setCameraError("Unable to access camera. Please grant permissions and retry.")
      setCameraReady(false)
      return null
    } finally {
      setIsCameraLoading(false)
    }
  }, [])

  const stopDetection = useCallback(() => {
    runningRef.current = false
    setIsRunning(false)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const startDetection = useCallback(async () => {
    if (runningRef.current) return

    if (!cameraReady) {
      const stream = await startCamera()
      if (!stream) {
        return
      }
    }

    runningRef.current = true
    setIsRunning(true)
    setRequestError(null)

    const detectFrame = async () => {
      if (!runningRef.current) return

      const video = videoRef.current
      const canvas = canvasRef.current

      if (!video || !canvas) {
        stopDetection()
        return
      }

      if (video.readyState < 2) {
        rafRef.current = requestAnimationFrame(() => {
          void detectFrame()
        })
        return
      }

      const ctx = canvas.getContext("2d")
      if (!ctx) {
        stopDetection()
        return
      }

      const width = video.videoWidth || 640
      const height = video.videoHeight || 480
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height

      ctx.drawImage(video, 0, 0, width, height)

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
      if (!blob) {
        rafRef.current = requestAnimationFrame(() => {
          void detectFrame()
        })
        return
      }

      try {
        const formData = new FormData()
        formData.append("file", blob, "frame.jpg")

        const started = performance.now()
        const response = await fetch(detectEndpoint, {
          method: "POST",
          body: formData,
        })

        if (!response.ok) {
          throw new Error(`Detection failed (${response.status})`)
        }

        const payload = await response.json()
        const detectionList: Detection[] = Array.isArray(payload?.detections) ? payload.detections : []
        setDetections(detectionList)
        setLatency(performance.now() - started)
        setLastUpdated(new Date().toLocaleTimeString())
        setRequestError(null)

        ctx.drawImage(video, 0, 0, width, height)
        ctx.lineWidth = 3
        ctx.font = "16px 'JetBrains Mono', monospace"
        ctx.textBaseline = "top"

        detectionList.forEach((det) => {
          const boxWidth = det.x2 - det.x1
          const boxHeight = det.y2 - det.y1
          const label = `${det.name} ${(det.confidence * 100).toFixed(1)}%`

          ctx.strokeStyle = "#22d3ee"
          ctx.fillStyle = "rgba(34, 211, 238, 0.85)"
          ctx.strokeRect(det.x1, det.y1, boxWidth, boxHeight)

          const textWidth = ctx.measureText(label).width
          const textHeight = 20
          const textY = Math.max(det.y1 - textHeight, 0)
          ctx.fillRect(det.x1, textY, textWidth + 12, textHeight)
          ctx.fillStyle = "#0f172a"
          ctx.fillText(label, det.x1 + 6, textY + 4)
        })
      } catch (error) {
        console.error("Detection error", error)
        setRequestError(error instanceof Error ? error.message : "Detection failed.")
        stopDetection()
        return
      }

      if (runningRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          void detectFrame()
        })
      }
    }

    void detectFrame()
  }, [cameraReady, detectEndpoint, startCamera, stopDetection])

  useEffect(() => {
    void startCamera()
    return () => {
      stopDetection()
      stopCamera()
    }
  }, [startCamera, stopCamera, stopDetection])

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-muted-foreground">
            <Cpu className="h-4 w-4 text-primary" />
            YOLO11n real-time pipeline
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Vision Demo</h1>
          <p className="text-muted-foreground">
            Capture webcam frames, send them to the FastAPI YOLO endpoint, and render detections directly onto the canvas.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Camera className="h-5 w-5 text-primary" />
                Live camera feed
              </CardTitle>
              <p className="text-sm text-muted-foreground">{detectEndpoint}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant={cameraReady ? "secondary" : "destructive"}>{cameraReady ? "Camera ready" : "Camera off"}</Badge>
              <Badge variant={isRunning ? "default" : "outline"}>{isRunning ? "Detection running" : "Idle"}</Badge>
              {latency !== null && <Badge variant="outline">Latency: {latency.toFixed(0)} ms</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="relative aspect-video overflow-hidden rounded-2xl border bg-black">
              <canvas ref={canvasRef} className="h-full w-full object-contain" />
              <video ref={videoRef} className="hidden" playsInline muted />

              {!cameraReady && !cameraError && !isCameraLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center text-white">
                  <p className="text-lg font-semibold">Enable your camera to begin</p>
                  <Button onClick={() => void startCamera()} size="sm">
                    Turn on camera
                  </Button>
                </div>
              )}

              {isCameraLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-center text-white">
                  <p className="text-sm font-medium">Requesting camera access…</p>
                </div>
              )}

              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-4 text-center text-white">
                  <p className="text-sm font-medium">{cameraError}</p>
                  <Button variant="secondary" size="sm" onClick={() => void startCamera()}>
                    Retry camera
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => void startDetection()}
                disabled={isRunning || !cameraReady || isCameraLoading}
                className="flex items-center gap-2"
              >
                <PlayCircle className="h-4 w-4" />
                {isRunning ? "Running" : "Start detection"}
              </Button>
              <Button onClick={stopDetection} disabled={!isRunning} variant="outline" className="flex items-center gap-2">
                <Square className="h-4 w-4" />
                Stop detection
              </Button>
              <Button variant="ghost" onClick={() => void startCamera()} disabled={isCameraLoading} className="flex items-center gap-2">
                <Camera className="h-4 w-4" />
                {cameraReady ? "Restart camera" : "Enable camera"}
              </Button>
            </div>

            {requestError && <p className="text-sm text-destructive">{requestError}</p>}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium text-muted-foreground">Latest Detections</p>
                {detections.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">No detections yet.</p>
                ) : (
                  <ScrollArea className="mt-4 max-h-72">
                    <ul className="space-y-3 pr-4">
                      {detections.map((det, idx) => (
                        <li key={`${det.name}-${idx}`} className="rounded-lg border bg-muted/30 p-3">
                          <p className="font-medium text-sm">{det.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(det.confidence * 100).toFixed(1)}% • {`(${det.x1}, ${det.y1}) → (${det.x2}, ${det.y2})`}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                )}
              </div>

              <div className="rounded-xl border p-4 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Pipeline status</p>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Backend endpoint</span>
                    <span className="font-mono text-xs">{detectEndpoint}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Last frame</span>
                    <span>{lastUpdated ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Latency</span>
                    <span>{latency !== null ? `${latency.toFixed(0)} ms` : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Detections</span>
                    <span>{detections.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


















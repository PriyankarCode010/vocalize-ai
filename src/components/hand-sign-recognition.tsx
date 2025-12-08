"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Hand,
  Mic,
  Volume2,
  Copy,
  Wifi,
  WifiOff,
  Activity,
  MessageSquare,
  Settings,
  History,
  Camera,
} from "lucide-react"

const MODEL_OPTIONS = [
  {
    value: "yolo11",
    label: "YOLO11n vision model (model/yolo11n.pt)",
    badge: "YOLO11",
    description: "Highest accuracy option powered by the freshly added YOLO11 checkpoint.",
  },
] as const

const DEFAULT_MODEL = MODEL_OPTIONS[0]

type ModelValue = (typeof MODEL_OPTIONS)[number]["value"]

export default function HandSignRecognition() {
  const [connected, setConnected] = useState(false)
  const [prediction, setPrediction] = useState("")
  const [duration, setDuration] = useState<number | null>(null)
  const [landmarksCount, setLandmarksCount] = useState<number | null>(null)
  const [translatedText, setTranslatedText] = useState("")
  const [isListening, setIsListening] = useState(false)
  const [stablePrediction, setStablePrediction] = useState("No Hand")
  const [stableConfidence, setStableConfidence] = useState<number | null>(null)
  const [stableStreak, setStableStreak] = useState(0)
  const [sequenceHistory, setSequenceHistory] = useState<string[]>([])
  const imgRef = useRef<HTMLImageElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const lastSequenceRef = useRef<string | null>(null)
  const lastFramePredictionRef = useRef<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isCameraLoading, setIsCameraLoading] = useState(false)
  const selectedModel: ModelValue = DEFAULT_MODEL.value
  const selectedModelMeta = DEFAULT_MODEL

  const shouldUseLiveWS =
    Boolean(process.env.NEXT_PUBLIC_BACKEND_WS_URL) || Boolean(process.env.NEXT_PUBLIC_BACKEND_HOST)

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }
    setCameraStream(null)
    setCameraReady(false)
  }, [])

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || typeof window === "undefined") {
      return null
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera capture is not supported in this browser.")
      return null
    }

    if (cameraStreamRef.current) {
      setCameraReady(true)
      setCameraError(null)
      return cameraStreamRef.current
    }

    try {
      setIsCameraLoading(true)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      cameraStreamRef.current = stream
      setCameraStream(stream)
      setCameraReady(true)
      setCameraError(null)
      return stream
    } catch (error) {
      console.error("Unable to access camera", error)
      setCameraError("Unable to access camera. Please grant permission and retry.")
      setCameraReady(false)
      return null
    } finally {
      setIsCameraLoading(false)
    }
  }, [])

  useEffect(() => {
    void startCamera()
    return () => {
      stopCamera()
    }
  }, [startCamera, stopCamera])

  useEffect(() => {
    if (!videoRef.current) return

    if (cameraStream) {
      videoRef.current.srcObject = cameraStream
      const playPromise = videoRef.current.play()
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          /* autoplay failure ignored */
        })
      }
    } else {
      videoRef.current.srcObject = null
    }
  }, [cameraStream])

  const connectWS = useCallback(
    (model: ModelValue = selectedModel) => {
      if (!shouldUseLiveWS) return

      const protocol = window.location.protocol === "https:" ? "wss" : "ws"
      const backendHost = process.env.NEXT_PUBLIC_BACKEND_HOST || window.location.hostname
      const backendPort = process.env.NEXT_PUBLIC_BACKEND_WS_PORT || "8000"
      const wsUrlBase = process.env.NEXT_PUBLIC_BACKEND_WS_URL || `${protocol}://${backendHost}:${backendPort}/ws/landmarks`

      let resolvedUrl = wsUrlBase
      try {
        const parsed = new URL(wsUrlBase, window.location.href)
        parsed.searchParams.set("model", model)
        resolvedUrl = parsed.toString()
      } catch {
        const separator = wsUrlBase.includes("?") ? "&" : "?"
        resolvedUrl = `${wsUrlBase}${separator}model=${encodeURIComponent(model)}`
      }

      const ws = new WebSocket(resolvedUrl)
      console.log("🛰️ opening websocket", ws.url)
      wsRef.current = ws

      ws.onopen = () => {
        console.log("✅ WebSocket connected")
        setConnected(true)
      }

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data.error) {
            console.error("Server error:", data.error)
            return
          }

          if (data.image && imgRef.current) {
            imgRef.current.src = `data:image/jpeg;base64,${data.image}`
          }

          const newPrediction = data.prediction || "No Hand"
          const previousPrediction = lastFramePredictionRef.current
          setPrediction(newPrediction)
          lastFramePredictionRef.current = newPrediction
          console.debug("🤏 frame prediction", {
            model,
            prediction: newPrediction,
            duration: data.duration_ms,
            landmarksCount: Array.isArray(data.landmarks) ? data.landmarks.length : null,
          })

          if (!data.sequence && newPrediction !== "No Hand" && newPrediction !== previousPrediction) {
            setTranslatedText((prev) => (prev ? `${prev} ${newPrediction}` : newPrediction))
          }

          setDuration(data.duration_ms ?? null)
          setLandmarksCount(Array.isArray(data.landmarks) ? data.landmarks.length : null)

          const sequence = data.sequence
          if (sequence?.prediction) {
            setStablePrediction(sequence.prediction)
            setStableConfidence(typeof sequence.confidence === "number" ? sequence.confidence : null)
            setStableStreak(typeof sequence.streak === "number" ? sequence.streak : 0)
            if (Array.isArray(sequence.history)) {
              setSequenceHistory(sequence.history)
            }

            console.info("📡 stable sequence update", {
              model,
              prediction: sequence.prediction,
              confidence: sequence.confidence,
              streak: sequence.streak,
              history: sequence.history,
            })

            if (sequence.prediction !== "No Hand" && sequence.prediction !== lastSequenceRef.current) {
              setTranslatedText((prev) => (prev ? `${prev} ${sequence.prediction}` : sequence.prediction))
              lastSequenceRef.current = sequence.prediction
            }
          }
        } catch (err) {
          console.error("Invalid message from server", err)
        }
      }

      ws.onerror = (err) => console.error("❌ WebSocket error", err)
      ws.onclose = () => {
        console.log("🔌 WebSocket closed")
        setConnected(false)
      }
    },
    [selectedModel, shouldUseLiveWS]
  )

  const handleReconnect = () => {
    if (!shouldUseLiveWS) return
    if (wsRef.current) {
      wsRef.current.close()
    }
    connectWS(selectedModel)
  }

  // ✅ Connect once on mount (or when switching models)
  useEffect(() => {
    if (!shouldUseLiveWS) {
      setConnected(true)
      const sampleImages = [
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=60",
        "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=900&q=60",
      ]
      const gestures = ["Hello", "Thank you", "Yes", "Help", "Goodbye", "Please", "Wait", "No", "Good job"]
      let index = 0
      const interval = window.setInterval(() => {
        const nextGesture = gestures[index % gestures.length]
        setPrediction(nextGesture)
        setDuration(42 + Math.round(Math.random() * 10))
        setLandmarksCount(63)

        const nextConfidence = Number((0.75 + Math.random() * 0.2).toFixed(2))
        setStablePrediction(nextGesture)
        setStableConfidence(nextConfidence)
        setStableStreak((prev) => Math.min(prev + 1, 12))

        setSequenceHistory((prev) => {
          const updated = [...prev, nextGesture].slice(-6)
          return updated
        })

        setTranslatedText((prev) => {
          const words = (prev ? `${prev} ${nextGesture}` : nextGesture).split(" ")
          return words.slice(-20).join(" ")
        })

        if (imgRef.current) {
          imgRef.current.src = sampleImages[index % sampleImages.length]
        }

        index += 1
      }, 1800)

      return () => {
        window.clearInterval(interval)
        setConnected(false)
      }
    }

    connectWS()
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [shouldUseLiveWS, connectWS])

  const handleSpeak = () => {
    if (translatedText && "speechSynthesis" in window) {
      speechSynthesis.cancel() // stop any ongoing speech
      const utterance = new SpeechSynthesisUtterance(translatedText)
      utterance.rate = 0.9
      utterance.pitch = 1
      speechSynthesis.speak(utterance)
    }
  }

  const handleCopy = async () => {
    if (translatedText) {
      await navigator.clipboard.writeText(translatedText)
    }
  }

  const clearText = () => setTranslatedText("")

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-4 py-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-3 bg-primary/10 rounded-full">
              <Hand className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              SignSpeak
            </h1>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Real-time hand sign recognition with speech synthesis for inclusive communication.
          </p>
        </div>

        <div className="max-w-3xl mx-auto w-full space-y-2">
          <label htmlFor="model-select" className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" />
            Demo model
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              id="model-select"
              className="h-10 rounded-md border border-input bg-background/70 px-3 text-sm shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-70"
              value={selectedModel}
              disabled
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant={cameraReady ? "secondary" : "default"}
              className="sm:w-auto"
              onClick={() => void startCamera()}
              disabled={isCameraLoading}
            >
              {cameraReady ? "Camera Ready" : isCameraLoading ? "Starting camera..." : "Enable Camera"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{selectedModelMeta.description}</p>
          {cameraError && <p className="text-xs text-destructive">{cameraError}</p>}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Video Feed */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  Live Recognition
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={connected ? "default" : "destructive"} className="flex items-center gap-1">
                    {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                    {connected ? "Connected" : "Disconnected"}
                  </Badge>
                  <Badge variant={cameraReady ? "secondary" : "outline"} className="flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    {cameraReady ? "Camera Ready" : "Camera Off"}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    Model: {selectedModelMeta.badge}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                    cameraReady ? "opacity-100" : "opacity-0"
                  }`}
                />
                {shouldUseLiveWS && (
                  <img
                    ref={imgRef}
                    alt="YOLO11 annotated frames"
                    className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                      connected ? "opacity-100" : "opacity-30"
                    }`}
                  />
                )}

                {!cameraReady && !isCameraLoading && !cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center text-white">
                    <p className="text-lg font-medium">Enable your camera to preview gestures</p>
                    <Button size="sm" onClick={() => void startCamera()}>
                      Enable Camera
                    </Button>
                  </div>
                )}

                {isCameraLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-center text-white">
                    <p className="text-sm font-medium">Starting camera…</p>
                  </div>
                )}

                {cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-center text-white px-4">
                    <p className="text-sm font-medium">{cameraError}</p>
                    <Button size="sm" variant="secondary" onClick={() => void startCamera()}>
                      Retry Camera
                    </Button>
                  </div>
                )}

                {shouldUseLiveWS && !connected && !cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <div className="text-center text-white space-y-2">
                      <WifiOff className="h-12 w-12 mx-auto mb-2 opacity-60" />
                      <p className="text-sm">Connecting to YOLO11 pipeline…</p>
                      <Button size="sm" className="mt-2" onClick={handleReconnect}>
                        Reconnect
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Current Sign</p>
                  <p className="text-2xl font-bold text-primary">{prediction || "No Hand"}</p>
                </div>
                <div className="text-right text-sm">
                  {landmarksCount ? `${landmarksCount} landmarks` : "No data"} •{" "}
                  {duration ? `${Math.round(duration)}ms` : ""}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Translation & Speech */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                Translation & Speech
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <History className="h-4 w-4 text-muted-foreground" />
                      Smoothed Sign
                    </p>
                    <p className="text-2xl font-semibold text-primary">{stablePrediction || "Waiting..."}</p>
                  </div>
                  <div className="text-right text-sm">
                    <div>{stableConfidence !== null ? `${Math.round(stableConfidence * 100)}%` : "--"} confident</div>
                    <div>{stableStreak ? `${stableStreak} frame streak` : "No streak"}</div>
                  </div>
                </div>
                {sequenceHistory.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {sequenceHistory.map((label, idx) => (
                      <Badge key={`${label}-${idx}`} variant="secondary" className="rounded-full px-3 py-1 text-xs">
                        {label}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <label className="text-sm font-medium text-muted-foreground">Translated Text</label>
              <Textarea
                value={translatedText}
                onChange={(e) => setTranslatedText(e.target.value)}
                placeholder="Your translated text will appear here..."
                className="min-h-[120px] text-lg resize-none"
              />

              <div className="grid grid-cols-2 gap-3">
                <Button onClick={handleSpeak} disabled={!translatedText} size="lg" className="flex gap-2">
                  <Volume2 className="h-4 w-4" />
                  Speak
                </Button>
                <Button onClick={handleCopy} disabled={!translatedText} variant="outline" size="lg" className="flex gap-2">
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
              </div>

              <Button onClick={clearText} disabled={!translatedText} variant="ghost" className="w-full">
                Clear
              </Button>

              <div className="pt-4 border-t">
                <Button
                  onClick={() => setIsListening(!isListening)}
                  variant={isListening ? "default" : "outline"}
                  className="w-full flex gap-2"
                  size="lg"
                >
                  <Mic className={`h-4 w-4 ${isListening ? "animate-pulse" : ""}`} />
                  {isListening ? "Stop Listening" : "Voice Input"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground">
            Built with ❤️ for the deaf and hard-of-hearing community
          </p>
        </div>
      </div>
    </div>
  )
}

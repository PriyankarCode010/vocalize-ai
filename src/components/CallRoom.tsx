"use client"

import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  Camera,
  CameraOff,
  Link2,
  Mic,
  MicOff,
  PhoneOff,
  SignalHigh,
  SignalLow,
  SignalMedium,
  ToggleLeft,
  ToggleRight,
} from "lucide-react"

import { SubtitlePanel, type CaptionItem } from "@/components/SubtitlePanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type CallRoomProps = {
  roomId: string
  userName?: string
}

type RemotePeer = {
  peerId: string
  stream: MediaStream
}

type SignalMessage =
  | ({ type: "offer" | "answer" } & RTCSessionDescriptionInit)
  | {
      type: "candidate"
      candidate: RTCIceCandidateInit
    }

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
}

export default function CallRoom({ roomId, userName = "Guest" }: CallRoomProps) {
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [showAssistPanel, setShowAssistPanel] = useState(true)
  const [captions, setCaptions] = useState<CaptionItem[]>([])
  const [listening, setListening] = useState(false)
  const [connectionQuality, setConnectionQuality] = useState<"excellent" | "good" | "poor">("good")
  const [callError, setCallError] = useState<string | null>(null)
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([])
  const [callStartTime, setCallStartTime] = useState<number | null>(null)

  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map())

  const peerId = useMemo(() => crypto.randomUUID(), [])

  const backendWsUrl = useCallback(
    (path: string) => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws"
      const backendHost = process.env.NEXT_PUBLIC_BACKEND_HOST || window.location.hostname
      const backendPort = process.env.NEXT_PUBLIC_BACKEND_WS_PORT || "8000"
      return `${protocol}://${backendHost}:${backendPort}${path}`
    },
    []
  )

  const attachStreamToVideo = useCallback((stream: MediaStream | null, video: HTMLVideoElement | null) => {
    if (!video) return
    if (!stream) {
      video.srcObject = null
      return
    }
    video.srcObject = stream
    const playPromise = video.play()
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        /* ignored */
      })
    }
  }, [])

  const ensureLocalMedia = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCallError("Camera capture is not supported in this browser.")
      throw new Error("Camera not supported")
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      })
      localStreamRef.current = stream
      attachStreamToVideo(stream, localVideoRef.current)
      return stream
    } catch (error) {
      console.error("Unable to access media devices", error)
      setCallError("Unable to access camera or microphone. Please grant permission and retry.")
      throw error
    }
  }, [attachStreamToVideo])

  const disconnectAllPeers = useCallback(() => {
    peerConnections.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        try {
          sender.track?.stop()
        } catch {
          // ignore
        }
      })
      pc.close()
    })
    peerConnections.current.clear()
    setRemotePeers([])
  }, [])

  const cleanupCall = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    disconnectAllPeers()
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
  }, [disconnectAllPeers])

  const sendSignal = useCallback((targetPeerId: string, data: SignalMessage) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type: "signal", target: targetPeerId, data }))
  }, [])

  const handleRemoteStream = useCallback((peer: string, stream: MediaStream) => {
    setRemotePeers((prev) => {
      const existing = prev.find((p) => p.peerId === peer)
      if (existing && existing.stream === stream) {
        return prev
      }
      const filtered = prev.filter((p) => p.peerId !== peer)
      return [...filtered, { peerId: peer, stream }]
    })
  }, [])

  const removeRemoteStream = useCallback((peer: string) => {
    setRemotePeers((prev) => prev.filter((p) => p.peerId !== peer))
    const pc = peerConnections.current.get(peer)
    if (pc) {
      pc.close()
      peerConnections.current.delete(peer)
    }
  }, [])

  const createPeerConnection = useCallback(
    async (remotePeerId: string, shouldCreateOffer: boolean) => {
      if (peerConnections.current.has(remotePeerId)) return peerConnections.current.get(remotePeerId)!

      const localStream = await ensureLocalMedia()
      const pc = new RTCPeerConnection(ICE_SERVERS)

      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))

      pc.ontrack = (event) => {
        const [stream] = event.streams
        if (stream) {
          handleRemoteStream(remotePeerId, stream)
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(remotePeerId, { type: "candidate", candidate: event.candidate.toJSON() })
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === "failed" || state === "disconnected") {
          removeRemoteStream(remotePeerId)
        }
        if (state === "connected") {
          setConnectionQuality("excellent")
        } else if (state === "connecting") {
          setConnectionQuality("good")
        } else if (state === "failed") {
          setConnectionQuality("poor")
        }
      }

      peerConnections.current.set(remotePeerId, pc)

      if (shouldCreateOffer) {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        sendSignal(remotePeerId, offer as SignalMessage)
      }

      return pc
    },
    [ensureLocalMedia, handleRemoteStream, removeRemoteStream, sendSignal]
  )

  const handleIncomingSignal = useCallback(
    async (from: string, data: SignalMessage) => {
      const pc = await createPeerConnection(from, false)
      if (!pc) return

      if (data.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sendSignal(from, answer as SignalMessage)
      } else if (data.type === "answer") {
        if (!pc.currentLocalDescription) return
        await pc.setRemoteDescription(new RTCSessionDescription(data))
      } else if (data.type === "candidate" && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
        } catch (error) {
          console.error("Error adding ICE candidate", error)
        }
      }
    },
    [createPeerConnection, sendSignal]
  )

  const connectToRoom = useCallback(async () => {
    try {
      await ensureLocalMedia()
    } catch {
      return
    }

    const wsPath = `/ws/call/${roomId}?peerId=${peerId}`
    const ws = new WebSocket(backendWsUrl(wsPath))
    wsRef.current = ws

    ws.onopen = () => {
      setCallStartTime(Date.now())
      setCallError(null)
      setListening(true)
    }

    ws.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data)
        switch (payload.type) {
          case "room-full":
            setCallError("This room already has two participants. Create a new call link instead.")
            ws.close(4003, "Room already has two participants")
            return
          case "participants":
            await Promise.all(
              (payload.participants as string[]).map((otherPeerId: string) => createPeerConnection(otherPeerId, true))
            )
            break
          case "peer-joined":
            await createPeerConnection(payload.peerId as string, false)
            break
          case "peer-left":
            removeRemoteStream(payload.peerId as string)
            break
          case "signal":
            await handleIncomingSignal(payload.from as string, payload.data as SignalMessage)
            break
          default:
            break
        }
      } catch (err) {
        console.error("Invalid signaling message", err)
      }
    }

    ws.onerror = () => {
      setCallError("Connection error. Please refresh and try again.")
    }

    ws.onclose = (event) => {
      setListening(false)
      disconnectAllPeers()
      if (event.reason) {
        setCallError(event.reason)
      }
    }
  }, [backendWsUrl, createPeerConnection, ensureLocalMedia, handleIncomingSignal, peerId, removeRemoteStream, roomId, disconnectAllPeers])

  useEffect(() => {
    void connectToRoom()
    return () => {
      cleanupCall()
    }
  }, [connectToRoom, cleanupCall])

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    const stream = localStreamRef.current
    if (!stream) return
    stream.getVideoTracks().forEach((track) => {
      track.enabled = cameraEnabled
    })
  }, [cameraEnabled])

  useEffect(() => {
    const stream = localStreamRef.current
    if (!stream) return
    stream.getAudioTracks().forEach((track) => {
      track.enabled = microphoneEnabled
    })
  }, [microphoneEnabled])

  const handleSpeak = () => {
    if (!("speechSynthesis" in window) || remotePeers.length === 0) return
    const utterance = new SpeechSynthesisUtterance("Live captions are under construction.")
    utterance.rate = 0.95
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href)
  }

  const callDurationSeconds = callStartTime ? Math.round((Date.now() - callStartTime) / 1000) : 0

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Room ID</p>
            <h1 className="text-2xl font-semibold tracking-tight">{roomId}</h1>
            <p className="text-sm text-muted-foreground">Signed in as {userName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="flex items-center gap-1">
              {connectionQuality === "excellent" && <SignalHigh className="h-3 w-3" />}
              {connectionQuality === "good" && <SignalMedium className="h-3 w-3" />}
              {connectionQuality === "poor" && <SignalLow className="h-3 w-3" />}
              {connectionQuality === "excellent" ? "Great connection" : connectionQuality === "good" ? "Connecting" : "Unstable"}
            </Badge>
            <Button size="sm" variant="outline" className="flex items-center gap-2" onClick={handleCopyLink}>
              <Link2 className="h-4 w-4" />
              Copy link
            </Button>
          </div>
        </div>

        {callError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {callError}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card className="h-full">
            <CardContent className="space-y-4 p-4 sm:p-6">
              <VideoGrid
                localStream={localStreamRef.current}
                localVideoRef={localVideoRef}
                remotePeers={remotePeers}
                userName={userName}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant={microphoneEnabled ? "outline" : "secondary"}
                  onClick={() => setMicrophoneEnabled((prev) => !prev)}
                  className="flex-1 min-w-[140px]"
                >
                  {microphoneEnabled ? <Mic className="mr-2 h-4 w-4" /> : <MicOff className="mr-2 h-4 w-4" />}
                  {microphoneEnabled ? "Mute" : "Unmute"}
                </Button>
                <Button variant={cameraEnabled ? "outline" : "secondary"} onClick={() => setCameraEnabled((prev) => !prev)} className="flex-1 min-w-[140px]">
                  {cameraEnabled ? <Camera className="mr-2 h-4 w-4" /> : <CameraOff className="mr-2 h-4 w-4" />}
                  {cameraEnabled ? "Camera Off" : "Camera On"}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 min-w-[140px]"
                  onClick={() => {
                    cleanupCall()
                  }}
                >
                  <PhoneOff className="mr-2 h-4 w-4" />
                  Leave
                </Button>
                <Button variant="ghost" onClick={() => setShowAssistPanel((prev) => !prev)}>
                  {showAssistPanel ? (
                    <>
                      <ToggleRight className="mr-2 h-4 w-4" />
                      Hide AI Panel
                    </>
                  ) : (
                    <>
                      <ToggleLeft className="mr-2 h-4 w-4" />
                      Show AI Panel
                    </>
                  )}
                </Button>
              </div>

              {showAssistPanel && (
                <Card className="border-dashed">
                  <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Your Sign → AI → Speech</p>
                      <CardTitle className="text-lg">Assistive Translator</CardTitle>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleSpeak}>
                      <Bot className="mr-2 h-4 w-4" />
                      Speak
                    </Button>
                  </CardHeader>
                  <CardContent className="grid gap-6 lg:grid-cols-2">
                    <div className="space-y-4">
                      <div className="rounded-xl border p-4">
                        <p className="text-sm text-muted-foreground">Live Participants</p>
                        <div className="text-3xl font-semibold">{remotePeers.length + 1}</div>
                      </div>
                      <div className="rounded-xl border p-4">
                        <p className="text-sm text-muted-foreground">Call Duration</p>
                        <div className="text-2xl font-semibold">{callDurationSeconds}s</div>
                      </div>
                    </div>
                    <div className="rounded-xl border p-4 space-y-3 bg-muted/30">
                      <p className="text-sm font-medium text-muted-foreground">Coming soon</p>
                      <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-4">
                        <li>Automatic captions from both sides</li>
                        <li>Gesture-powered controls</li>
                        <li>One-click transcript export</li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>

          <SubtitlePanel captions={captions} listening={listening} onToggleListening={() => setListening((prev) => !prev)} />
        </div>
      </div>
    </div>
  )
}

type VideoGridProps = {
  localStream: MediaStream | null
  localVideoRef: React.RefObject<HTMLVideoElement>
  remotePeers: RemotePeer[]
  userName: string
}

function VideoGrid({ localStream, localVideoRef, remotePeers, userName }: VideoGridProps) {
  const participants = [
    {
      peerId: "local",
      label: `${userName} (You)`,
      muted: true,
      stream: localStream,
      videoRef: localVideoRef,
    },
    ...remotePeers.map((peer) => ({
      peerId: peer.peerId,
      label: `Guest ${peer.peerId.slice(-4)}`,
      stream: peer.stream,
    })),
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {participants.map((participant) => (
        <VideoTile
          key={participant.peerId}
          label={participant.label}
          stream={participant.stream}
          muted={participant.muted}
          videoRef={participant.videoRef}
        />
      ))}
    </div>
  )
}

type VideoTileProps = {
  label: string
  stream: MediaStream | null
  muted?: boolean
  videoRef?: MutableRefObject<HTMLVideoElement | null>
}

function VideoTile({ label, stream, muted, videoRef }: VideoTileProps) {
  const fallbackRef = useRef<HTMLVideoElement | null>(null)
  const ref = videoRef ?? fallbackRef

  useEffect(() => {
    if (!ref.current) return
    if (stream) {
      ref.current.srcObject = stream
      const playPromise = ref.current.play()
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          /* ignore autoplay errors */
        })
      }
    } else {
      ref.current.srcObject = null
    }
  }, [ref, stream])

  return (
    <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-black">
      <video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full object-cover ${stream ? "opacity-100" : "opacity-0"}`} />
      {!stream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-white">
          <p className="text-lg font-semibold">{label}</p>
          <p className="text-sm text-white/70">Waiting for video...</p>
        </div>
      )}
      <div className="absolute left-4 bottom-4 rounded-full bg-black/60 px-3 py-1 text-xs text-white">{label}</div>
    </div>
  )
}


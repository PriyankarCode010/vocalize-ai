"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { subscribeSignals } from "@/lib/webrtc/signaling"
import { callPeer, createPeerConnection, handleIncomingSignal } from "@/lib/webrtc/peers"
import { useMeetingStore } from "@/hooks/useMeetingStore"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { Meeting, MeetingRequest } from "@/types/meeting"
import {
  Camera,
  CameraOff,
  Captions,
  Hand,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Link2,
  Loader2,
} from "lucide-react"

export default function MeetingRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const meetingParams = React.use(params)
  const meetingId = meetingParams.id
  const router = useRouter()
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [participants, setParticipants] = useState<string[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [connectionQuality] = useState<"excellent" | "good" | "poor">("good")
  const { localStream, peers, setLocalStream, setControls, controls, removePeer, reset } = useMeetingStore()
  const [hostRequests, setHostRequests] = useState<MeetingRequest[]>([])

  const ensureAccess = async () => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    setUserId(user?.id ?? null)
    if (!user) {
      setError("You must be signed in.")
      setLoading(false)
      return { allowed: false }
    }
    const { data: meetingData, error: meetingError } = await supabase.from("meetings").select("*").eq("id", meetingId).single()
    if (meetingError || !meetingData) {
      setError("Meeting not found.")
      setLoading(false)
      return { allowed: false }
    }

    if (meetingData.host_id === user.id) {
      return { allowed: true, meetingData: meetingData as Meeting, user }
    }

    const { data: req } = await supabase
      .from("meeting_requests")
      .select("*")
      .eq("meeting_id", meetingId)
      .eq("requester_id", user.id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle()

    if (!req) {
      setError("You are not approved for this meeting.")
      setLoading(false)
      return { allowed: false }
    }
    return { allowed: true, meetingData: meetingData as Meeting, user }
  }

  const loadParticipants = async (self: string, hostId: string | null) => {
    const ids = new Set<string>()
    if (hostId) ids.add(hostId)
    ids.add(self)
    const { data: approved } = await supabase
      .from("meeting_requests")
      .select("requester_id")
      .eq("meeting_id", meetingId)
      .eq("status", "approved")
    approved?.forEach((row: { requester_id: string | null }) => row.requester_id && ids.add(row.requester_id))
    const others = Array.from(ids)
    setParticipants(others)
    return others
  }

  const startMedia = async () => {
    if (localStream) return localStream
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    setLocalStream(stream)
    setControls({ mic: true, cam: true })
    return stream
  }

  const connectToPeers = async (self: string, others: string[], stream: MediaStream) => {
    const sorted = [...others].sort()
    for (const peerId of sorted) {
      if (peerId === self) continue
      if (pcsRef.current.has(peerId)) continue
      const pc = await createPeerConnection(meetingId, self, peerId, stream)
      pcsRef.current.set(peerId, pc)
      // Simple glare avoidance: only the lexicographically lower ID initiates the offer
      if (self < peerId) {
        await callPeer(meetingId, self, peerId, pc)
      }
    }
  }

  useEffect(() => {
    let unsubSignals: (() => void) | null = null
    let unsubRequests: (() => void) | null = null
    let unsubHostRequests: (() => void) | null = null
    const init = async () => {
      setLoading(true)
      const access = await ensureAccess()
      if (!access.allowed || !access.meetingData || !access.user) return
      setMeeting(access.meetingData)
      const currentUser = access.user
      console.log("[room] self user.id", currentUser.id, "meeting", meetingId)
      const stream = await startMedia()
      const others = await loadParticipants(currentUser.id, access.meetingData.host_id || null)
      console.log("[room] participants (user ids)", others)
      await connectToPeers(currentUser.id, others, stream)

      unsubSignals = subscribeSignals(meetingId, (signal) => {
        if (!stream) return
        console.log("[signal] incoming", signal)
        void handleIncomingSignal(meetingId, currentUser.id, pcsRef.current, stream, signal)
      })

      if (meeting?.host_id === currentUser.id) {
        unsubHostRequests = supabase
          .channel(`host-requests:${meetingId}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "meeting_requests", filter: `meeting_id=eq.${meetingId}` },
            (payload: { new: MeetingRequest }) => {
              const incoming = payload.new as MeetingRequest
              if (incoming.status === "pending") {
                setHostRequests((prev) => {
                  if (prev.find((p) => p.id === incoming.id)) return prev
                  return [...prev, incoming]
                })
              }
            }
          )
          .subscribe()
      }

      unsubRequests = supabase
        .channel(`room-requests:${meetingId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "meeting_requests", filter: `meeting_id=eq.${meetingId}` },
          async (payload: { new: MeetingRequest }) => {
            const updated = payload.new as MeetingRequest
            if (updated.status === "approved" && updated.requester_id && updated.requester_id !== currentUser.id) {
              setParticipants((prev) => (prev.includes(updated.requester_id!) ? prev : [...prev, updated.requester_id!]))
              const pc = await createPeerConnection(meetingId, currentUser.id, updated.requester_id, stream)
              pcsRef.current.set(updated.requester_id, pc)
              await callPeer(meetingId, currentUser.id, updated.requester_id, pc)
            }
          }
        )
        .subscribe()

      setLoading(false)
    }
    void init()
    return () => {
      try {
        unsubSignals?.()
        unsubRequests?.()
        unsubHostRequests?.()
      } catch {
        /* ignore */
      }
      try {
        pcsRef.current.forEach((pc) => pc.close())
        pcsRef.current.clear()
      } catch {
        /* ignore */
      }
      try {
        useMeetingStore.getState().reset()
      } catch {
        /* ignore */
      }
    }
  }, [meetingId, supabase])

  const toggleMic = () => {
    const stream = useMeetingStore.getState().localStream
    if (!stream) return
    stream.getAudioTracks().forEach((t) => (t.enabled = !controls.mic))
    setControls({ mic: !controls.mic })
  }

  const toggleCam = () => {
    const stream = useMeetingStore.getState().localStream
    if (!stream) return
    stream.getVideoTracks().forEach((t) => (t.enabled = !controls.cam))
    setControls({ cam: !controls.cam })
  }

  const handleScreenShare = async () => {
    const stream = useMeetingStore.getState().localStream
    if (!stream) return
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const screenTrack = display.getVideoTracks()[0]
      setControls({ screen: true })
      pcsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video")
        sender?.replaceTrack(screenTrack)
      })
      screenTrack.onended = () => {
        const camTrack = stream.getVideoTracks()[0]
        pcsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video")
          sender?.replaceTrack(camTrack)
        })
        setControls({ screen: false })
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleLeave = () => {
    try {
      pcsRef.current.forEach((pc) => pc.close())
      pcsRef.current.clear()
    } catch {
      /* ignore */
    }
    try {
      const stream = useMeetingStore.getState().localStream
      stream?.getTracks().forEach((t) => {
        try {
          t.stop()
        } catch {
          /* ignore */
        }
      })
      useMeetingStore.getState().reset()
    } catch {
      /* ignore */
    }
    router.push(`/meeting/${meetingId}`)
  }

  const handleCopyLink = () => {
    if (typeof window === "undefined") return
    navigator.clipboard?.writeText(window.location.href).catch((err) => console.error("copy link failed", err))
  }

  const handleHostApproval = async (requestId: string, action: "approve" | "reject") => {
    const endpoint = action === "approve" ? "/api/meeting/approve" : "/api/meeting/reject"
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, meetingId }),
    })
    setHostRequests((prev) => prev.filter((r) => r.id !== requestId))
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 text-primary animate-spin" />
          <p className="text-muted-foreground font-medium">Connecting...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md p-4">
          <p className="text-destructive">{error}</p>
        </Card>
      </div>
    )
  }

  const isHost = meeting && userId && meeting.host_id === userId

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Meeting</p>
            <h1 className="text-2xl font-semibold">{meeting?.title || meeting?.id}</h1>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex items-center gap-2" onClick={handleCopyLink}>
              <Link2 className="h-4 w-4" />
              Copy link
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <VideoTile label="You" stream={localStream} muted />
          {peers.map((peer) => (
            <VideoTile key={peer.peerId} label={`Participant ${peer.peerId.slice(0, 6)}`} stream={peer.stream} />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant={controls.mic ? "outline" : "secondary"} onClick={toggleMic} className="min-w-[120px]">
            {controls.mic ? "Mute" : "Unmute"}
          </Button>
          <Button variant={controls.cam ? "outline" : "secondary"} onClick={toggleCam} className="min-w-[120px]">
            {controls.cam ? "Camera off" : "Camera on"}
          </Button>
          <Button variant={controls.screen ? "secondary" : "outline"} onClick={handleScreenShare} className="min-w-[120px]">
            {controls.screen ? "Sharing..." : "Share screen"}
          </Button>
          <Button variant="destructive" onClick={handleLeave} className="min-w-[120px]">
            Leave
          </Button>
        </div>
      </div>

      {isHost && hostRequests.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3">
          {hostRequests.map((req) => (
            <div key={req.id} className="rounded-lg border bg-card shadow-lg p-3 w-72">
              <p className="text-sm font-semibold">Join request</p>
              <p className="text-sm text-muted-foreground truncate">{req.requester_name || req.requester_id}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => handleHostApproval(req.id, "reject")} className="flex-1">
                  Reject
                </Button>
                <Button size="sm" onClick={() => handleHostApproval(req.id, "approve")} className="flex-1">
                  Allow
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VideoTile({ label, stream, muted }: { label: string; stream: MediaStream | null; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // Avoid resetting if unchanged
    if (video.srcObject === stream) return
    try {
      if (stream) {
        video.srcObject = stream
        const play = video.play()
        if (play && typeof play.catch === "function") {
          play.catch(() => {
            /* ignore autoplay/AbortError */
          })
        }
      } else {
        video.pause()
        video.srcObject = null
        video.load()
      }
    } catch (err) {
      console.warn("attach stream failed", err)
    }
    return () => {
      if (video.srcObject) {
        video.pause()
        video.srcObject = null
      }
    }
  }, [stream])

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border bg-black">
      <video ref={videoRef} autoPlay playsInline muted={muted} className={`h-full w-full object-cover ${stream ? "opacity-100" : "opacity-30"}`} />
      <div className="absolute left-3 bottom-3 rounded bg-black/60 px-2 py-1 text-xs text-white">{label}</div>
      {!stream && <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">Waiting for video...</div>}
    </div>
  )
}



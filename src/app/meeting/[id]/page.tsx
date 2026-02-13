"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Mic, MicOff, Camera, CameraOff, MoreHorizontal, PhoneOff } from "lucide-react"
import type { Meeting, MeetingRequest } from "@/types/meeting"
import MeetingRoom from "@/components/MeetingRoom"

export default function MeetingLobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const meetingParams = React.use(params)
  const meetingId = meetingParams.id
  console.log("[lobby] component mount, meetingId", meetingId)
  const router = useRouter()
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [hostRequests, setHostRequests] = useState<MeetingRequest[]>([])
  const [toastRequest, setToastRequest] = useState<MeetingRequest | null>(null)
  const [requestingJoin, setRequestingJoin] = useState(false)
  const [joinRequestId, setJoinRequestId] = useState<string | null>(null)
  const [joinStatus, setJoinStatus] = useState<"idle" | "waiting" | "approved" | "rejected">("idle")

  useEffect(() => {
    const init = async () => {
      console.log("[lobby] init start", { meetingId })
      setLoading(true)
      setError(null)

      const { data: auth } = await supabase.auth.getUser()
      console.log("[lobby] auth user", auth?.user)
      setUserId(auth?.user?.id ?? null)

      const { data, error: meetingError } = await supabase.from("meetings").select("*").eq("id", meetingId).single()
      if (meetingError || !data) {
        console.error("[lobby] meeting fetch failed", { meetingError, meetingId })
        setError("Meeting not found.")
        setLoading(false)
        return
      }

      console.log("[lobby] meeting loaded", data)
      setMeeting(data as Meeting)
      setLoading(false)
    }
    void init()
  }, [meetingId, supabase])

  useEffect(() => {
    const attach = () => {
      if (videoRef.current && localStream) {
        console.log("[lobby] attaching localStream to video element", localStream)
        videoRef.current.srcObject = localStream
        videoRef.current.play().catch(() => {})
      }
    }
    attach()
  }, [localStream])

  useEffect(() => {
    if (!meeting || !userId || meeting.host_id !== userId) {
      if (meeting && userId) {
        console.log("[lobby] not subscribing to host requests (not host user)", {
          meetingHostId: meeting.host_id,
          userId,
        })
      } else {
        console.log("[lobby] not subscribing to host requests (missing meeting or userId)", {
          hasMeeting: !!meeting,
          userId,
        })
      }
      return
    }

    console.log("[lobby] subscribing to host requests channel (lobby)", { meetingId, userId })

    const channel = supabase
      .channel(`host-requests:${meetingId}-lobby`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "meeting_requests", filter: `meeting_id=eq.${meetingId}` },
        (payload: { new: MeetingRequest }) => {
          const incoming = payload.new as MeetingRequest
          console.log("[lobby] incoming meeting_request INSERT (lobby)", incoming)
          if (incoming.status === "pending") {
            setHostRequests((prev) => {
              if (prev.find((p) => p.id === incoming.id)) return prev
              return [...prev, incoming]
            })
            showJoinToast(incoming)
          }
        }
      )
      .subscribe()

    return () => {
      try {
        console.log("[lobby] unsubscribing host requests channel (lobby)")
        channel.unsubscribe()
      } catch {
        /* ignore */
      }
    }
  }, [meeting, meetingId, supabase, userId])

  // For non-hosts: watch our own meeting_request for approval/rejection
  useEffect(() => {
    const isHost = meeting && userId && meeting.host_id === userId
    if (!meeting || !userId || isHost || !joinRequestId) {
      if (!meeting || !userId) {
        console.log("[lobby] not subscribing to self meeting_requests (missing meeting/user)", {
          hasMeeting: !!meeting,
          userId,
          joinRequestId,
        })
      }
      return
    }

    console.log("[lobby] subscribing to self meeting_requests updates", { meetingId, userId, joinRequestId })
    const channel = supabase
      .channel(`self-request:${joinRequestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "meeting_requests", filter: `id=eq.${joinRequestId}` },
        (payload: { new: MeetingRequest }) => {
          const updated = payload.new as MeetingRequest
          console.log("[lobby] self meeting_request UPDATE", updated)
          if (updated.status === "approved") {
            setJoinStatus("approved")
            console.log("[lobby] join request approved, navigating to room")
            router.push(`/meeting/${meetingId}/room`)
          } else if (updated.status === "rejected") {
            setJoinStatus("rejected")
            console.log("[lobby] join request rejected")
          }
        }
      )
      .subscribe()

    return () => {
      try {
        console.log("[lobby] unsubscribing self meeting_requests channel", { joinRequestId })
        channel.unsubscribe()
      } catch {
        /* ignore */
      }
    }
  }, [joinRequestId, meeting, meetingId, router, supabase, userId])

  const requestMedia = async () => {
    try {
      console.log("[lobby] requestMedia called")
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      console.log("[lobby] media stream acquired", stream)
      setLocalStream(stream)
      setMicOn(true)
      setCamOn(true)
    } catch (err) {
      console.error("[lobby] requestMedia failed, permission likely denied", err)
      setError("Please allow microphone and camera.")
    }
  }

  const toggleMic = () => {
    if (!localStream) return
    const enabled = !micOn
    console.log("[lobby] toggleMic", { previous: micOn, next: enabled })
    localStream.getAudioTracks().forEach((t) => (t.enabled = enabled))
    setMicOn(enabled)
  }

  const toggleCam = () => {
    if (!localStream) return
    const enabled = !camOn
    console.log("[lobby] toggleCam", { previous: camOn, next: enabled })
    localStream.getVideoTracks().forEach((t) => (t.enabled = enabled))
    setCamOn(enabled)
  }

  const handleHostApproval = async (requestId: string, action: "approve" | "reject") => {
    console.log("[lobby] handleHostApproval called", { requestId, action, meetingId })
    const endpoint = action === "approve" ? "/api/meeting/approve" : "/api/meeting/reject"
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, meetingId }),
      })
      const body = await res.json().catch(() => null)
      console.log("[lobby] handleHostApproval response", { status: res.status, ok: res.ok, body })
    } catch (err) {
      console.error("[lobby] handleHostApproval request failed", err)
    }
    setHostRequests((prev) => prev.filter((r) => r.id !== requestId))
    setToastRequest((current) => (current?.id === requestId ? null : current))
  }

  const showJoinToast = (incoming: MeetingRequest) => {
    console.log("[lobby] showJoinToast", incoming)
    setToastRequest(incoming)
    setTimeout(() => setToastRequest((current) => (current?.id === incoming.id ? null : current)), 5000)
  }

  if (loading) {
    console.log("[lobby] render loading state")
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>Loading meeting...</p>
        </div>
      </div>
    )
  }

  if (error) {
    console.log("[lobby] render error state", error)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-4">
          <p className="text-destructive">{error}</p>
        </Card>
      </div>
    )
  }

  const isHost = meeting && userId && meeting.host_id === userId
  console.log("[lobby] render main UI", { isHost, meeting, userId, hasLocalStream: !!localStream })

  const handleJoinClick = async () => {
    if (!meeting) return
    if (isHost) {
      console.log("[lobby] host join click, going directly to room")
      router.push(`/meeting/${meetingId}/room`)
      return
    }

    if (requestingJoin || joinStatus === "waiting") {
      console.log("[lobby] join click ignored, already requesting/waiting", { requestingJoin, joinStatus })
      return
    }

    try {
      setRequestingJoin(true)
      setError(null)
      console.log("[lobby] non-host join click, sending meeting request", { meetingId, userId })
      const res = await fetch("/api/meeting/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId }),
      })
      const body = await res.json().catch(() => null)
      console.log("[lobby] meeting request response", { status: res.status, ok: res.ok, body })
      if (!res.ok || !body?.request) {
        setError(body?.error || "Could not send join request.")
        setJoinStatus("idle")
        return
      }
      setJoinRequestId(body.request.id as string)
      setJoinStatus("waiting")
    } catch (err) {
      console.error("[lobby] meeting request failed", err)
      setError("Could not send join request.")
      setJoinStatus("idle")
    } finally {
      setRequestingJoin(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-8">
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr] w-full max-w-6xl items-center">
        <Card className="bg-black text-white overflow-hidden">
          <CardContent className="p-0">
            <div className="relative">
              <video ref={videoRef} className="w-full aspect-video object-cover bg-neutral-900" autoPlay playsInline muted />
              {!localStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70">
                  <p className="text-lg font-semibold">Do you want people to see and hear you in the meeting?</p>
                  <Button onClick={requestMedia}>Allow microphone and camera</Button>
                </div>
              )}
              <div className="absolute bottom-4 left-4 flex items-center gap-3">
                <Button
                  size="icon"
                  variant={micOn ? "secondary" : "destructive"}
                  className="rounded-full h-11 w-11"
                  onClick={toggleMic}
                  disabled={!localStream}
                >
                  {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                </Button>
                <Button
                  size="icon"
                  variant={camOn ? "secondary" : "destructive"}
                  className="rounded-full h-11 w-11"
                  onClick={toggleCam}
                  disabled={!localStream}
                >
                  {camOn ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
                </Button>
                <Button size="icon" variant="secondary" className="rounded-full h-11 w-11" disabled>
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
                <Button
                  size="icon"
                  variant="destructive"
                  className="rounded-full h-11 w-11"
                  onClick={() => router.push("/meeting")}
                >
                  <PhoneOff className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Ready to join?</p>
              <h2 className="text-xl font-semibold">No one else is here</h2>
            </div>
            <div className="flex flex-col gap-3">
              <Button
                className="h-12 rounded-full text-base"
                onClick={() => router.push(`/meeting/${meetingId}/room`)}
                disabled={!localStream}
              >
                Join now
              </Button>
              <Button variant="outline" className="h-12 rounded-full text-base">
                Present
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {isHost && hostRequests.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3">
          {hostRequests.map((req) => (
            <div key={req.id} className="rounded-lg border bg-card shadow-lg p-3 w-72">
              <p className="text-sm font-semibold">Join request</p>
              <p className="text-sm text-muted-foreground truncate">{req.requester_name || req.requester_id}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleHostApproval(req.id, "reject")}
                  className="flex-1"
                >
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

      {isHost && toastRequest && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-lg border bg-card shadow-lg px-4 py-3 flex items-center gap-3">
            <div>
              <p className="text-sm font-semibold">Join request</p>
              <p className="text-sm text-muted-foreground truncate">{toastRequest.requester_name || toastRequest.requester_id}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => handleHostApproval(toastRequest.id, "reject")}>
                Reject
              </Button>
              <Button size="sm" onClick={() => handleHostApproval(toastRequest.id, "approve")}>
                Allow
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
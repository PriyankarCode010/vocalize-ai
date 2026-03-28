"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Mic, MicOff, Camera, CameraOff, MoreHorizontal, PhoneOff, Users } from "lucide-react"
import type { Meeting, MeetingRequest } from "@/types/meeting"

/** Presence keys for people in the call (useWebRTC) are plain user ids. Lobby uses lobby:* so we can count separately. */
function countParticipantsInCall(presenceState: Record<string, unknown>): number {
  return Object.keys(presenceState || {}).filter((k) => k && !k.startsWith("lobby:")).length
}

export default function MeetingLobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const meetingParams = React.use(params)
  const meetingId = meetingParams.id
  const router = useRouter()
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const anonLobbyRef = useRef(`anon:${crypto.randomUUID()}`)

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [inCallCount, setInCallCount] = useState(0)
  const [hostRequests, setHostRequests] = useState<MeetingRequest[]>([])

  const [joinRequestId, setJoinRequestId] = useState<string | null>(null)
  const [joinPhase, setJoinPhase] = useState<"idle" | "requesting" | "waiting" | "rejected">("idle")
  const [joinError, setJoinError] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      setError(null)

      const { data: auth } = await supabase.auth.getUser()
      const uid = auth?.user?.id ?? null
      setUserId(uid)

      const { data, error: meetingError } = await supabase.from("meetings").select("*").eq("id", meetingId).single()
      if (meetingError || !data) {
        setError("Meeting not found.")
        setLoading(false)
        return
      }

      setMeeting(data as Meeting)

      if (uid) {
        const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", uid).maybeSingle()
        setDisplayName(profile?.display_name ?? auth?.user?.user_metadata?.full_name ?? null)
      }

      setLoading(false)
    }
    void init()
  }, [meetingId, supabase])

  useEffect(() => {
    const attach = () => {
      if (videoRef.current && localStream) {
        videoRef.current.srcObject = localStream
        videoRef.current.play().catch(() => {})
      }
    }
    attach()
  }, [localStream])

  // Same Realtime channel as the call: people in /room use presence key = user id; lobby uses lobby:*
  useEffect(() => {
    if (!meetingId) return
    const presenceKey = userId ? `lobby:${userId}` : `lobby:${anonLobbyRef.current}`

    const channel = supabase.channel(meetingId, {
      config: { presence: { key: presenceKey } },
    })

    channel.on("presence", { event: "sync" }, () => {
      setInCallCount(countParticipantsInCall(channel.presenceState() as Record<string, unknown>))
    })

    channel.subscribe(async (status: string) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ scope: "lobby", at: new Date().toISOString() })
        setInCallCount(countParticipantsInCall(channel.presenceState() as Record<string, unknown>))
      }
    })

    return () => {
      try {
        channel.unsubscribe()
      } catch {
        /* ignore */
      }
    }
  }, [meetingId, supabase, userId])

  // Host: live join requests + initial pending rows
  useEffect(() => {
    if (!meeting || !userId || meeting.host_id !== userId) return

    const loadPending = async () => {
      const { data } = await supabase
        .from("meeting_requests")
        .select("*")
        .eq("meeting_id", meetingId)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
      setHostRequests(((data ?? []) as MeetingRequest[]).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ))
    }
    void loadPending()

    const channel = supabase
      .channel(`host-requests:${meetingId}-lobby`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "meeting_requests", filter: `meeting_id=eq.${meetingId}` },
        (payload: { new: MeetingRequest }) => {
          const incoming = payload.new as MeetingRequest
          if (incoming.status !== "pending") return
          setHostRequests((prev) => {
            if (prev.find((p) => p.id === incoming.id)) return prev
            return [...prev, incoming].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
          })
        }
      )
      .subscribe()

    return () => {
      try {
        channel.unsubscribe()
      } catch {
        /* ignore */
      }
    }
  }, [meeting, meetingId, supabase, userId])

  // Guest: wait for approval after sending request
  useEffect(() => {
    const isHostUser = meeting && userId && meeting.host_id === userId
    if (!meeting || !userId || isHostUser || !joinRequestId) return

    const channel = supabase
      .channel(`self-request:${joinRequestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "meeting_requests", filter: `id=eq.${joinRequestId}` },
        (payload: { new: MeetingRequest }) => {
          const updated = payload.new as MeetingRequest
          if (updated.status === "approved") {
            router.push(`/meeting/${meetingId}/room`)
          } else if (updated.status === "rejected") {
            setJoinPhase("rejected")
            setJoinRequestId(null)
            setJoinError("The host declined your request to join.")
          }
        }
      )
      .subscribe()

    return () => {
      try {
        channel.unsubscribe()
      } catch {
        /* ignore */
      }
    }
  }, [joinRequestId, meeting, meetingId, router, supabase, userId])

  const requestMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      setLocalStream(stream)
      setMicOn(true)
      setCamOn(true)
    } catch {
      setError("Please allow microphone and camera.")
    }
  }

  const toggleMic = () => {
    if (!localStream) return
    const enabled = !micOn
    localStream.getAudioTracks().forEach((t) => (t.enabled = enabled))
    setMicOn(enabled)
  }

  const toggleCam = () => {
    if (!localStream) return
    const enabled = !camOn
    localStream.getVideoTracks().forEach((t) => (t.enabled = enabled))
    setCamOn(enabled)
  }

  const handleHostApproval = async (requestId: string, action: "approve" | "reject") => {
    const endpoint = action === "approve" ? "/api/meeting/approve" : "/api/meeting/reject"
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, meetingId }),
      })
    } catch {
      /* ignore */
    }
    setHostRequests((prev) => prev.filter((r) => r.id !== requestId))
  }

  const handleGuestJoin = async () => {
    if (!meeting || !userId) return
    if (joinPhase === "waiting" || joinPhase === "requesting") return
    setJoinError(null)
    setJoinPhase("requesting")
    try {
      const res = await fetch("/api/meeting/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingId,
          requesterName: displayName?.trim() || undefined,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.request) {
        setJoinPhase("idle")
        setJoinError(body?.error || "Could not send join request.")
        return
      }
      setJoinRequestId(body.request.id as string)
      setJoinPhase("waiting")
    } catch {
      setJoinPhase("idle")
      setJoinError("Could not send join request.")
    }
  }

  const handleHostEnterRoom = () => {
    router.push(`/meeting/${meetingId}/room`)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>Loading meeting...</p>
        </div>
      </div>
    )
  }

  if (error && !meeting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-4">
          <p className="text-destructive">{error}</p>
        </Card>
      </div>
    )
  }

  const isHost = Boolean(meeting && userId && meeting.host_id === userId)
  const activeHostRequest = hostRequests[0] ?? null

  const participantHeadline =
    inCallCount === 0
      ? "No one is in the call yet"
      : inCallCount === 1
        ? "1 person is in the call"
        : `${inCallCount} people are in the call`

  const participantSub =
    inCallCount === 0
      ? "You can join when you’re ready. Guests need the host to approve."
      : "Someone is already connected. Join to talk with them."

  const loginRedirect = `/login?redirect=${encodeURIComponent(`/meeting/${meetingId}`)}`

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-8 relative">
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr] w-full max-w-6xl items-center">
        <Card className="bg-card border-border overflow-hidden">
          <CardContent className="p-0">
            <div className="relative">
              <video ref={videoRef} className="w-full aspect-video object-cover bg-neutral-900" autoPlay playsInline muted />
              {!localStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/80 px-6 text-center">
                  <p className="text-lg font-semibold text-foreground">Allow camera and mic for the lobby preview</p>
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
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-muted p-2">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Live status</p>
                <h2 className="text-xl font-semibold leading-tight">{participantHeadline}</h2>
                <p className="text-sm text-muted-foreground mt-1">{participantSub}</p>
              </div>
            </div>

            {joinError && <p className="text-sm text-destructive">{joinError}</p>}
            {error && meeting && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-col gap-3">
              {isHost ? (
                <Button className="h-12 rounded-full text-base" onClick={handleHostEnterRoom}>
                  Join call
                </Button>
              ) : !userId ? (
                <>
                  <p className="text-sm text-muted-foreground">Sign in so the host can see your name and approve you.</p>
                  <Button asChild className="h-12 rounded-full text-base">
                    <Link href={loginRedirect}>Sign in to join</Link>
                  </Button>
                </>
              ) : joinPhase === "waiting" ? (
                <div className="rounded-xl border bg-muted/40 px-4 py-6 text-center space-y-2">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                  <p className="font-medium">Waiting for the host…</p>
                  <p className="text-sm text-muted-foreground">You’ll enter the call when they approve.</p>
                </div>
              ) : joinPhase === "rejected" ? (
                <div className="space-y-3">
                  <p className="text-sm text-destructive">Your request was declined.</p>
                  <Button className="h-12 rounded-full w-full" variant="secondary" onClick={() => setJoinPhase("idle")}>
                    Try again
                  </Button>
                </div>
              ) : (
                <Button className="h-12 rounded-full text-base" onClick={handleGuestJoin} disabled={joinPhase === "requesting"}>
                  {joinPhase === "requesting" ? "Sending request…" : "Ask to join"}
                </Button>
              )}

              <p className="text-xs text-muted-foreground">
                The host gets a request with your name and can allow or deny. After approval, you’ll join the video call
                automatically.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Host: centered approval modal */}
      {isHost && activeHostRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md border-2 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <CardContent className="p-6 space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Guest wants to join</p>
                <p className="text-2xl font-bold tracking-tight mt-1 break-words">
                  {activeHostRequest.requester_name || activeHostRequest.requester_id || "Unknown guest"}
                </p>
                <p className="text-xs text-muted-foreground mt-2">Allow them into this meeting?</p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="destructive"
                  className="flex-1 h-11 rounded-full"
                  onClick={() => handleHostApproval(activeHostRequest.id, "reject")}
                >
                  Deny
                </Button>
                <Button className="flex-1 h-11 rounded-full" onClick={() => handleHostApproval(activeHostRequest.id, "approve")}>
                  Approve
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Secondary queue: small stack if multiple pending (modal shows first) */}
      {isHost && hostRequests.length > 1 && (
        <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 max-w-xs text-xs text-muted-foreground">
          +{hostRequests.length - 1} more in queue
        </div>
      )}
    </div>
  )
}

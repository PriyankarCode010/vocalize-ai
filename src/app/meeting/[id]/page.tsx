"use client"

import React, { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, Clock, XCircle, Loader2, Users, ArrowRight } from "lucide-react"
import type { Meeting, MeetingRequest } from "@/types/meeting"

export default function MeetingLobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const meetingParams = React.use(params)
  const meetingId = meetingParams.id
  const router = useRouter()
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingRequests, setPendingRequests] = useState<MeetingRequest[]>([])
  const [selfRequest, setSelfRequest] = useState<MeetingRequest | null>(null)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    let unsub: (() => void) | null = null
    const init = async () => {
      setLoading(true)
      setError(null)
      const { data: userData } = await supabase.auth.getUser()
      const user = userData?.user
      setUserId(user?.id ?? null)
      setUserName(user?.user_metadata?.name || user?.email || "")

      const { data: meetingData, error: meetingError } = await supabase.from("meetings").select("*").eq("id", meetingId).single()
      if (meetingError || !meetingData) {
        setError("Meeting not found.")
        setLoading(false)
        return
      }
      setMeeting(meetingData as Meeting)

      if (user?.id === meetingData.host_id) {
        const { data: requests } = await supabase
          .from("meeting_requests")
          .select("*")
          .eq("meeting_id", meetingId)
          .eq("status", "pending")
          .order("created_at", { ascending: true })
        setPendingRequests((requests as MeetingRequest[]) ?? [])
      } else if (user?.id) {
        const { data: requests } = await supabase
          .from("meeting_requests")
          .select("*")
          .eq("meeting_id", meetingId)
          .eq("requester_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
        setSelfRequest(requests?.[0] as MeetingRequest | null)
        if (requests?.[0]?.status === "approved") {
          router.push(`/meeting/${meetingId}/room`)
        }
      }

      const channel = supabase
        .channel(`requests:${meetingId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "meeting_requests", filter: `meeting_id=eq.${meetingId}` },
          (payload: { new: MeetingRequest }) => {
            const incoming = payload.new as MeetingRequest
            if (user?.id === meetingData.host_id) {
              if (incoming.status === "pending") {
                setPendingRequests((prev) => {
                  const exists = prev.find((p) => p.id === incoming.id)
                  if (exists) return prev
                  return [...prev, incoming]
                })
              } else {
                setPendingRequests((prev) => prev.filter((p) => p.id !== incoming.id))
              }
            }
            if (user?.id === incoming.requester_id) {
              setSelfRequest(incoming)
              if (incoming.status === "approved") {
                router.push(`/meeting/${meetingId}/room`)
              }
            }
          }
        )
        .subscribe()

      unsub = () => {
        channel.unsubscribe()
      }
      setLoading(false)
    }
    void init()
    return () => {
      unsub?.()
    }
  }, [meetingId, router, supabase])

  const handleRequestAccess = async () => {
    if (!meeting || !userId) {
      setError("You must be signed in to request access.")
      return
    }
    setRequesting(true)
    setError(null)
    try {
      const response = await fetch("/api/meeting/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, requesterName: userName }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to request access")
      setSelfRequest(data.request as MeetingRequest)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error")
    } finally {
      setRequesting(false)
    }
  }

  const handleApproval = async (requestId: string, action: "approve" | "reject") => {
    const endpoint = action === "approve" ? "/api/meeting/approve" : "/api/meeting/reject"
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, meetingId }),
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading meeting...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Unable to join</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const isHost = meeting && userId && meeting.host_id === userId

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="container mx-auto px-4 py-12 max-w-4xl space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>{meeting?.title || "Meeting"}</CardTitle>
            <CardDescription>Meeting ID: {meeting?.id}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isHost ? (
              <>
                <p className="text-sm text-muted-foreground">You are the host. Pending join requests appear below.</p>
                <div className="space-y-3">
                  {pendingRequests.length === 0 && <p className="text-sm text-muted-foreground">No pending requests.</p>}
                  {pendingRequests.map((req) => (
                    <div key={req.id} className="flex items-center justify-between rounded border px-3 py-2">
                      <div>
                        <p className="font-medium">{req.requester_name || "Guest"}</p>
                        <p className="text-xs text-muted-foreground">{req.requester_id}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => handleApproval(req.id, "reject")}>
                          Reject
                        </Button>
                        <Button size="sm" onClick={() => handleApproval(req.id, "approve")}>
                          Allow
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <Button onClick={() => router.push(`/meeting/${meetingId}/room`)}>Enter meeting</Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Request access to join this meeting.</p>
                {selfRequest?.status === "pending" && <p className="text-sm">Waiting for host approval...</p>}
                {selfRequest?.status === "rejected" && <p className="text-sm text-destructive">Access denied by host.</p>}
                {!selfRequest && (
                  <div className="space-y-3">
                    <label className="text-sm font-medium">Display name</label>
                    <Input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Your name" />
                  </div>
                )}
                <div className="flex gap-3">
                  <Button onClick={handleRequestAccess} disabled={requesting || selfRequest?.status === "pending"}>
                    {selfRequest ? "Re-request" : "Request to join"}
                  </Button>
                  <Button variant="outline" onClick={() => router.push("/")}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}



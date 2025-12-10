"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"

const extractMeetingId = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    const parts = url.pathname.split("/").filter(Boolean)
    return parts.pop() || null
  } catch {
    // not a full URL; treat as raw id
    return trimmed
  }
}

const isValidMeetingId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export default function MeetingLandingPage() {
  const router = useRouter()
  const supabase = useMemo(() => {
    try {
      return getSupabaseBrowserClient()
    } catch {
      return null
    }
  }, [])
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)

  // Temporary debug: log session to console
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then((result: { data?: { session?: unknown } }) => {
      console.log("[session-debug] auth session", result?.data?.session)
    })
  }, [supabase])

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      const response = await fetch("/api/meeting/create", { method: "POST", headers: { "Content-Type": "application/json" } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to create meeting.")
      router.push(`/meeting/${data.meeting.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.")
    } finally {
      setCreating(false)
    }
  }

  const handleJoin = async (event: React.FormEvent) => {
    event.preventDefault()
    const extracted = extractMeetingId(code)
    if (!extracted || !isValidMeetingId(extracted)) {
      setError("Enter a valid meeting link or ID.")
      return
    }
    setError(null)
    setJoining(true)
    try {
      const res = await fetch(`/api/meeting/exists?id=${encodeURIComponent(extracted)}`)
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error("Meeting not found.")
      }
      router.push(`/meeting/${extracted}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to join meeting.")
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="container mx-auto px-4 py-16 max-w-4xl">
        <div className="text-center mb-10 space-y-3">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Meet</p>
          <h1 className="text-3xl font-semibold text-foreground">Create or join a meeting</h1>
          <p className="text-muted-foreground">Share a link to invite people or join with a meeting ID.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>Create a meeting</CardTitle>
              <CardDescription>Get a unique link you can share with others.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={handleCreate} disabled={creating}>
                {creating ? "Creating..." : "Create meeting"}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>Join with ID</CardTitle>
              <CardDescription>Paste a meeting ID or link.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={handleJoin}>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="UUID meeting ID"
                  aria-label="Meeting ID"
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" variant="outline" disabled={joining}>
                  {joining ? "Joining..." : "Join"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}



"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { Plus } from "lucide-react"

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
  const isJoinEnabled = (() => {
    const extracted = extractMeetingId(code)
    return !!extracted && isValidMeetingId(extracted)
  })()

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
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <form onSubmit={handleJoin} className="flex flex-col gap-4 w-full max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-full px-5 h-11"
          >
            <Plus className="h-4 w-4 mr-2" />
            {creating ? "Creating..." : "New meeting"}
          </Button>

          <div className="flex-1 flex items-center gap-2 border rounded-full px-3 h-11">
            <Input
              className="border-0 focus-visible:ring-0 px-2"
              placeholder="Enter a code or link"
              aria-label="Meeting code or link"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          <Button type="submit" disabled={!isJoinEnabled || joining} variant="secondary" className="h-11 rounded-full px-5">
            {joining ? "Joining..." : "Join"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </div>
  )
}



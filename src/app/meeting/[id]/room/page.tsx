"use client"

import React, { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import MeetingRoom from "@/components/MeetingRoom"

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/meeting/admission?meetingId=${encodeURIComponent(id)}`)
      if (cancelled) return
      if (res.status === 401) {
        router.replace(`/login?redirect=${encodeURIComponent(`/meeting/${id}/room`)}`)
        return
      }
      const data = (await res.json().catch(() => ({ allowed: false }))) as { allowed?: boolean }
      if (!data.allowed) {
        router.replace(`/meeting/${id}`)
        return
      }
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [id, router])

  if (!ready) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="text-sm">Checking access…</p>
      </div>
    )
  }

  return <MeetingRoom roomId={id} />
}

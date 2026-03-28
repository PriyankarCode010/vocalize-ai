"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import type { MeetingChatMessage } from "@/types/meeting"

export function useMeetingChat(meetingId: string | null, enabled: boolean) {
  const [messages, setMessages] = useState<MeetingChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [waitingPeerClear, setWaitingPeerClear] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const fetchMessages = useCallback(async () => {
    if (!meetingId) return
    const res = await fetch(`/api/meeting/chat/messages?meetingId=${encodeURIComponent(meetingId)}`)
    if (!res.ok) return
    const j = (await res.json()) as { messages?: MeetingChatMessage[] }
    setMessages(j.messages ?? [])
  }, [meetingId])

  useEffect(() => {
    if (!enabled || !meetingId) {
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      setLoading(true)
      await fetchMessages()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, meetingId, fetchMessages])

  useEffect(() => {
    if (!enabled || !meetingId) return
    const supabase = getSupabaseBrowserClient()

    const ch = supabase
      .channel(`meeting-chat:${meetingId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "meeting_chat_messages",
          filter: `meeting_id=eq.${meetingId}`,
        },
        (payload: { new: MeetingChatMessage }) => {
          const row = payload.new
          if (!row?.id) return
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "meeting_chat_clear_votes",
          filter: `meeting_id=eq.${meetingId}`,
        },
        () => {
          void fetchMessages()
          setWaitingPeerClear(false)
        }
      )
      .subscribe()

    return () => {
      try {
        void supabase.removeChannel(ch)
      } catch {
        /* ignore */
      }
    }
  }, [enabled, meetingId, fetchMessages])

  const persistOutgoingMessage = useCallback(
    async (body: string): Promise<boolean> => {
      if (!meetingId || !body.trim()) return false
      const res = await fetch("/api/meeting/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, body: body.trim() }),
      })
      if (res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: MeetingChatMessage }
        if (j.message?.id) {
          setMessages((prev) => (prev.some((m) => m.id === j.message!.id) ? prev : [...prev, j.message!]))
        }
        return true
      }
      console.warn("[useMeetingChat] persist failed", await res.text())
      return false
    },
    [meetingId]
  )

  const voteClearHistory = useCallback(async () => {
    if (!meetingId) return { cleared: false, voteCount: 0 }
    const res = await fetch("/api/meeting/chat/clear-vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId }),
    })
    const j = (await res.json().catch(() => ({}))) as {
      cleared?: boolean
      voteCount?: number
    }
    if (!res.ok) {
      console.warn("[useMeetingChat] clear-vote failed")
      return { cleared: false, voteCount: 0 }
    }
    if (j.cleared) {
      setMessages([])
      setWaitingPeerClear(false)
    } else if ((j.voteCount ?? 0) >= 1) {
      setWaitingPeerClear(true)
    }
    return { cleared: Boolean(j.cleared), voteCount: j.voteCount ?? 0 }
  }, [meetingId])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  return {
    messages,
    loading,
    listRef,
    fetchMessages,
    persistOutgoingMessage,
    voteClearHistory,
    waitingPeerClear,
  }
}

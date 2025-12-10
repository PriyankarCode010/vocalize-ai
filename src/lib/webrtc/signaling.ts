"use client"

import { RealtimeChannel } from "@supabase/supabase-js"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import type { MeetingSignal } from "@/types/meeting"

export type SignalPayload = {
  meeting_id: string
  from_peer: string
  to_peer?: string | null
  type: "offer" | "answer" | "ice"
  payload: any
}

export function subscribeSignals(meetingId: string, onSignal: (signal: MeetingSignal) => void): () => void {
  const supabase = getSupabaseBrowserClient()
  const channel: RealtimeChannel = supabase
    .channel(`signals:${meetingId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "meeting_signals",
        filter: `meeting_id=eq.${meetingId}`,
      },
      (payload: { new: MeetingSignal }) => {
        console.log("[signals] received realtime insert", payload.new)
        onSignal(payload.new as MeetingSignal)
      }
    )
    .subscribe()

  return () => {
    channel.unsubscribe()
  }
}

export async function sendSignal(payload: SignalPayload) {
  const supabase = getSupabaseBrowserClient()
  await supabase.from("meeting_signals").insert({
    meeting_id: payload.meeting_id,
    from_peer: payload.from_peer,
    to_peer: payload.to_peer ?? null,
    type: payload.type,
    payload: payload.payload,
  })
}




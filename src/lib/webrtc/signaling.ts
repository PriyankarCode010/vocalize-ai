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
  console.log("[signals] subscribeSignals called", { meetingId })
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
        console.log("[signals] received realtime insert", {
          id: payload.new.id,
          meeting_id: payload.new.meeting_id,
          from_peer: payload.new.from_peer,
          to_peer: payload.new.to_peer,
          type: payload.new.type,
        })
        onSignal(payload.new as MeetingSignal)
      }
    )
    .subscribe()

  return () => {
    console.log("[signals] unsubscribeSignals called", { meetingId })
    channel.unsubscribe()
  }
}

export async function sendSignal(payload: SignalPayload) {
  const supabase = getSupabaseBrowserClient()
  console.log("[signals] sendSignal called", {
    meeting_id: payload.meeting_id,
    from_peer: payload.from_peer,
    to_peer: payload.to_peer ?? null,
    type: payload.type,
  })
  const { error } = await supabase.from("meeting_signals").insert({
    meeting_id: payload.meeting_id,
    from_peer: payload.from_peer,
    to_peer: payload.to_peer ?? null,
    type: payload.type,
    payload: payload.payload,
  })
  if (error) {
    console.error("[signals] sendSignal insert error", error)
  } else {
    console.log("[signals] sendSignal insert success")
  }
}




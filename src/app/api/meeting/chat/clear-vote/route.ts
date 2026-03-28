import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { userHasMeetingAccess } from "@/lib/meeting/access"

/**
 * Record this user's wish to clear the transcript. When two distinct users have voted,
 * all messages for the meeting are deleted and votes are reset.
 */
export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const meetingId = body.meetingId as string | undefined
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId required" }, { status: 400 })
  }

  const allowed = await userHasMeetingAccess(supabase, auth.user.id, meetingId)
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const now = new Date().toISOString()
  const { error: upsertError } = await supabase.from("meeting_chat_clear_votes").upsert(
    {
      meeting_id: meetingId,
      user_id: auth.user.id,
      updated_at: now,
    },
    { onConflict: "meeting_id,user_id" }
  )

  if (upsertError) {
    console.error("[api/meeting/chat/clear-vote] upsert failed", upsertError)
    return NextResponse.json({ error: upsertError.message }, { status: 400 })
  }

  const { count, error: countError } = await supabase
    .from("meeting_chat_clear_votes")
    .select("*", { count: "exact", head: true })
    .eq("meeting_id", meetingId)

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 400 })
  }

  const voteCount = count ?? 0
  if (voteCount >= 2) {
    const { error: delMsg } = await supabase.from("meeting_chat_messages").delete().eq("meeting_id", meetingId)
    if (delMsg) {
      return NextResponse.json({ error: delMsg.message }, { status: 400 })
    }
    const { error: delVotes } = await supabase.from("meeting_chat_clear_votes").delete().eq("meeting_id", meetingId)
    if (delVotes) {
      return NextResponse.json({ error: delVotes.message }, { status: 400 })
    }
    return NextResponse.json({ cleared: true, voteCount: 0 })
  }

  return NextResponse.json({ cleared: false, voteCount })
}

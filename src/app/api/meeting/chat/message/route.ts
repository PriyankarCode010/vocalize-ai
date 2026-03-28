import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { userHasMeetingAccess } from "@/lib/meeting/access"

const MAX_LEN = 4000

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const meetingId = body.meetingId as string | undefined
  const text = typeof body.body === "string" ? body.body.trim() : ""
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId required" }, { status: 400 })
  }
  if (!text) {
    return NextResponse.json({ error: "body required" }, { status: 400 })
  }
  if (text.length > MAX_LEN) {
    return NextResponse.json({ error: `body too long (max ${MAX_LEN})` }, { status: 400 })
  }

  const allowed = await userHasMeetingAccess(supabase, auth.user.id, meetingId)
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", auth.user.id)
    .maybeSingle()

  const senderName =
    profile?.display_name?.trim() ||
    auth.user.user_metadata?.full_name ||
    auth.user.email ||
    "Participant"

  const { data: row, error } = await supabase
    .from("meeting_chat_messages")
    .insert({
      meeting_id: meetingId,
      sender_id: auth.user.id,
      sender_name: senderName,
      body: text,
    })
    .select()
    .single()

  if (error) {
    console.error("[api/meeting/chat/message] insert failed", error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ message: row })
}

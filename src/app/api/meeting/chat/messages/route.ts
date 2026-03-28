import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { userHasMeetingAccess } from "@/lib/meeting/access"

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const meetingId = url.searchParams.get("meetingId")
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId required" }, { status: 400 })
  }

  const allowed = await userHasMeetingAccess(supabase, auth.user.id, meetingId)
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data, error } = await supabase
    .from("meeting_chat_messages")
    .select("id, meeting_id, sender_id, sender_name, body, created_at")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true })
    .limit(500)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ messages: data ?? [] })
}

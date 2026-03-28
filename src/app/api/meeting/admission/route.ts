import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"

/**
 * GET ?meetingId=uuid
 * Host: always allowed. Guest: allowed only if they have an approved meeting_request for this meeting.
 */
export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return NextResponse.json({ allowed: false, reason: "unauthenticated" }, { status: 401 })
  }

  const url = new URL(request.url)
  const meetingId = url.searchParams.get("meetingId")
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId required" }, { status: 400 })
  }

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("host_id")
    .eq("id", meetingId)
    .single()

  if (meetingError || !meeting) {
    return NextResponse.json({ allowed: false, reason: "not_found" })
  }

  if (meeting.host_id && meeting.host_id === auth.user.id) {
    return NextResponse.json({ allowed: true, role: "host" as const })
  }

  const { data: approved } = await supabase
    .from("meeting_requests")
    .select("id")
    .eq("meeting_id", meetingId)
    .eq("requester_id", auth.user.id)
    .eq("status", "approved")
    .maybeSingle()

  return NextResponse.json({
    allowed: Boolean(approved),
    role: "guest" as const,
  })
}

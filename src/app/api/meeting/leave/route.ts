import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"

/**
 * POST { meetingId }
 * When the current host leaves while another approved participant exists, promote that
 * participant to host and grant the leaving host an approved meeting_requests row so they
 * can re-enter as a guest without being stuck.
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

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("host_id")
    .eq("id", meetingId)
    .single()

  if (meetingError || !meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 })
  }

  if (!meeting.host_id || meeting.host_id !== auth.user.id) {
    return NextResponse.json({ ok: true, transferred: false })
  }

  const { data: successor } = await supabase
    .from("meeting_requests")
    .select("requester_id")
    .eq("meeting_id", meetingId)
    .eq("status", "approved")
    .neq("requester_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const newHostId = successor?.requester_id
  if (!newHostId) {
    return NextResponse.json({ ok: true, transferred: false })
  }

  const { error: updateError } = await supabase
    .from("meetings")
    .update({ host_id: newHostId })
    .eq("id", meetingId)
    .eq("host_id", auth.user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 })
  }

  const { data: existingAdmission } = await supabase
    .from("meeting_requests")
    .select("id")
    .eq("meeting_id", meetingId)
    .eq("requester_id", auth.user.id)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!existingAdmission) {
    const { error: insertError } = await supabase.from("meeting_requests").insert({
      meeting_id: meetingId,
      requester_id: auth.user.id,
      requester_name: auth.user.email ?? "Host",
      status: "approved",
    })
    if (insertError) {
      console.error("[api/meeting/leave] insert former-host admission failed", insertError)
    }
  }

  return NextResponse.json({ ok: true, transferred: true, newHostId })
}

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const requestId = body.requestId as string | undefined
  const meetingId = body.meetingId as string | undefined
  if (!requestId || !meetingId) return NextResponse.json({ error: "requestId and meetingId required" }, { status: 400 })

  const { data: meeting } = await supabase.from("meetings").select("host_id").eq("id", meetingId).single()
  if (!meeting || meeting.host_id !== auth.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { error, data } = await supabase
    .from("meeting_requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ request: data })
}




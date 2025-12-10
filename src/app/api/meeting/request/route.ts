import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: auth } = await supabase.auth.getUser()
  console.log("[api/meeting/request] auth result", auth)
  if (!auth?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Ensure profile exists for requester
  console.log("[api/meeting/request] ensuring profile for user", {
    id: auth.user.id,
    email: auth.user.email,
  })
  await ensureProfile(supabase, auth.user)

  const body = await request.json().catch(() => ({}))
  console.log("[api/meeting/request] incoming body", body)
  const meetingId = body.meetingId as string | undefined
  const requesterName = body.requesterName as string | undefined
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId required" }, { status: 400 })
  }

  const { error, data } = await supabase
    .from("meeting_requests")
    .insert({
      meeting_id: meetingId,
      requester_id: auth.user.id,
      requester_name: requesterName || auth.user.email,
      status: "pending",
    })
    .select()
    .single()

  if (error) {
    console.error("[api/meeting/request] insert meeting_requests failed", error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  console.log("[api/meeting/request] request created", data)
  return NextResponse.json({ request: data })
}

async function ensureProfile(supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>, user: { id: string; email?: string | null; user_metadata?: any }) {
  console.log("[api/meeting/request] ensureProfile check", { userId: user.id })
  const { data, error } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle()
  console.log("[api/meeting/request] ensureProfile select result", { data, error })
  if (!data) {
    const { error: insertError } = await supabase.from("profiles").insert({
      id: user.id,
      display_name: user.user_metadata?.name || user.email || null,
      avatar_url: user.user_metadata?.avatar_url || null,
    })
    console.log("[api/meeting/request] ensureProfile insert result", { insertError })
  }
}



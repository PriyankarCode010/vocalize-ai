import type { SupabaseClient } from "@supabase/supabase-js"

/** Host or approved guest — same rule as /api/meeting/admission. */
export async function userHasMeetingAccess(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string
): Promise<boolean> {
  const { data: meeting } = await supabase.from("meetings").select("host_id").eq("id", meetingId).single()
  if (meeting?.host_id === userId) return true
  const { data: approved } = await supabase
    .from("meeting_requests")
    .select("id")
    .eq("meeting_id", meetingId)
    .eq("requester_id", userId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return Boolean(approved)
}

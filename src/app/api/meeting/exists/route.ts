import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient()
  const url = new URL(request.url)
  const id = url.searchParams.get("id")
  if (!id) return NextResponse.json({ ok: false }, { status: 400 })

  const { data, error } = await supabase.from("meetings").select("id, host_id, status, title").eq("id", id).single()
  if (error || !data) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  return NextResponse.json({ ok: true, meeting: data })
}




import { NextResponse } from "next/server"

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export async function POST() {
  try {
    const supabase = await getSupabaseServerClient()
    await supabase.auth.signOut()
  } catch (error) {
    console.error("Failed to sign out from Supabase", error)
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    expires: new Date(0),
  })
  return response
}





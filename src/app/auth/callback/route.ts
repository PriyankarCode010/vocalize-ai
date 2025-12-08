import { NextResponse } from "next/server"

import { SESSION_COOKIE_MAX_AGE, SESSION_COOKIE_NAME } from "@/lib/auth/constants"
import { getSupabaseServerClient } from "@/lib/supabase/server"

function encodeSession(payload: { email: string; name: string }) {
  return Buffer.from(JSON.stringify(payload)).toString("base64")
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const next = requestUrl.searchParams.get("next") || "/demo"

  if (!code) {
    const errorUrl = new URL("/login", request.url)
    errorUrl.searchParams.set("error", "Missing authorization code.")
    return NextResponse.redirect(errorUrl)
  }

  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.session?.user?.email) {
    const errorUrl = new URL("/login", request.url)
    errorUrl.searchParams.set("error", error?.message ?? "Unable to complete Google sign in.")
    return NextResponse.redirect(errorUrl)
  }

  const user = data.session.user
  const profile = {
    email: user.email,
    name: (user.user_metadata?.full_name as string | undefined) || user.email,
  }

  const destinationUrl = new URL(next, request.url)
  const response = NextResponse.redirect(destinationUrl)
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: encodeSession(profile),
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE,
  })

  return response
}
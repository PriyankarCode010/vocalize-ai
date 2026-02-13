import { NextResponse } from "next/server"

import { SESSION_COOKIE_MAX_AGE, SESSION_COOKIE_NAME } from "@/lib/auth/constants"

type LoginBody = {
  email?: string
  password?: string
}

export async function POST(request: Request) {
  console.log('[API] Login request received');
  
  const body = (await request.json()) as LoginBody
  const email = body.email?.trim().toLowerCase()
  const password = body.password?.trim()

  console.log('[API] Login attempt:', { email: email?.substring(0, 3) + '***', hasPassword: !!password });

  if (!email || !password) {
    console.log('[API] Missing email or password');
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 })
  }

  const profile = {
    email,
    name: email.split("@")[0] || "Guest",
  }
  const serialized = Buffer.from(JSON.stringify(profile)).toString("base64")

  console.log('[API] Creating session cookie for:', email?.substring(0, 3) + '***');

  const response = NextResponse.json({ success: true, profile })
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: serialized,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE,
  })

  console.log('[API] Login response created with status:', response.status);
  return response
}





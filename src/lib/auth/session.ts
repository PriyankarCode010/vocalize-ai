import { cookies } from "next/headers"
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants"

export type SessionPayload = {
  email: string
  name: string
}

function decodeSession(value: string | undefined): SessionPayload | null {
  if (!value) return null
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8")
    const parsed = JSON.parse(decoded) as SessionPayload
    if (parsed?.email) {
      return { email: parsed.email, name: parsed.name || parsed.email.split("@")[0] || "Guest" }
    }
    return null
  } catch {
    return null
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE_NAME)?.value
  return decodeSession(raw)
}





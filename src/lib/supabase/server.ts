import { cookies } from "next/headers"
import { createServerClient, type CookieOptions } from "@supabase/ssr"

function getEnv(key: string) {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`)
  }
  return value
}

export async function getSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options })
      },
      remove(name: string) {
        cookieStore.delete(name)
      },
    },
  })
}






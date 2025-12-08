"use client"

import { createBrowserClient } from "@supabase/ssr"

let browserClient: ReturnType<typeof createBrowserClient> | null = null

// function getEnv(key: string) {
//   const value = process.env[key]
//   if (!value) {
//     throw new Error(`Missing environment variable: ${key}`)
//   }
//   return value
// }

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment variables are not configured")
  }

  browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      detectSessionInUrl: true,
      persistSession: true,
    },
  })

  return browserClient
}




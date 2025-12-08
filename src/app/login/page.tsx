"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"

const FALLBACK_APP_ORIGIN = "http://localhost:3000"

function getAppOrigin() {
  // Prefer an explicit origin so deployments behind proxies don't fall back to localhost.
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "")
  if (configuredOrigin) {
    return configuredOrigin
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin
  }
  return FALLBACK_APP_ORIGIN
}

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const presetEmail = searchParams.get("email") ?? ""
  const redirectParam = searchParams.get("redirect") ?? "/demo"

  const [email, setEmail] = useState(presetEmail)
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)
  const supabase = useMemo(() => {
    try {
      return getSupabaseBrowserClient()
    } catch (error) {
      console.error(error)
      return null
    }
  }, [])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("submitting")
    setMessage(null)

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Unable to sign in.")
      }

      setStatus("success")
      router.push(redirectParam || "/demo")
    } catch (error) {
      setStatus("error")
      setMessage(error instanceof Error ? error.message : "Unexpected error.")
    }
  }

  const handleGoogleLogin = async () => {
    if (!supabase) {
      setStatus("error")
      setMessage("Supabase is not configured. Check environment variables.")
      return
    }

    setStatus("submitting")
    setMessage("Redirecting to Google...")

    try {
      const returnTo = redirectParam || "/demo"
      const redirectOrigin = getAppOrigin()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${redirectOrigin}/auth/callback?next=${encodeURIComponent(returnTo)}`,
        },
      })

      if (error) {
        throw error
      }
    } catch (error) {
      setStatus("error")
      setMessage(error instanceof Error ? error.message : "Unable to start Google sign in.")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 px-4 py-12">
      <Card className="w-full max-w-md p-6 space-y-6">
        <div className="space-y-1 text-center">
          <Badge variant="secondary" className="mx-auto w-fit">
            Welcome Back
          </Badge>
          <h1 className="text-2xl font-semibold">Log in to SignSpeak</h1>
          <p className="text-sm text-muted-foreground">Use email credentials below or continue with Google via Supabase Auth.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="Minimum 6 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
            />
          </div>

          {message && (
            <p className={`text-sm ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>
          )}

          <Button type="submit" className="w-full" disabled={status === "submitting"}>
            {status === "submitting" ? "Signing in..." : "Continue"}
          </Button>
        </form>

        <Button type="button" variant="outline" className="w-full" onClick={handleGoogleLogin} disabled={status === "submitting" || !supabase}>
          Continue with Google
        </Button>

        <p className="text-sm text-muted-foreground text-center">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="underline underline-offset-4">
            Sign up
          </Link>
        </p>
      </Card>
    </div>
  )
}

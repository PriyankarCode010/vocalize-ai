"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)
  const supabase = useMemo(() => {
    try {
      return getSupabaseBrowserClient()
    } catch (error) {
      console.error("[signup] supabase init failed", error)
      return null
    }
  }, [])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("submitting")
    setMessage(null)

    if (!email || !name || !password) {
      setStatus("error")
      setMessage("Please complete all fields to continue.")
      return
    }

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Unable to create account.")
      }

      setStatus("success")
      setMessage("Account created! Redirecting you to the app...")
      router.push("/demo")
    } catch (error) {
      setStatus("error")
      setMessage(error instanceof Error ? error.message : "Unexpected error.")
    }
  }

  const handleGoogleSignup = async () => {
    if (!supabase) {
      setStatus("error")
      setMessage("Supabase is not configured. Check environment variables.")
      return
    }
    setStatus("submitting")
    setMessage("Redirecting to Google...")
    try {
      const callbackUrl = new URL("/api/auth/callback", window.location.origin)
      callbackUrl.searchParams.set("next", "/meeting")
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
      })
      if (error) throw error
    } catch (error) {
      setStatus("error")
      setMessage(error instanceof Error ? error.message : "Unable to start Google sign up.")
      console.error("[signup] Google OAuth launch failed", error)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 px-4 py-12">
      <Card className="w-full max-w-md p-6 space-y-6">
        <div className="space-y-1 text-center">
          <Badge variant="secondary" className="mx-auto w-fit">
            Create Account
          </Badge>
          <h1 className="text-2xl font-semibold">Join vocalize-ai</h1>
          <p className="text-sm text-muted-foreground">We&apos;ll store your profile locally so you can explore the product.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium text-foreground">
              Full name
            </label>
            <Input
              id="name"
              placeholder="Jane Doe"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>

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
            {status === "submitting" ? "Creating account..." : "Create account"}
          </Button>
        </form>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignup}
          disabled={status === "submitting" || !supabase}
        >
          Continue with Google
        </Button>

        <p className="text-sm text-muted-foreground text-center">
          Already have an account?{" "}
          <Link href="/login" className="underline underline-offset-4">
            Log in
          </Link>
        </p>
      </Card>
    </div>
  )
}

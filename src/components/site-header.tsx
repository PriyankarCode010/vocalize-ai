"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { cn } from "@/lib/utils"
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"

type Profile = {
  id: string
  display_name: string | null
  avatar_url: string | null
}

const AVATAR_COLORS = ["#F44336", "#E91E63", "#9C27B0", "#3F51B5", "#03A9F4", "#009688", "#4CAF50", "#FF9800", "#795548"]

function getInitials(name: string, fallback: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function pickColor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/#features" },
  { label: "Demo", href: "/demo" },
  { label: "Meeting", href: "/meeting" },
]

export function SiteHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const supabase = useMemo(() => {
    try {
      return getSupabaseBrowserClient()
    } catch {
      return null
    }
  }, [])

  const refreshAuth = useCallback(() => {
    if (typeof document === "undefined") return
    setIsAuthenticated(document.cookie.includes(`${SESSION_COOKIE_NAME}=`))
  }, [])

  const loadProfile = useCallback(async () => {
    if (!supabase) return
    const { data: auth } = await supabase.auth.getUser()
    if (!auth?.user) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from("profiles").select("id, display_name, avatar_url").eq("id", auth.user.id).maybeSingle()
    if (data) {
      setProfile(data as Profile)
    }
  }, [supabase])

  useEffect(() => {
    refreshAuth()
    void loadProfile()
    const onFocus = () => {
      refreshAuth()
      void loadProfile()
    }
    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("focus", onFocus)
    }
  }, [refreshAuth, loadProfile])

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    refreshAuth()
    router.push("/")
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container mx-auto flex items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-lg">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary">S</span>
          SignSpeak
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "transition-colors hover:text-foreground",
                pathname === link.href ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {isAuthenticated ? (
            <>
              <div className="flex items-center gap-2 rounded-full border px-2 py-1">
                <div
                  className="h-8 w-8 overflow-hidden rounded-full"
                  style={{
                    background: profile?.avatar_url ? undefined : pickColor(profile?.id || "you"),
                  }}
                >
                  {profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.avatar_url} alt={profile.display_name || "Profile"} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-white">
                      {getInitials(profile?.display_name || profile?.id || "User", "User")}
                    </div>
                  )}
                </div>
                <span className="hidden sm:inline text-sm font-medium">{profile?.display_name || profile?.id || "User"}</span>
              </div>
              <Button size="sm" onClick={handleLogout}>
                Log out
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}


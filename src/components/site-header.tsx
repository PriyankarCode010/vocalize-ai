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
  display_name?: string | null
  avatar_url?: string | null
}

const AVATAR_COLORS = ["#F44336", "#E91E63", "#9C27B0", "#3F51B5", "#03A9F4", "#009688", "#4CAF50", "#FF9800", "#795548"]

function getInitials(name: string, fallback: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function getAvatarColor(seed: string) {
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
  { label: "Learn", href: "/demo" },
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
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setProfile(null)
      return
    }
    const { data, error } = await supabase.from("profiles").select("id, display_name, avatar_url").eq("id", user.id).single()
    const username = data?.display_name || user.user_metadata?.full_name || user.email || "Unknown user"
    
    if (data) {
      setProfile(data as Profile)
    } else {
      // Create a basic profile if none exists, don't fail the header
      setProfile({
        id: user.id,
        display_name: username,
        avatar_url: null,
      })
    }
  }, [supabase])

  useEffect(() => {
    refreshAuth()
    void loadProfile()
  }, [])

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter:saturate(0%)">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <span className="text-xl font-bold">Vocalize AI</span>
        </div>

        <nav className="hidden md:flex items-center space-x-6">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "text-sm font-medium transition-colors hover:text-foreground/80",
                pathname === item.href ? "text-foreground" : "text-foreground/60"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center space-x-4">
          {isAuthenticated ? (
            <>
              <div className="relative">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.display_name || "User"}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium",
                      getAvatarColor(profile?.display_name || "")
                    )}
                  >
                    {profile?.display_name?.[0]?.toUpperCase() || "U"}
                  </div>
                )}
              </div>
              <span className="text-sm text-muted-foreground ml-2">
                {profile?.display_name || "User"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  supabase?.auth.signOut()
                  setIsAuthenticated(false)
                  setProfile(null)
                  router.push("/")
                }}
              >
                Sign Out
              </Button>
            </>
          ) : (
            <Link href="/login">
              <Button variant="outline" size="sm">
                Sign In
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}

"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { cn } from "@/lib/utils"
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants"

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/#features" },
  { label: "Demo", href: "/demo" },
  { label: "Call", href: "/call/new" },
]

export function SiteHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const refreshAuth = useCallback(() => {
    if (typeof document === "undefined") return
    setIsAuthenticated(document.cookie.includes(`${SESSION_COOKIE_NAME}=`))
  }, [])

  useEffect(() => {
    refreshAuth()
    window.addEventListener("focus", refreshAuth)
    return () => {
      window.removeEventListener("focus", refreshAuth)
    }
  }, [refreshAuth])

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
              <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
                <Link href="/demo">Dashboard</Link>
              </Button>
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


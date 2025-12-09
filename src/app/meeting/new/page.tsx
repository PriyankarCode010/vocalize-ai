"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export default function NewMeetingPage() {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/meeting/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || null }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to create meeting")
      router.push(`/meeting/${data.meeting.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="container mx-auto px-4 py-16 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Create a meeting</CardTitle>
            <CardDescription>Generate a new meeting and share the link.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input placeholder="Optional title" value={title} onChange={(e) => setTitle(e.target.value)} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? "Creating..." : "Create meeting"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => router.push("/meeting")}>
              Go to meeting home
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}



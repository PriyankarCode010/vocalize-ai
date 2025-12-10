"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Mic, MicOff, Camera, CameraOff, MoreHorizontal, PhoneOff } from "lucide-react"

type Meeting = {
  id: string
  title: string | null
}

export default function MeetingLobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const meetingParams = React.use(params)
  const meetingId = meetingParams.id
  const router = useRouter()
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      setError(null)
      const { data, error: meetingError } = await supabase.from("meetings").select("*").eq("id", meetingId).single()
      if (meetingError || !data) {
        setError("Meeting not found.")
        setLoading(false)
        return
      }
      setMeeting({ id: data.id, title: data.title })
      setLoading(false)
    }
    void init()
  }, [meetingId, supabase])

  useEffect(() => {
    const attach = () => {
      if (videoRef.current && localStream) {
        videoRef.current.srcObject = localStream
        videoRef.current.play().catch(() => {})
      }
    }
    attach()
  }, [localStream])

  const requestMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      setLocalStream(stream)
      setMicOn(true)
      setCamOn(true)
    } catch {
      setError("Please allow microphone and camera.")
    }
  }

  const toggleMic = () => {
    if (!localStream) return
    const enabled = !micOn
    localStream.getAudioTracks().forEach((t) => (t.enabled = enabled))
    setMicOn(enabled)
  }

  const toggleCam = () => {
    if (!localStream) return
    const enabled = !camOn
    localStream.getVideoTracks().forEach((t) => (t.enabled = enabled))
    setCamOn(enabled)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>Loading meeting...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-4">
          <p className="text-destructive">{error}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-8">
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr] w-full max-w-6xl items-center">
        <Card className="bg-black text-white overflow-hidden">
          <CardContent className="p-0">
            <div className="relative">
              <video ref={videoRef} className="w-full aspect-video object-cover bg-neutral-900" autoPlay playsInline muted />
              {!localStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70">
                  <p className="text-lg font-semibold">Do you want people to see and hear you in the meeting?</p>
                  <Button onClick={requestMedia}>Allow microphone and camera</Button>
                </div>
              )}
              <div className="absolute bottom-4 left-4 flex items-center gap-3">
                <Button
                  size="icon"
                  variant={micOn ? "secondary" : "destructive"}
                  className="rounded-full h-11 w-11"
                  onClick={toggleMic}
                  disabled={!localStream}
                >
                  {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                </Button>
                <Button
                  size="icon"
                  variant={camOn ? "secondary" : "destructive"}
                  className="rounded-full h-11 w-11"
                  onClick={toggleCam}
                  disabled={!localStream}
                >
                  {camOn ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
                </Button>
                <Button size="icon" variant="secondary" className="rounded-full h-11 w-11" disabled>
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
                <Button
                  size="icon"
                  variant="destructive"
                  className="rounded-full h-11 w-11"
                  onClick={() => router.push("/meeting")}
                >
                  <PhoneOff className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Ready to join?</p>
              <h2 className="text-xl font-semibold">No one else is here</h2>
            </div>
            <div className="flex flex-col gap-3">
              <Button
                className="h-12 rounded-full text-base"
                onClick={() => router.push(`/meeting/${meetingId}/room`)}
                disabled={!localStream}
              >
                Join now
              </Button>
              <Button variant="outline" className="h-12 rounded-full text-base">
                Present
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}



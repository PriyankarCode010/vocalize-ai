import { useEffect, useRef, useState, useCallback } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import type { RealtimeChannel, User } from "@supabase/supabase-js"

const getIceServers = (): RTCConfiguration => {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ]
  if (
    process.env.NEXT_PUBLIC_TURN_URL &&
    process.env.NEXT_PUBLIC_TURN_USERNAME &&
    process.env.NEXT_PUBLIC_TURN_PASSWORD
  ) {
    servers.push({
      urls: process.env.NEXT_PUBLIC_TURN_URL,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_PASSWORD,
    })
  }
  return { iceServers: servers }
}

function readRemoteDisplayName(presenceState: Record<string, unknown>, myPresenceKey: string): string {
  const keys = Object.keys(presenceState || {}).filter(Boolean)
  const inRoom = keys.filter((k) => !k.startsWith("lobby:"))
  const other = inRoom.find((k) => k !== myPresenceKey)
  if (!other) return ""
  const metas = presenceState[other]
  if (!Array.isArray(metas) || !metas[0] || typeof metas[0] !== "object") return "Guest"
  const m = metas[0] as Record<string, unknown>
  const name = typeof m.display_name === "string" ? m.display_name.trim() : ""
  return name || "Guest"
}

export interface UseWebRTCOptions {
  localDisplayName?: string | null
}

export interface UseWebRTCReturn {
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  sendSubtitle: (text: string) => void
  startCall: () => void
  restartLocalMedia: () => Promise<void>
  /** Re-acquire camera/mic using these device ids; `null` = browser default for that kind. */
  applyMediaDevices: (videoDeviceId: string | null, audioDeviceId: string | null) => Promise<void>
  replaceLocalStream: (stream: MediaStream) => Promise<void>
  leaveCall: () => void
  connectionStatus: string
  error: string | null
  isHost: boolean
  /** From the other in-room presence payload (display_name). */
  remoteDisplayName: string
}

/**
 * 1:1 WebRTC video/voice over Supabase Realtime broadcast signaling.
 * Deterministic negotiation: lexicographically smallest presence key creates the offer
 * so exactly one side is the offerer (no glare, no host-approve gate).
 */
export function useWebRTC(
  onSubtitleReceived: (text: string) => void,
  roomId: string,
  options?: UseWebRTCOptions
): UseWebRTCReturn {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const [mediaReady, setMediaReady] = useState(false)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [connectionStatus, setConnectionStatus] = useState("disconnected")
  const [error, setError] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [myId, setMyId] = useState("")
  const [remoteDisplayName, setRemoteDisplayName] = useState("")
  const displayNameRef = useRef("Participant")

  const channelRef = useRef<RealtimeChannel | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  /** Subtitles sent before the data channel is open. */
  const subtitleQueueRef = useRef<string[]>([])
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([])
  const restartingMediaRef = useRef(false)
  /** Persisted across re-acquire; `null` means default device for that kind. */
  const preferredVideoDeviceIdRef = useRef<string | null>(null)
  const preferredAudioDeviceIdRef = useRef<string | null>(null)
  const negotiationStartedRef = useRef(false)
  const onSubtitleReceivedRef = useRef(onSubtitleReceived)
  const myIdRef = useRef("")
  /** Presence: we saw 2+ in-room peers (non-lobby keys); used to detect peer leave. */
  const hadTwoPeersRef = useRef(false)
  const peerLeaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [reconnectEpoch, setReconnectEpoch] = useState(0)

  useEffect(() => {
    onSubtitleReceivedRef.current = onSubtitleReceived
  }, [onSubtitleReceived])

  useEffect(() => {
    myIdRef.current = myId
  }, [myId])

  useEffect(() => {
    const n = options?.localDisplayName?.trim()
    displayNameRef.current = n && n.length > 0 ? n : "Participant"
  }, [options?.localDisplayName])

  // Re-publish presence when display name loads so the peer sees it.
  useEffect(() => {
    const ch = channelRef.current
    if (!ch) return
    void ch.track({
      joined_at: new Date().toISOString(),
      display_name: displayNameRef.current,
    })
  }, [options?.localDisplayName])

  // Host badge only — do NOT tie WebRTC lifecycle to this (avoids tearing down PC when host_id loads).
  useEffect(() => {
    let mounted = true
    const supabase = getSupabaseBrowserClient()
    const load = async () => {
      try {
        const { data: auth } = await supabase.auth.getUser()
        const uid = auth?.user?.id ?? null
        if (!roomId || !uid) {
          if (mounted) setIsHost(false)
          return
        }
        const { data } = await supabase.from("meetings").select("host_id").eq("id", roomId).single()
        if (mounted) setIsHost(Boolean(data?.host_id && data.host_id === uid))
      } catch {
        if (mounted) setIsHost(false)
      }
    }
    void load()

    const ch = supabase
      .channel(`meeting-host:${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "meetings", filter: `id=eq.${roomId}` },
        () => {
          void load()
        }
      )
      .subscribe()

    return () => {
      mounted = false
      try {
        supabase.removeChannel(ch)
      } catch {
        /* ignore */
      }
    }
  }, [roomId])

  // Stable identity for presence + SDP routing
  useEffect(() => {
    let mounted = true
    const supabase = getSupabaseBrowserClient()
    void supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => {
      const authId = data.user?.id ?? null
      const id = authId || crypto.randomUUID()
      if (mounted) setMyId(id)
    })
    return () => {
      mounted = false
    }
  }, [])

  const getMediaConstraints = (): MediaStreamConstraints => {
    const v = preferredVideoDeviceIdRef.current
    const a = preferredAudioDeviceIdRef.current
    return {
      video: v ? { deviceId: { ideal: v } } : true,
      audio: a ? { deviceId: { ideal: a } } : true,
    }
  }

  // Local media once
  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(getMediaConstraints())
        stream.getVideoTracks().forEach((t) => {
          t.enabled = true
        })
        if (mounted) {
          setLocalStream(stream)
          setMediaReady(true)
        } else {
          stream.getTracks().forEach((t) => t.stop())
        }
      } catch (err) {
        console.error("[useWebRTC] getUserMedia:", err)
        if (mounted) setError("Failed to access camera/microphone")
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    localStreamRef.current = localStream
  }, [localStream])

  const replaceLocalStream = useCallback(async (stream: MediaStream) => {
    const pc = peerRef.current
    const old = localStreamRef.current
    if (pc) {
      const senders = pc.getSenders()
      const newVideo = stream.getVideoTracks()[0] ?? null
      const newAudio = stream.getAudioTracks()[0] ?? null
      for (const sender of senders) {
        const kind = sender.track?.kind
        if (kind === "video" && newVideo?.readyState === "live") await sender.replaceTrack(newVideo)
        else if (kind === "audio" && newAudio?.readyState === "live") await sender.replaceTrack(newAudio)
      }
      if (newVideo?.readyState === "live" && !senders.some((s) => s.track?.kind === "video")) {
        pc.addTrack(newVideo, stream)
      }
      if (newAudio?.readyState === "live" && !senders.some((s) => s.track?.kind === "audio")) {
        pc.addTrack(newAudio, stream)
      }
    }
    if (old) old.getTracks().forEach((t) => t.stop())
    setLocalStream(stream)
    setMediaReady(true)
  }, [])

  const applyMediaDevices = useCallback(
    async (videoDeviceId: string | null, audioDeviceId: string | null) => {
      if (restartingMediaRef.current) return
      restartingMediaRef.current = true
      try {
        preferredVideoDeviceIdRef.current = videoDeviceId
        preferredAudioDeviceIdRef.current = audioDeviceId
        const newStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints())
        newStream.getVideoTracks().forEach((t) => {
          t.enabled = true
        })
        await replaceLocalStream(newStream)
        setError(null)
      } catch (e) {
        console.error("[useWebRTC] applyMediaDevices", e)
        setError("Failed to switch camera or microphone")
      } finally {
        restartingMediaRef.current = false
      }
    },
    [replaceLocalStream]
  )

  const restartLocalMedia = useCallback(async () => {
    await applyMediaDevices(
      preferredVideoDeviceIdRef.current,
      preferredAudioDeviceIdRef.current
    )
  }, [applyMediaDevices])

  const flushSubtitleQueue = useCallback(() => {
    const ch = dataChannelRef.current
    if (!ch || ch.readyState !== "open") return
    while (subtitleQueueRef.current.length > 0) {
      const msg = subtitleQueueRef.current.shift()
      if (!msg) continue
      try {
        ch.send(msg)
      } catch {
        subtitleQueueRef.current.unshift(msg)
        break
      }
    }
  }, [])

  const tryStartNegotiation = useCallback(
    (channel: RealtimeChannel, pc: RTCPeerConnection, myPresenceKey: string) => {
      if (negotiationStartedRef.current) return
      const state = channel.presenceState() as Record<string, unknown>
      const keys = Object.keys(state || {}).filter(Boolean)
      if (keys.length < 2) return

      const sorted = [...keys].sort()
      const iAmOfferer = sorted[0] === myPresenceKey
      negotiationStartedRef.current = true
      setConnectionStatus("connecting…")

      if (!iAmOfferer) return

      void (async () => {
        try {
          const dc = pc.createDataChannel("subtitles", { ordered: true })
          dataChannelRef.current = dc
          dc.onmessage = (e) => onSubtitleReceivedRef.current(e.data)
          dc.onopen = () => flushSubtitleQueue()

          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          channel.send({
            type: "broadcast",
            event: "signal",
            payload: {
              type: "offer",
              sdp: pc.localDescription?.toJSON?.() ?? { type: offer.type, sdp: offer.sdp },
              from: myPresenceKey,
            },
          })
        } catch (err) {
          console.error("[useWebRTC] offer failed:", err)
          negotiationStartedRef.current = false
          setError("Could not start call")
        }
      })()
    },
    [flushSubtitleQueue]
  )

  // WebRTC + signaling — deps intentionally exclude meetingHostId
  useEffect(() => {
    if (!mediaReady || !myId || !roomId) return
    const stream = localStreamRef.current
    if (!stream) return

    negotiationStartedRef.current = false
    iceCandidateQueue.current = []
    subtitleQueueRef.current = []
    setRemoteStream(null)
    setConnectionStatus("signaling")
    setError(null)

    const supabase = getSupabaseBrowserClient()
    const channel = supabase.channel(roomId, {
      config: { presence: { key: myId } },
    })
    channelRef.current = channel

    const pc = new RTCPeerConnection(getIceServers())
    peerRef.current = pc

    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      const c = event.candidate as RTCIceCandidate & { toJSON?: () => RTCIceCandidateInit }
      const init = typeof c.toJSON === "function" ? c.toJSON() : {
        candidate: c.candidate,
        sdpMid: c.sdpMid,
        sdpMLineIndex: c.sdpMLineIndex,
      }
      channel.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "candidate", candidate: init, from: myId },
      })
    }

    const clearRemoteTracks = () => {
      setRemoteStream((prev) => {
        if (prev) {
          prev.getTracks().forEach((tr) => {
            try {
              tr.stop()
            } catch {
              /* ignore */
            }
          })
        }
        return null
      })
      dataChannelRef.current = null
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        setError("Network connection failed. Try leaving and rejoining.")
        clearRemoteTracks()
        negotiationStartedRef.current = false
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setConnectionStatus("connected")
      else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        setConnectionStatus(pc.connectionState)
        setError(pc.connectionState === "failed" ? "Connection failed" : null)
        clearRemoteTracks()
        negotiationStartedRef.current = false
      } else if (pc.connectionState === "disconnected") {
        setConnectionStatus("disconnected")
      }
    }

    pc.ontrack = (event) => {
      const track = event.track
      track.onended = () => {
        setRemoteStream((prev) => {
          if (!prev) return null
          const live = prev.getTracks().filter((tr) => tr.readyState === "live")
          if (live.length === 0) {
            prev.getTracks().forEach((tr) => {
              try {
                tr.stop()
              } catch {
                /* ignore */
              }
            })
            return null
          }
          return new MediaStream(live)
        })
      }

      setRemoteStream((prev) => {
        if (prev?.getTracks().some((t) => t.id === event.track.id)) return prev
        if (prev) {
          const ns = new MediaStream(prev.getTracks())
          ns.addTrack(event.track)
          return ns
        }
        return new MediaStream([event.track])
      })
    }

    pc.ondatachannel = (event) => {
      const ch = event.channel
      dataChannelRef.current = ch
      ch.onmessage = (e) => onSubtitleReceivedRef.current(e.data)
      ch.onopen = () => flushSubtitleQueue()
    }

    stream.getTracks().forEach((track) => {
      if (track.readyState === "live") pc.addTrack(track, stream)
    })

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, unknown>
      const keys = Object.keys(state || {}).filter(Boolean)
      const inRoomPeers = keys.filter((k) => !k.startsWith("lobby:"))

      if (inRoomPeers.length >= 2) {
        hadTwoPeersRef.current = true
        if (peerLeaveDebounceRef.current) {
          clearTimeout(peerLeaveDebounceRef.current)
          peerLeaveDebounceRef.current = null
        }
      } else if (inRoomPeers.length < 2 && hadTwoPeersRef.current) {
        if (!peerLeaveDebounceRef.current) {
          peerLeaveDebounceRef.current = setTimeout(() => {
            peerLeaveDebounceRef.current = null
            const s2 = channel.presenceState() as Record<string, unknown>
            const k2 = Object.keys(s2 || {})
              .filter(Boolean)
              .filter((x) => !x.startsWith("lobby:"))
            if (k2.length < 2) {
              hadTwoPeersRef.current = false
              setReconnectEpoch((e) => e + 1)
            }
          }, 550)
        }
      }

      setRemoteDisplayName(
        readRemoteDisplayName(channel.presenceState() as Record<string, unknown>, myIdRef.current)
      )
      tryStartNegotiation(channel, pc, myIdRef.current)
    })
      .on("broadcast", { event: "signal" }, async ({ payload }: { payload: unknown }) => {
        if (!payload || typeof payload !== "object") return
        const p = payload as Partial<{
          from: string
          type: "offer" | "answer" | "candidate"
          sdp: RTCSessionDescriptionInit
          candidate: RTCIceCandidateInit
        }>
        if (!p.from || p.from === myIdRef.current) return

        try {
          if (p.type === "offer") {
            if (pc.signalingState === "closed" || !p.sdp || pc.remoteDescription) return
            await pc.setRemoteDescription(new RTCSessionDescription(p.sdp))
            while (iceCandidateQueue.current.length > 0) {
              const cand = iceCandidateQueue.current.shift()
              if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {})
            }
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            channel.send({
              type: "broadcast",
              event: "signal",
              payload: {
                type: "answer",
                sdp: pc.localDescription?.toJSON?.() ?? { type: answer.type, sdp: answer.sdp },
                from: myIdRef.current,
              },
            })
          } else if (p.type === "answer") {
            if (!p.sdp || pc.remoteDescription) return
            await pc.setRemoteDescription(new RTCSessionDescription(p.sdp))
            while (iceCandidateQueue.current.length > 0) {
              const cand = iceCandidateQueue.current.shift()
              if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {})
            }
          } else if (p.type === "candidate" && p.candidate?.candidate) {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(p.candidate)).catch(() => {})
            } else {
              iceCandidateQueue.current.push(p.candidate)
            }
          }
        } catch (e) {
          console.error("[useWebRTC] signal error:", e)
        }
      })
      .subscribe(async (status: string) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            joined_at: new Date().toISOString(),
            display_name: displayNameRef.current,
          })
          setRemoteDisplayName(
            readRemoteDisplayName(channel.presenceState() as Record<string, unknown>, myId)
          )
          tryStartNegotiation(channel, pc, myId)
        }
      })

    return () => {
      if (peerLeaveDebounceRef.current) {
        clearTimeout(peerLeaveDebounceRef.current)
        peerLeaveDebounceRef.current = null
      }
      try {
        channel.unsubscribe()
      } catch {
        /* ignore */
      }
      pc.close()
      peerRef.current = null
      channelRef.current = null
      dataChannelRef.current = null
      subtitleQueueRef.current = []
      negotiationStartedRef.current = false
      setRemoteDisplayName("")
    }
  }, [mediaReady, myId, roomId, reconnectEpoch, tryStartNegotiation, flushSubtitleQueue])

  const startCall = useCallback(() => {
    const ch = channelRef.current
    const pc = peerRef.current
    if (!ch || !pc || !myId) return
    if (pc.connectionState === "connected") return
    if (pc.connectionState === "failed") {
      window.location.reload()
      return
    }
    negotiationStartedRef.current = false
    tryStartNegotiation(ch, pc, myId)
  }, [myId, tryStartNegotiation])

  const sendSubtitle = useCallback((text: string) => {
    const ch = dataChannelRef.current
    if (ch?.readyState === "open") {
      try {
        ch.send(text)
      } catch {
        subtitleQueueRef.current.push(text)
      }
    } else {
      subtitleQueueRef.current.push(text)
      while (subtitleQueueRef.current.length > 100) subtitleQueueRef.current.shift()
    }
  }, [])

  const leaveCall = useCallback(() => {
    preferredVideoDeviceIdRef.current = null
    preferredAudioDeviceIdRef.current = null
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    peerRef.current?.close()
    try {
      channelRef.current?.unsubscribe()
    } catch {
      /* ignore */
    }
    peerRef.current = null
    channelRef.current = null
    dataChannelRef.current = null
    subtitleQueueRef.current = []
    negotiationStartedRef.current = false
    setLocalStream(null)
    setMediaReady(false)
    setRemoteStream(null)
    setConnectionStatus("disconnected")
    setError(null)
    setRemoteDisplayName("")
  }, [])

  return {
    localStream,
    remoteStream,
    sendSubtitle,
    startCall,
    restartLocalMedia,
    applyMediaDevices,
    replaceLocalStream,
    leaveCall,
    connectionStatus,
    error,
    isHost,
    remoteDisplayName,
  }
}

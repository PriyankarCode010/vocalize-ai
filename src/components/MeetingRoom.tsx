"use client"

import React, { useEffect, useRef, useState } from "react"
import { Mic, MicOff, Video, VideoOff, Volume2, X, Share2, Check, PhoneOff, MessageSquare } from "lucide-react"
import { useWebRTC } from "@/hooks/useWebRTC"
import { useASLRecognition } from "@/hooks/useASLRecognition"
import { useSubtitles, type SubtitleWirePayload } from "@/hooks/useSubtitles"
import { useMeetingChat } from "@/hooks/useMeetingChat"
import { useSpeech } from "@/hooks/useSpeech"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import type { MeetingRequest } from "@/types/meeting"
import type { User } from "@supabase/supabase-js"

/** Hide on-video remote captions after this long with no new sign/text from peer (read transcript in sidebar). */
const REMOTE_OVERLAY_IDLE_MS = 12_000

/** After this long without local subtitle changes, save the current line to the Transcript (ASL rarely ends with . or !). */
const TRANSCRIPT_LOCAL_DEBOUNCE_MS = 2200

function liveSignFromModel(current: string | null, raw: string | null): string {
  const bad = new Set(["no_sign_detected", "no sign found"])
  if (current && !bad.has(current) && current.trim()) return current.trim()
  if (raw && !bad.has(raw) && raw.trim()) return raw.trim()
  return ""
}

interface MeetingRoomProps {
  roomId: string;
}

function attachStream(
  videoEl: HTMLVideoElement | null,
  stream: MediaStream | null
) {
  if (!videoEl || !stream) return;
  try {
    videoEl.srcObject = stream;

    videoEl.muted = true;
    videoEl.autoplay = true;
    videoEl.playsInline = true;

    const playPromise = videoEl.play();

    if (playPromise !== undefined) {
      playPromise.catch(() => {
        setTimeout(() => videoEl.play().catch(() => {}), 500);
      });
    }
  } catch (err) {
    console.error("Attach stream error:", err);
  }
}

export default function MeetingRoom({ roomId }: MeetingRoomProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [localDisplayName, setLocalDisplayName] = useState<string | null>(null);
  const [selfUserId, setSelfUserId] = useState<string | null>(null);

  const remoteOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedLocalRef = useRef("");
  const localSubtitlesRef = useRef("");
  const transcriptDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize hooks
  const { speak: speakText } = useSpeech();
  const {
    localSubtitles,
    remoteSubtitles,
    remoteLiveSign,
    addLocalPrediction,
    addRemoteSubtitle,
    clearLocalSubtitles,
    clearRemoteSubtitles,
    getSubtitleData,
  } = useSubtitles();

  const clearRemoteSubtitlesRef = useRef(clearRemoteSubtitles);
  useEffect(() => {
    clearRemoteSubtitlesRef.current = clearRemoteSubtitles;
  }, [clearRemoteSubtitles]);

  localSubtitlesRef.current = localSubtitles;

  const {
    messages: chatMessages,
    loading: chatLoading,
    listRef: chatListRef,
    persistOutgoingMessage,
    voteClearHistory,
    waitingPeerClear,
  } = useMeetingChat(roomId, isMounted);

  const {
    localStream,
    remoteStream,
    sendSubtitle,
    startCall,
    replaceLocalStream,
    connectionStatus,
    error: rtcError,
    isHost,
    leaveCall,
    remoteDisplayName,
  } = useWebRTC((data) => {
    const scheduleOverlayHideIfLive = (hasVisual: boolean) => {
      if (!hasVisual) return
      if (remoteOverlayTimerRef.current) {
        clearTimeout(remoteOverlayTimerRef.current)
        remoteOverlayTimerRef.current = null
      }
      remoteOverlayTimerRef.current = setTimeout(() => {
        clearRemoteSubtitlesRef.current()
        remoteOverlayTimerRef.current = null
      }, REMOTE_OVERLAY_IDLE_MS)
    }

    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      const text = typeof parsed.text === "string" ? parsed.text : ""
      const hasLive =
        typeof parsed.sign === "string" || typeof parsed.raw === "string"
      const liveStr = hasLive ? String(parsed.sign ?? parsed.raw ?? "").trim() : ""
      addRemoteSubtitle({
        text,
        ...(hasLive ? { sign: String(parsed.sign ?? parsed.raw ?? "") } : {}),
        isFinal: Boolean(parsed.isFinal),
        timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
      })
      scheduleOverlayHideIfLive(Boolean(text.trim() || liveStr))
      if (parsed.isFinal && text.trim()) {
        speakText(text.trim())
      }
    } catch {
      if (data && String(data).trim().length > 0) {
        const t = String(data).trim()
        addRemoteSubtitle({ text: t, sign: "", isFinal: true })
        speakText(t)
        scheduleOverlayHideIfLive(true)
      }
    }
  }, roomId, { localDisplayName });

  const [hostJoinQueue, setHostJoinQueue] = useState<MeetingRequest[]>([])

  // Host: pending join requests while in the call (same DB + Realtime as lobby)
  useEffect(() => {
    if (!isMounted || !roomId || !isHost) return
    const supabase = getSupabaseBrowserClient()
    let cancelled = false

    void (async () => {
      const { data } = await supabase
        .from("meeting_requests")
        .select("*")
        .eq("meeting_id", roomId)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
      if (!cancelled) {
        setHostJoinQueue(((data ?? []) as MeetingRequest[]).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ))
      }
    })()

    const channel = supabase
      .channel(`host-requests:${roomId}-in-call`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "meeting_requests", filter: `meeting_id=eq.${roomId}` },
        (payload: { new: MeetingRequest }) => {
          const row = payload.new as MeetingRequest
          if (row.status !== "pending") return
          setHostJoinQueue((prev) => {
            if (prev.find((p) => p.id === row.id)) return prev
            return [...prev, row].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
          })
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      try {
        channel.unsubscribe()
      } catch {
        /* ignore */
      }
    }
  }, [isMounted, roomId, isHost])

  const handleInCallHostApproval = async (requestId: string, action: "approve" | "reject") => {
    const endpoint = action === "approve" ? "/api/meeting/approve" : "/api/meeting/reject"
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, meetingId: roomId }),
      })
    } catch {
      /* ignore */
    }
    setHostJoinQueue((prev) => prev.filter((r) => r.id !== requestId))
  }

  const pendingGuestRequest = hostJoinQueue[0] ?? null

  // Handle client-side mounting to prevent hydration errors
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    const supabase = getSupabaseBrowserClient();
    void supabase.auth.getUser().then(({ data: auth }: { data: { user: User | null } }) => {
      const u = auth.user;
      if (!u) return;
      setSelfUserId(u.id);
      void supabase
        .from("profiles")
        .select("display_name")
        .eq("id", u.id)
        .maybeSingle()
        .then(({ data: profile }: { data: { display_name: string | null } | null }) => {
          setLocalDisplayName(
            profile?.display_name?.trim() ||
              (typeof u.user_metadata?.full_name === "string" ? u.user_metadata.full_name : null) ||
              u.email ||
              null
          );
        });
    });
  }, [isMounted]);

  useEffect(() => {
    return () => {
      if (remoteOverlayTimerRef.current) {
        clearTimeout(remoteOverlayTimerRef.current);
        remoteOverlayTimerRef.current = null;
      }
    };
  }, []);

  const aslEnabled =
    isMounted &&
    !isVideoOff &&
    Boolean(typeof process !== "undefined" && process.env.NEXT_PUBLIC_BACKEND_URL)

  const { currentPrediction, rawPrediction } = useASLRecognition({
    videoRef: localVideoRef,
    enabled: aslEnabled,
  });

  // Ensure local video tracks are enabled.
  useEffect(() => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = true;
    });
  }, [localStream]);

  // Bind local video.
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      attachStream(localVideoRef.current, localStream);

      // Debug: confirm the video element is actually rendering.
      setTimeout(() => {
        const v = localVideoRef.current;
        if (!v) return;
        console.log("VIDEO DEBUG:", {
          width: v.videoWidth,
          height: v.videoHeight,
          readyState: v.readyState,
          paused: v.paused,
        });
      }, 2000);
    }
  }, [localStream]);

  // Mobile autoplay fix: kick local video play() on first user touch.
  useEffect(() => {
    const onTouchStart = () => {
      const video = localVideoRef.current;
      if (video) video.play().catch(() => {});
    };

    document.addEventListener("touchstart", onTouchStart, { once: true });
    return () => document.removeEventListener("touchstart", onTouchStart);
  }, [localStream]);

  // Bind remote video — clear srcObject when peer leaves or stream drops (avoids frozen last frame).
  useEffect(() => {
    const el = remoteVideoRef.current
    if (!el) return
    if (remoteStream) {
      attachStream(el, remoteStream)
    } else {
      el.srcObject = null
      el.load?.()
    }
  }, [remoteStream])

  const restartCamera = React.useCallback(async () => {
    try {
      // Prevent overlapping camera restarts (black-screen interval).
      if ((restartCamera as unknown as { _running?: boolean })._running) return;
      (restartCamera as unknown as { _running?: boolean })._running = true;

      localStream?.getTracks().forEach((t) => t.stop());
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      newStream.getVideoTracks().forEach((track) => {
        track.enabled = true;
      });
      await replaceLocalStream(newStream);
    } catch (err) {
      console.error("Camera restart failed:", err);
    } finally {
      (restartCamera as unknown as { _running?: boolean })._running = false;
    }
  }, [localStream, replaceLocalStream]);

  // Black screen detection.
  useEffect(() => {
    if (!localVideoRef.current) return;
    const video = localVideoRef.current;
    const check = window.setInterval(() => {
      if (video.videoWidth === 0 && localStream) {
        console.warn("Black video detected → restarting camera");
        void restartCamera();
      }
    }, 2000);

    return () => window.clearInterval(check);
  }, [localStream, restartCamera]);

  // Cleanup streams on unmount.
  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((track) => track.stop());
    };
  }, [localStream]);

  // Handle ASL Predictions
  useEffect(() => {
    if (!isMounted) return;
    
    if (currentPrediction) {
      addLocalPrediction(currentPrediction);
    } else {
      // No sign detected - add space to separate words
      addLocalPrediction('no_sign_detected');
    }
  }, [currentPrediction, addLocalPrediction, isMounted]);

  // Push sentence + live backend label to peer (queued until data channel opens).
  useEffect(() => {
    if (!isMounted) return

    const sentence = getSubtitleData()
    const sign = liveSignFromModel(currentPrediction, rawPrediction)
    const payload: SubtitleWirePayload = {
      text: sentence.text,
      sign,
      raw: rawPrediction && rawPrediction !== currentPrediction ? rawPrediction : null,
      isFinal: sentence.isFinal,
      timestamp: Date.now(),
    }

    if (!payload.text.trim() && !payload.sign) return

    sendSubtitle(JSON.stringify(payload))
  }, [localSubtitles, currentPrediction, rawPrediction, sendSubtitle, getSubtitleData, isMounted])

  // Save your line to Transcript: immediately when isFinal (. ! trailing space), else after a pause while signing.
  useEffect(() => {
    if (!isMounted || !roomId) return;

    const { text, isFinal } = getSubtitleData();
    const t = text.trim();

    if (!t) {
      lastPersistedLocalRef.current = "";
      if (transcriptDebounceRef.current) {
        clearTimeout(transcriptDebounceRef.current);
        transcriptDebounceRef.current = null;
      }
      return;
    }

    if (isFinal && t !== lastPersistedLocalRef.current) {
      lastPersistedLocalRef.current = t;
      void persistOutgoingMessage(t);
      if (transcriptDebounceRef.current) {
        clearTimeout(transcriptDebounceRef.current);
        transcriptDebounceRef.current = null;
      }
      return;
    }

    if (t === lastPersistedLocalRef.current) return;

    if (transcriptDebounceRef.current) clearTimeout(transcriptDebounceRef.current);
    transcriptDebounceRef.current = setTimeout(() => {
      transcriptDebounceRef.current = null;
      const latest = localSubtitlesRef.current.trim();
      if (!latest || latest === lastPersistedLocalRef.current) return;
      lastPersistedLocalRef.current = latest;
      void persistOutgoingMessage(latest);
    }, TRANSCRIPT_LOCAL_DEBOUNCE_MS);

    return () => {
      if (transcriptDebounceRef.current) {
        clearTimeout(transcriptDebounceRef.current);
        transcriptDebounceRef.current = null;
      }
    };
  }, [localSubtitles, getSubtitleData, isMounted, roomId, persistOutgoingMessage]);

  // Don't render until mounted to prevent hydration errors
  if (!isMounted) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-neutral-950 text-white">
        <div className="animate-pulse">Loading meeting room...</div>
      </div>
    );
  }

  // Toggle Mute/Video
  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => track.enabled = !track.enabled);
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => track.enabled = !track.enabled);
      setIsVideoOff(!isVideoOff);
    }
  };

  const handleShare = () => {
    void navigator.clipboard.writeText(roomId).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    })
  }

  const handleClearTranscript = () => {
    void voteClearHistory();
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)] bg-background text-foreground p-4 relative">
      {isHost && pendingGuestRequest && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md border-2 shadow-2xl">
            <CardContent className="p-6 space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Guest wants to join</p>
                <p className="text-2xl font-bold tracking-tight mt-1 break-words">
                  {pendingGuestRequest.requester_name || pendingGuestRequest.requester_id || "Unknown guest"}
                </p>
                <p className="text-xs text-muted-foreground mt-2">Approve to let them into this call.</p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="destructive"
                  className="flex-1 h-11 rounded-full"
                  onClick={() => void handleInCallHostApproval(pendingGuestRequest.id, "reject")}
                >
                  Deny
                </Button>
                <Button
                  className="flex-1 h-11 rounded-full"
                  onClick={() => void handleInCallHostApproval(pendingGuestRequest.id, "approve")}
                >
                  Approve
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isHost && hostJoinQueue.length > 1 && (
        <div className="fixed bottom-20 right-4 z-[90] text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded border">
          +{hostJoinQueue.length - 1} more waiting
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
            Vocalize Meeting
            <span className="text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground font-normal">
                {isHost ? 'Host' : 'Guest'}
            </span>
        </h1>
        <div className="flex items-center gap-2">
            <Button 
                size="sm" 
                variant="outline" 
                className="gap-2"
                onClick={handleShare}
            >
                {isCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                {isCopied ? "Copied!" : "Copy code"}
            </Button>
            {rtcError && (
                <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-500 font-bold animate-pulse">
                    {rtcError}
                </span>
            )}
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                connectionStatus.includes("connected")
                  ? "bg-green-500/20 text-green-400"
                  : "bg-yellow-500/20 text-yellow-400"
              }`}
            >
              {connectionStatus}
            </span>
            <Button size="sm" variant="outline" type="button" onClick={() => startCall()}>
              Retry connect
            </Button>
        </div>
      </div>

      {/* Main grid + transcript sidebar */}
      <div className="flex flex-col lg:flex-row flex-1 gap-4 min-h-0 items-stretch">
      <div className="flex-1 min-w-0 min-h-0 grid min-h-0 grid-cols-1 md:grid-cols-2 gap-4 relative items-start">
        {/* Local Feed — same aspect + absolute video as remote (fixes black band under stream) */}
        <div className="relative w-full aspect-video min-h-0 rounded-2xl overflow-hidden bg-black border border-border shadow-md">
          <video
            key={localStream?.id}
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 block h-full w-full min-h-full min-w-full object-cover bg-black ${isVideoOff ? "hidden" : ""}`}
          />

          <div className="absolute bottom-3 left-3 right-3 z-10 bg-background/75 p-3 rounded-lg backdrop-blur-sm border border-border/50 shadow-sm">
            <p className="text-xs text-muted-foreground mb-1">Your Sentence:</p>
            <p className="text-lg font-medium min-h-6 leading-snug">
              {localSubtitles || "Start signing..."}
            </p>
          </div>

          <div className="absolute top-3 left-3 z-10 bg-background/60 px-2 py-1 rounded text-xs border border-border/40 backdrop-blur-sm max-w-[85%] truncate">
            You{localDisplayName ? ` (${localDisplayName})` : ""}
            {isMuted ? " (Muted)" : ""}
          </div>
        </div>

        {/* Remote Feed */}
        <div className="relative w-full aspect-video min-h-0 rounded-2xl overflow-hidden bg-muted border border-border shadow-md">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted={false}
            className={`absolute inset-0 block h-full w-full min-h-full min-w-full object-cover ${!remoteStream ? "hidden" : ""}`}
          />
          
          {!remoteStream && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-sm px-4 text-center">
              {isHost ? "Waiting for guest to join..." : "Connecting to Host..."}
            </div>
          )}

          {/* Remote: subtitle-style overlay (hidden after idle — full history stays in Transcript sidebar) */}
          {(remoteLiveSign || remoteSubtitles) && (
            <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 max-w-[92%] pointer-events-none">
              <div className="rounded-md bg-black/80 px-4 py-2.5 text-center shadow-lg ring-1 ring-white/15">
                {remoteLiveSign ? (
                  <p className="text-sm font-medium text-white/90 leading-snug">{remoteLiveSign}</p>
                ) : null}
                {remoteSubtitles ? (
                  <p
                    className={`text-lg sm:text-xl font-medium text-white leading-snug ${
                      remoteLiveSign ? "mt-1.5 pt-1.5 border-t border-white/20" : ""
                    }`}
                  >
                    {remoteSubtitles}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          <div className="absolute top-3 left-3 z-10 bg-background/60 px-2 py-1 rounded text-xs flex items-center gap-2 border border-border/40 backdrop-blur-sm max-w-[85%]">
            <div className={`w-2 h-2 rounded-full shrink-0 ${remoteStream ? "bg-green-500" : "bg-red-500"}`} />
            <span className="truncate">
              {remoteStream
                ? remoteDisplayName?.trim() || "Guest"
                : isHost
                  ? "Waiting for guest…"
                  : "Connecting…"}
            </span>
          </div>
        </div>

      </div>

      <aside className="flex flex-col shrink-0 w-full lg:w-80 min-h-[260px] lg:min-h-0 lg:max-h-[calc(100vh-12rem)] border border-border rounded-2xl bg-card shadow-md overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 bg-muted/30">
          <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-semibold text-sm">Transcript</span>
          {chatLoading && <span className="text-xs text-muted-foreground ml-auto">Loading…</span>}
        </div>
        <div
          ref={chatListRef}
          className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[180px] lg:min-h-0"
        >
          {chatMessages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6 px-2">
              Final lines are saved here. On-video captions hide after your peer stops signing for a while—scroll back if you missed anything.
            </p>
          ) : (
            chatMessages.map((m) => {
              const mine = selfUserId && m.sender_id === selfUserId;
              return (
                <div
                  key={m.id}
                  className={`rounded-xl px-3 py-2 text-sm border ${
                    mine
                      ? "bg-primary/10 border-primary/25 ml-4"
                      : "bg-muted/50 border-border mr-4"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-medium text-xs text-muted-foreground truncate">
                      {mine ? "You" : m.sender_name || "Guest"}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                      {new Date(m.created_at).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-foreground leading-snug break-words whitespace-pre-wrap">{m.body}</p>
                </div>
              );
            })
          )}
        </div>
        <div className="border-t border-border p-3 space-y-2 bg-muted/20">
          {waitingPeerClear && (
            <p className="text-xs text-muted-foreground text-center">
              Waiting for the other person to confirm clearing the transcript.
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-full text-xs"
            type="button"
            onClick={handleClearTranscript}
          >
            Clear transcript (both must confirm)
          </Button>
        </div>
      </aside>
      </div>

      {/* Controls Bar */}
      <div className="mt-4 flex justify-center items-center gap-4">
         <Button 
            size="icon" 
            variant={isMuted ? "destructive" : "secondary"} 
            className="rounded-full h-12 w-12"
            onClick={toggleMute}
         >
            {isMuted ? <MicOff /> : <Mic />}
         </Button>

         <Button 
            size="icon" 
            variant={isVideoOff ? "destructive" : "secondary"} 
            className="rounded-full h-12 w-12"
            onClick={toggleVideo}
         >
            {isVideoOff ? <VideoOff /> : <Video />}
         </Button>

         <div className="w-px h-8 bg-border mx-2" />

         <Button 
            variant="outline" 
            className="rounded-full gap-2 hover:bg-muted"
            onClick={() => {
              lastPersistedLocalRef.current = "";
              if (transcriptDebounceRef.current) {
                clearTimeout(transcriptDebounceRef.current);
                transcriptDebounceRef.current = null;
              }
              clearLocalSubtitles();
            }}
         >
            <X className="h-4 w-4" />
            Clear
         </Button>

         <Button 
            className="rounded-full gap-2"
            onClick={() => {
              const line = remoteSubtitles.trim();
              if (line) speakText(line);
            }}
            disabled={!remoteSubtitles.trim()}
            title="Read aloud the subtitle line from the other person’s camera"
         >
            <Volume2 className="h-4 w-4" />
            Speak
         </Button>

         <div className="w-px h-8 bg-border mx-2" />

         <Button 
            variant="destructive" 
            className="rounded-full gap-2 px-6"
            onClick={() => {
              void (async () => {
                try {
                  await fetch("/api/meeting/leave", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ meetingId: roomId }),
                  })
                } catch {
                  /* still leave locally */
                }
                leaveCall()
                window.location.href = "/"
              })()
            }}
         >
            <PhoneOff className="h-4 w-4" />
            Leave
         </Button>
      </div>
    </div>
  );
}

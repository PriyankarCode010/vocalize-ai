"use client"

import React, { useEffect, useRef, useState } from "react"
import { Mic, MicOff, Video, VideoOff, Volume2, X, Share2, Check, PhoneOff } from "lucide-react"
import { useWebRTC } from "@/hooks/useWebRTC"
import { useASLRecognition, drawLandmarks } from "@/hooks/useASLRecognition"
import { useSubtitles, type SubtitleWirePayload } from "@/hooks/useSubtitles"
import { useSpeech } from "@/hooks/useSpeech"
import { Button } from "@/components/ui/button"

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Initialize hooks
  const { speak: speakText } = useSpeech();
  const {
    localSubtitles,
    remoteSubtitles,
    remoteLiveSign,
    addLocalPrediction,
    addRemoteSubtitle,
    clearLocalSubtitles,
    getSubtitleData,
  } = useSubtitles();
  
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
  } = useWebRTC((data) => {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      const text = typeof parsed.text === "string" ? parsed.text : ""
      const hasLive =
        typeof parsed.sign === "string" || typeof parsed.raw === "string"
      addRemoteSubtitle({
        text,
        ...(hasLive ? { sign: String(parsed.sign ?? parsed.raw ?? "") } : {}),
        isFinal: Boolean(parsed.isFinal),
        timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
      })
      if (parsed.isFinal && text.trim()) {
        speakText(text.trim())
      }
    } catch {
      if (data && String(data).trim().length > 0) {
        addRemoteSubtitle({ text: String(data).trim(), sign: "", isFinal: true })
        speakText(String(data).trim())
      }
    }
  }, roomId);

  // Handle client-side mounting to prevent hydration errors
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const aslEnabled =
    isMounted &&
    !isVideoOff &&
    Boolean(typeof process !== "undefined" && process.env.NEXT_PUBLIC_BACKEND_URL)

  const { currentPrediction, rawPrediction, landmarks } = useASLRecognition({
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

  // Bind remote video.
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      attachStream(remoteVideoRef.current, remoteStream);
    }
  }, [remoteStream]);

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

  // Draw Landmarks
  useEffect(() => {
    if (!isMounted || !canvasRef.current || !landmarks) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    drawLandmarks(ctx, landmarks);
  }, [landmarks, isMounted]);

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
    const link = typeof window !== "undefined" ? `${window.location.origin}/meeting/${roomId}` : roomId
    navigator.clipboard.writeText(link).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)] bg-background text-foreground p-4 relative">
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
                {isCopied ? "Copied!" : "Share Link"}
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

      {/* Main Grid — min-h-0 lets grid children respect aspect-video without blowing layout */}
      <div className="flex-1 grid min-h-0 grid-cols-1 md:grid-cols-2 gap-4 relative items-start">
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

          {!isVideoOff && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 block h-full w-full object-cover pointer-events-none"
              width={640}
              height={480}
            />
          )}

          <div className="absolute bottom-3 left-3 right-3 z-10 bg-background/75 p-3 rounded-lg backdrop-blur-sm border border-border/50 shadow-sm">
            <p className="text-xs text-muted-foreground mb-1">Your Sentence:</p>
            <p className="text-lg font-medium min-h-6 leading-snug">
              {localSubtitles || "Start signing..."}
            </p>
          </div>

          <div className="absolute top-3 left-3 z-10 bg-background/60 px-2 py-1 rounded text-xs border border-border/40 backdrop-blur-sm">
            You {isMuted && "(Muted)"}
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

          {/* Remote: live model output + built sentence from peer */}
          {(remoteLiveSign || remoteSubtitles) && (
            <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 max-w-[95%] flex flex-col items-center gap-2 pointer-events-none">
              {remoteLiveSign ? (
                <div className="bg-primary/95 text-primary-foreground px-4 py-1.5 rounded-full border border-primary shadow-lg">
                  <p className="text-xs font-medium uppercase tracking-wide opacity-90">Sign</p>
                  <p className="text-lg font-bold text-center leading-tight">{remoteLiveSign}</p>
                </div>
              ) : null}
              {remoteSubtitles ? (
                <div className="bg-popover/90 px-5 py-2.5 rounded-2xl backdrop-blur-md border border-border shadow-xl">
                  <p className="text-xs text-muted-foreground mb-0.5">Message</p>
                  <p className="text-xl font-semibold text-center text-popover-foreground">{remoteSubtitles}</p>
                </div>
              ) : null}
            </div>
          )}

          <div className="absolute top-3 left-3 z-10 bg-background/60 px-2 py-1 rounded text-xs flex items-center gap-2 border border-border/40 backdrop-blur-sm">
            <div className={`w-2 h-2 rounded-full shrink-0 ${remoteStream ? "bg-green-500" : "bg-red-500"}`} />
            Remote User
          </div>
        </div>

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
            onClick={() => clearLocalSubtitles()}
         >
            <X className="h-4 w-4" />
            Clear
         </Button>

         <Button 
            className="rounded-full gap-2"
            onClick={() => {
              if (localSubtitles) {
                speakText(localSubtitles);
              }
            }}
            disabled={!localSubtitles}
         >
            <Volume2 className="h-4 w-4" />
            Speak
         </Button>

         <div className="w-px h-8 bg-border mx-2" />

         <Button 
            variant="destructive" 
            className="rounded-full gap-2 px-6"
            onClick={() => {
                leaveCall();
                window.location.href = '/';
            }}
         >
            <PhoneOff className="h-4 w-4" />
            Leave
         </Button>
      </div>
    </div>
  );
}

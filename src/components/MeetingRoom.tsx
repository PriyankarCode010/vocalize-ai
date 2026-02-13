"use client"

import React, { useEffect, useRef, useState } from 'react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useASLRecognition, drawLandmarks } from '@/hooks/useASLRecognition';
import { useSubtitles } from '@/hooks/useSubtitles';
import { useSpeech } from '@/hooks/useSpeech';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Video, VideoOff, Volume2, X, Share2, Copy, Check, PhoneOff } from 'lucide-react';

interface MeetingRoomProps {
  roomId: string;
}

export default function MeetingRoom({ roomId }: MeetingRoomProps) {
  console.log('[MeetingRoom] 🖼️ Rendering MeetingRoom with roomId:', roomId);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Initialize hooks
  const { speak: speakText, stop, isSpeaking } = useSpeech();
  const { 
    localSubtitles, 
    remoteSubtitles, 
    addLocalPrediction, 
    addRemoteSubtitle, 
    clearLocalSubtitles, 
    clearRemoteSubtitles,
    getSubtitleData 
  } = useSubtitles();
  
  const { 
    localStream, 
    remoteStream, 
    sendSubtitle, 
    startCall, 
    connectionStatus,
    error: rtcError,
    isHost,
    guestStatus,
    guestRequest,
    approveGuest,
    rejectGuest,
    leaveCall
  } = useWebRTC((data) => {
    // Handle incoming remote subtitles
    try {
      const parsed = JSON.parse(data);
      console.log('[MeetingRoom] 💬 Received remote subtitle:', parsed.text);
      
      // Only add remote subtitles, never speak local ones
      addRemoteSubtitle({
        text: parsed.text,
        timestamp: Date.now(),
        isFinal: parsed.isFinal || false
      });
      
      // Only speak if it's marked as final and has content
      if (parsed.isFinal && parsed.text && parsed.text.trim().length > 0) {
        speakText(parsed.text);
        setTimeout(() => clearRemoteSubtitles(), 2000); // Clear after 2 seconds
      }
    } catch (e) {
      // Fallback for raw string data
      console.log('[MeetingRoom] 💬 Received raw remote subtitle:', data);
      if (data && data.trim().length > 0) {
        addRemoteSubtitle({
          text: data,
          timestamp: Date.now(),
          isFinal: true
        });
        
        speakText(data);
        setTimeout(() => clearRemoteSubtitles(), 2000); // Clear after 2 seconds
      }
    }
  }, roomId);

  // Handle client-side mounting to prevent hydration errors
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
      console.log(`[MeetingRoom] State Update: isHost=${isHost}, guestStatus=${guestStatus}, connection=${connectionStatus}`);
  }, [isHost, guestStatus, connectionStatus]);

  const { 
    isInitialized, 
    currentPrediction, 
    landmarks 
  } = useASLRecognition({ 
    videoRef: localVideoRef, 
    enabled: !isVideoOff && isMounted 
  });

  // Attach streams to video elements (only after mount)
  useEffect(() => {
    if (!isMounted) return;
    
    if (localVideoRef.current && localStream) {
      console.log('[MeetingRoom] 📹 Attaching local stream to video element', {
        streamActive: localStream.active,
        videoTracks: localStream.getVideoTracks().length,
        audioTracks: localStream.getAudioTracks().length
      });
      
      localVideoRef.current.srcObject = localStream;
      
      // Ensure video plays
      localVideoRef.current.play().then(() => {
        console.log('[MeetingRoom] ✅ Local video playing successfully');
      }).catch(e => {
        console.error('[MeetingRoom] Error playing local video:', e);
        // Try muted playback first
        if (localVideoRef.current) {
          localVideoRef.current.muted = true;
          localVideoRef.current.play().then(() => {
            console.log('[MeetingRoom] ✅ Local video playing after muted workaround');
            // Unmute after successful playback
            setTimeout(() => {
              if (localVideoRef.current) {
                localVideoRef.current.muted = false;
              }
            }, 100);
          }).catch(e2 => {
            console.error('[MeetingRoom] Still cannot play local video:', e2);
          });
        }
      });
    } else {
        console.log('[MeetingRoom] ⚠️ Local video ref or stream missing', { 
          hasRef: !!localVideoRef.current, 
          hasStream: !!localStream,
          streamActive: localStream?.active 
        });
    }
  }, [localStream, isMounted]);

  useEffect(() => {
    if (!isMounted) return;
    
    if (remoteVideoRef.current && remoteStream) {
      console.log('[MeetingRoom] 📺 Attaching remote stream to video element');
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(e => console.error('[MeetingRoom] Error playing remote video:', e));
    } else {
        console.log('[MeetingRoom] ℹ️ Remote video ref or stream missing', { hasRef: !!remoteVideoRef.current, hasStream: !!remoteStream });
    }
  }, [remoteStream, isMounted]);

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

  // Sync Local Subtitles with Remote
  useEffect(() => {
    if (!isMounted) return;
    
    const subtitleData = getSubtitleData();
    if (subtitleData.text) {
      sendSubtitle(JSON.stringify(subtitleData));
    }
  }, [localSubtitles, sendSubtitle, getSubtitleData, isMounted]);

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
    navigator.clipboard.writeText(roomId).then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    });
  };

  if (guestStatus === 'waiting') {
      return (
          <div className="flex flex-col h-screen items-center justify-center bg-neutral-950 text-white">
              <h1 className="text-2xl font-bold mb-4">Waiting for Host...</h1>
              <p className="text-neutral-400">The host has been notified of your request to join.</p>
              <div className="mt-8 animate-pulse text-sm">Please wait...</div>
          </div>
      );
  }

  if (guestStatus === 'rejected') {
      return (
        <div className="flex flex-col h-screen items-center justify-center bg-neutral-950 text-white">
            <h1 className="text-2xl font-bold mb-4 text-red-500">Access Denied</h1>
            <p className="text-neutral-400">The host has declined your request to join.</p>
        </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)] bg-background text-foreground p-4 relative">
      
      {/* Host Approval Notification */}
      {isHost && guestRequest && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-card border border-border p-4 rounded-xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-top-4">
              <div className="flex flex-col">
                  <span className="font-bold text-sm text-foreground">Guest Requesting to Join</span>
                  <span className="text-xs text-muted-foreground">ID: {guestRequest.slice(0, 8)}...</span>
              </div>
              <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => rejectGuest(guestRequest)}>Deny</Button>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => approveGuest(guestRequest)}>Approve</Button>
              </div>
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
                {isCopied ? "Copied!" : "Share Link"}
            </Button>
            {rtcError && (
                <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-500 font-bold animate-pulse">
                    {rtcError}
                </span>
            )}
            <span className={`text-xs px-2 py-1 rounded-full ${
                connectionStatus.includes('connected') ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
                {connectionStatus}
            </span>
            {/* Start Call button only needed if manual start is required, but flow is auto now */}
            {/* <Button size="sm" onClick={startCall} variant="outline" className="text-black bg-white hover:bg-gray-200">
                Start Call (Initiator)
            </Button> */}
        </div>
      </div>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 relative">
        
        {/* Local Feed */}
        <div className="relative bg-muted rounded-2xl overflow-hidden border border-border aspect-video w-full shadow-md">
          <video 
            ref={localVideoRef} 
            autoPlay 
            playsInline 
            muted 
            className={`absolute inset-0 w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`} 
          />
          {!isVideoOff && (
            <canvas 
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none"
                width={640} // Should match video aspect ratio approx
                height={480}
            />
          )}
          
          <div className="absolute bottom-4 left-4 right-4 bg-background/60 p-3 rounded-lg backdrop-blur-sm border border-border/50">
            <p className="text-xs text-muted-foreground mb-1">Your Sentence:</p>
            <p className="text-lg font-medium min-h-[1.5rem]">{localSubtitles || "Start signing..."}</p>
          </div>

          <div className="absolute top-4 left-4 bg-background/50 px-2 py-1 rounded text-xs border border-border/30 backdrop-blur-sm">
            You {isMuted && '(Muted)'}
          </div>
        </div>

        {/* Remote Feed */}
        <div className="relative bg-muted rounded-2xl overflow-hidden border border-border aspect-video w-full shadow-md">
          <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              className={`w-full h-full object-cover ${!remoteStream ? 'hidden' : ''}`} 
          />
          
          {!remoteStream && (
             <div className="flex items-center justify-center h-full text-muted-foreground">
                {isHost ? "Waiting for guest to join..." : "Connecting to Host..."}
             </div>
          )}

          {/* Remote Subtitles */}
          {remoteSubtitles && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-popover/80 px-6 py-3 rounded-full backdrop-blur-md border border-border shadow-xl">
               <p className="text-xl font-semibold text-center text-popover-foreground">{remoteSubtitles}</p>
            </div>
          )}

           <div className="absolute top-4 left-4 bg-background/50 px-2 py-1 rounded text-xs flex items-center gap-2 border border-border/30">
             <div className={`w-2 h-2 rounded-full ${remoteStream ? 'bg-green-500' : 'bg-red-500'}`} />
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

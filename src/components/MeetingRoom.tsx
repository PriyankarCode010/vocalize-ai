import { useEffect, useRef, useState } from 'react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useASLRecognition, drawLandmarks } from '@/hooks/useASLRecognition';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useTTS } from '@/hooks/useTTS';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Video, VideoOff, Volume2, X, Share2, Copy, Check } from 'lucide-react';

export default function MeetingRoom() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [remoteSubtitle, setRemoteSubtitle] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Hooks
  const { speak } = useTTS();
  const { sentenceString, addToSentence, clearSentence } = useSentenceBuilder();
  
  const { 
    localStream, 
    remoteStream, 
    sendSubtitle, 
    startCall, 
    connectionStatus 
  } = useWebRTC((text) => {
    setRemoteSubtitle(text);
    // Optional: Auto-speak remote subtitles?
    // speak(text); 
  });

  const { 
    isInitialized, 
    currentPrediction, 
    landmarks 
  } = useASLRecognition({ 
    videoRef: localVideoRef, 
    enabled: !isVideoOff 
  });

  // Attach streams to video elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Handle ASL Predictions
  useEffect(() => {
    if (currentPrediction) {
      addToSentence(currentPrediction);
    }
  }, [currentPrediction, addToSentence]);

  // Sync Sentence with Remote
  useEffect(() => {
    sendSubtitle(sentenceString);
  }, [sentenceString, sendSubtitle]);

  // Draw Landmarks
  useEffect(() => {
    if (!canvasRef.current || !landmarks) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    drawLandmarks(ctx, landmarks);
  }, [landmarks]);

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
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-white p-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
            Vocalize AI Meeting
        </h1>
        <div className="flex items-center gap-2">
            <Button 
                size="sm" 
                variant="outline" 
                className="text-black bg-white hover:bg-gray-200 gap-2"
                onClick={handleShare}
            >
                {isCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                {isCopied ? "Copied!" : "Share Link"}
            </Button>
            <span className={`text-xs px-2 py-1 rounded-full ${
                connectionStatus === 'connected' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
                {connectionStatus}
            </span>
            <Button size="sm" onClick={startCall} variant="outline" className="text-black bg-white hover:bg-gray-200">
                Start Call (Initiator)
            </Button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 relative">
        
        {/* Local Feed */}
        <div className="relative bg-neutral-900 rounded-2xl overflow-hidden border border-neutral-800">
          <video 
            ref={localVideoRef} 
            autoPlay 
            playsInline 
            muted 
            className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`} 
          />
          {!isVideoOff && (
            <canvas 
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none"
                width={640} // Should match video aspect ratio approx
                height={480}
            />
          )}
          
          <div className="absolute bottom-4 left-4 right-4 bg-black/60 p-3 rounded-lg backdrop-blur-sm">
            <p className="text-xs text-neutral-400 mb-1">Your Sentence:</p>
            <p className="text-lg font-medium min-h-[1.5rem]">{sentenceString || "Start signing..."}</p>
          </div>

          <div className="absolute top-4 left-4 bg-black/50 px-2 py-1 rounded text-xs">
            You {isMuted && '(Muted)'}
          </div>
        </div>

        {/* Remote Feed */}
        <div className="relative bg-neutral-900 rounded-2xl overflow-hidden border border-neutral-800">
          {remoteStream ? (
            <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover" 
            />
          ) : (
             <div className="flex items-center justify-center h-full text-neutral-500">
                Waiting for peer...
             </div>
          )}

          {/* Remote Subtitles */}
          {remoteSubtitle && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-black/80 px-6 py-3 rounded-full backdrop-blur-md border border-neutral-700">
               <p className="text-xl font-semibold text-center">{remoteSubtitle}</p>
            </div>
          )}

           <div className="absolute top-4 left-4 bg-black/50 px-2 py-1 rounded text-xs">
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

         <div className="w-px h-8 bg-neutral-800 mx-2" />

         <Button 
            variant="outline" 
            className="rounded-full gap-2 border-neutral-700 hover:bg-neutral-800 text-white"
            onClick={clearSentence}
         >
            <X className="h-4 w-4" />
            Clear
         </Button>

         <Button 
            className="rounded-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => speak(sentenceString)}
            disabled={!sentenceString}
         >
            <Volume2 className="h-4 w-4" />
            Speak
         </Button>
      </div>
    </div>
  );
}

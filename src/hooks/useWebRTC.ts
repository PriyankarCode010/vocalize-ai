import { useEffect, useRef, useState, useCallback } from 'react';

const WEBSOCKET_URL = 'ws://localhost:8080';
const ICE_SERVERS = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

interface UseWebRTCReturn {
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    sendSubtitle: (text: string) => void;
    startCall: () => void;
    connectionStatus: string;
}

export function useWebRTC(
    onSubtitleReceived: (text: string) => void
): UseWebRTCReturn {
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<string>('disconnected');

    const wsRef = useRef<WebSocket | null>(null);
    const peerRef = useRef<RTCPeerConnection | null>(null);
    const dataChannelRef = useRef<RTCDataChannel | null>(null);
    const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);

    // 1. Initialize Local Media (Once)
    useEffect(() => {
        let mounted = true;
        const getMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                if (mounted) {
                    setLocalStream(stream);
                } else {
                    // Cleanup if unmounted before release
                    stream.getTracks().forEach(t => t.stop());
                }
            } catch (err) {
                console.error('Error accessing media devices:', err);
            }
        };
        getMedia();
        return () => { mounted = false; };
    }, []);

    // 2. Initialize WebRTC & Signaling (Dependent on Local Stream)
    useEffect(() => {
        // Wait for local stream before setting up P2P (simplifies track addition)
        // Actually, we can setup PC first, but adding tracks is easier if stream exists.
        // To allow "Late Joiner", we should just setup PC and add tracks if available.

        // Strict Mode: This effect runs twice. We must cleanup.

        // Setup WebSocket
        const ws = new WebSocket(WEBSOCKET_URL);
        wsRef.current = ws;

        // Setup PC
        const pc = new RTCPeerConnection(ICE_SERVERS);
        peerRef.current = pc;

        // --- WebSocket Handlers ---
        ws.onopen = () => setConnectionStatus('connected to signaling');
        ws.onclose = () => setConnectionStatus('disconnected');
        ws.onerror = (err) => console.error('WS Error:', err);

        ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            if (!peerRef.current) return;

            try {
                if (message.type === 'offer') {
                    console.log('Received offer');
                    await peerRef.current.setRemoteDescription(new RTCSessionDescription(message));

                    // Process queued ICE candidates
                    while (iceCandidateQueue.current.length > 0) {
                        const candidate = iceCandidateQueue.current.shift();
                        if (candidate) await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                    }

                    // Add local tracks if we have them
                    if (localStream) {
                        localStream.getTracks().forEach(track => {
                            // Check if already added to avoid duplication? 
                            // PC is new, so just add.
                            peerRef.current?.addTrack(track, localStream);
                        });
                    }

                    const answer = await peerRef.current.createAnswer();
                    await peerRef.current.setLocalDescription(answer);
                    ws.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));

                } else if (message.type === 'answer') {
                    console.log('Received answer');
                    await peerRef.current.setRemoteDescription(new RTCSessionDescription(message));
                    // Process queued ICE candidates
                    while (iceCandidateQueue.current.length > 0) {
                        const candidate = iceCandidateQueue.current.shift();
                        if (candidate) await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                    }

                } else if (message.candidate) {
                    console.log('Received ICE candidate');
                    if (peerRef.current.remoteDescription) {
                        await peerRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
                    } else {
                        // Queue it
                        console.log('Queueing ICE candidate (no remote description)');
                        iceCandidateQueue.current.push(message.candidate);
                    }

                } else if (message.type === 'ready-to-call') {
                    console.log('Match found! You can start the call.');
                    // Optional: setConnectionStatus('ready to call')
                }
            } catch (e) {
                console.error('Signaling error:', e);
            }
        };

        // --- PC Handlers ---
        pc.onicecandidate = (event) => {
            if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ candidate: event.candidate }));
            }
        };

        pc.ontrack = (event) => {
            console.log('Received remote track');
            setRemoteStream(event.streams[0]);
            setConnectionStatus('connected');
        };

        pc.ondatachannel = (event) => {
            console.log('Received data channel');
            const receiveChannel = event.channel;
            dataChannelRef.current = receiveChannel;
            receiveChannel.onmessage = (e) => onSubtitleReceived(e.data);
        };

        // Add Tracks to PC immediately if stream exists
        // (If stream comes LATER, we need another effect... see step 3)
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }

        return () => {
            console.log("Cleaning up WebRTC");
            ws.close();
            pc.close();
            // Don't stop localStream here, keep it for re-renders
        };
    }, [localStream]); // Re-run if localStream changes (to ensure tracks added to fresh PC)


    // Start Call Logic
    const startCall = useCallback(async () => {
        const pc = peerRef.current;
        if (!pc) return;

        console.log('Starting call...');
        // Create Data Channel
        const dataChannel = pc.createDataChannel('subtitles');
        dataChannelRef.current = dataChannel;
        dataChannel.onmessage = (e) => onSubtitleReceived(e.data);

        // Create Offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
        }
    }, [onSubtitleReceived]);

    const sendSubtitle = useCallback((text: string) => {
        if (dataChannelRef.current?.readyState === 'open') {
            dataChannelRef.current.send(text);
        }
    }, []);

    return { localStream, remoteStream, sendSubtitle, startCall, connectionStatus, error };
}

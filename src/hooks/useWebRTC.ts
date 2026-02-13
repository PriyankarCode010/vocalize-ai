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
    error: string | null;
}

export function useWebRTC(
    onSubtitleReceived: (text: string) => void
): UseWebRTCReturn {
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<string>('disconnected');
    const [error, setError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const peerRef = useRef<RTCPeerConnection | null>(null);
    const dataChannelRef = useRef<RTCDataChannel | null>(null);
    const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);

    // 1. Initialize Local Media (Once)
    useEffect(() => {
        let mounted = true;
        console.log('[useWebRTC] Initializing local media...');
        const getMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                if (mounted) {
                    console.log('[useWebRTC] Local media acquired');
                    setLocalStream(stream);
                } else {
                    stream.getTracks().forEach(t => t.stop());
                }
            } catch (err) {
                console.error('[useWebRTC] Error accessing media devices:', err);
                setError('Failed to access camera/microphone');
            }
        };
        getMedia();
        return () => { mounted = false; };
    }, []);

    // 2. Initialize WebRTC & Signaling (Dependent on Local Stream)
    useEffect(() => {
        if (!localStream) {
            console.log('[useWebRTC] Waiting for local stream before init...');
            return;
        }

        console.log('[useWebRTC] Initializing WebRTC/Signaling...');

        // Setup WebSocket
        const ws = new WebSocket(WEBSOCKET_URL);
        wsRef.current = ws;

        // Setup PC
        const pc = new RTCPeerConnection(ICE_SERVERS);
        peerRef.current = pc;

        // --- WebSocket Handlers ---
        ws.onopen = () => {
            console.log('[Signaling] Connected');
            setConnectionStatus('connected to signaling');
            setError(null);
        };

        ws.onclose = () => {
            console.log('[Signaling] Disconnected');
            setConnectionStatus('disconnected');
        };

        ws.onerror = (err) => {
            console.error('[Signaling] Error:', err);
            setError('Signaling Server Error. Is it running on port 8080?');
        };

        ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            if (!peerRef.current) return;

            try {
                if (message.type === 'offer') {
                    console.log('[Signaling] Received offer');
                    await peerRef.current.setRemoteDescription(new RTCSessionDescription(message));

                    // Process queued ICE candidates
                    while (iceCandidateQueue.current.length > 0) {
                        const candidate = iceCandidateQueue.current.shift();
                        if (candidate) {
                            console.log('[WebRTC] Adding queued ICE candidate');
                            await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                        }
                    }

                    // Add local tracks
                    if (localStream) {
                        localStream.getTracks().forEach(track => {
                            try {
                                peerRef.current?.addTrack(track, localStream);
                            } catch (e) {
                                // Ignore if track already added
                            }
                        });
                    }

                    const answer = await peerRef.current.createAnswer();
                    await peerRef.current.setLocalDescription(answer);
                    console.log('[Signaling] Sending answer');
                    ws.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));

                } else if (message.type === 'answer') {
                    console.log('[Signaling] Received answer');
                    await peerRef.current.setRemoteDescription(new RTCSessionDescription(message));

                    // Process queued ICE candidates
                    while (iceCandidateQueue.current.length > 0) {
                        const candidate = iceCandidateQueue.current.shift();
                        if (candidate) {
                            console.log('[WebRTC] Adding queued ICE candidate');
                            await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                        }
                    }

                } else if (message.candidate) {
                    console.log('[Signaling] Received ICE candidate');
                    if (peerRef.current.remoteDescription) {
                        await peerRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
                    } else {
                        console.log('[WebRTC] Queueing ICE candidate (no remote desc)');
                        iceCandidateQueue.current.push(message.candidate);
                    }

                } else if (message.type === 'ready-to-call') {
                    console.log('[Signaling] Peer ready to call');
                }
            } catch (e) {
                console.error('[WebRTC] Error processing message:', e);
                setError('Error processing signaling message');
            }
        };

        // --- PC Handlers ---
        pc.onicecandidate = (event) => {
            if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
                console.log('[WebRTC] Generated ICE candidate');
                wsRef.current.send(JSON.stringify({ candidate: event.candidate }));
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log('[WebRTC] ICE Connection State:', pc.iceConnectionState);
        };

        pc.ontrack = (event) => {
            console.log('[WebRTC] Received remote track');
            setRemoteStream(event.streams[0]);
            setConnectionStatus('connected');
        };

        pc.ondatachannel = (event) => {
            console.log('[WebRTC] Received data channel');
            const receiveChannel = event.channel;
            dataChannelRef.current = receiveChannel;
            receiveChannel.onmessage = (e) => onSubtitleReceived(e.data);
        };

        // Add Tracks
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });

        return () => {
            console.log('[useWebRTC] Cleanup');
            ws.close();
            pc.close();
        };
    }, [localStream]);

    // Start Call Logic
    const startCall = useCallback(async () => {
        const pc = peerRef.current;
        if (!pc) return;

        console.log('[useWebRTC] Starting call (Initiator)...');

        // Create Data Channel
        const dataChannel = pc.createDataChannel('subtitles');
        dataChannelRef.current = dataChannel;
        dataChannel.onmessage = (e) => onSubtitleReceived(e.data);
        console.log('[WebRTC] Created data channel');

        // Create Offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log('[Signaling] Sending offer');

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
        } else {
            setError('Cannot start call: Signaling disconnected');
        }
    }, [onSubtitleReceived]);

    const sendSubtitle = useCallback((text: string) => {
        if (dataChannelRef.current?.readyState === 'open') {
            dataChannelRef.current.send(text);
        }
    }, []);

    return { localStream, remoteStream, sendSubtitle, startCall, connectionStatus, error };
}

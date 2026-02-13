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

    // Initialize WebRTC and Signaling
    useEffect(() => {
        // 1. Setup WebSocket
        const ws = new WebSocket(WEBSOCKET_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('Connected to signaling server');
            setConnectionStatus('connected to signaling');
        };

        // 2. Setup RTCPeerConnection
        const pc = new RTCPeerConnection(ICE_SERVERS);
        peerRef.current = pc;

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ candidate: event.candidate }));
            }
        };

        // Handle remote stream
        pc.ontrack = (event) => {
            console.log('Received remote track');
            setRemoteStream(event.streams[0]);
            setConnectionStatus('connected');
        };

        // Handle incoming Data Channel (Receiver side)
        pc.ondatachannel = (event) => {
            console.log('Received data channel');
            const receiveChannel = event.channel;
            dataChannelRef.current = receiveChannel; // Store it to send back if needed
            receiveChannel.onmessage = (e) => {
                onSubtitleReceived(e.data);
            };
        };

        // WebSocket Message Handling
        ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            if (!peerRef.current) return;

            try {
                if (message.type === 'offer') {
                    console.log('Received offer');
                    await peerRef.current.setRemoteDescription(new RTCSessionDescription(message));
                    const answer = await peerRef.current.createAnswer();
                    await peerRef.current.setLocalDescription(answer);
                    ws.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
                } else if (message.type === 'answer') {
                    console.log('Received answer');
                    await peerRef.current.setRemoteDescription(new RTCSessionDescription(message));
                } else if (message.candidate) {
                    console.log('Received ICE candidate');
                    await peerRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
                } else if (message.type === 'ready-to-call') {
                    console.log('Server says ready to call');
                    // Can trigger auto-call here if desired, or let UI do it
                }
            } catch (e) {
                console.error('Signaling error:', e);
            }
        };

        // Cleanup
        return () => {
            ws.close();
            if (peerRef.current) {
                peerRef.current.close();
            }
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
        };
    }, []); // Empty dependency array: run once on mount

    // Initialize Local Media
    useEffect(() => {
        const getMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                setLocalStream(stream);
                if (peerRef.current) {
                    stream.getTracks().forEach((track) => peerRef.current?.addTrack(track, stream));
                }
            } catch (err) {
                console.error('Error accessing media devices:', err);
            }
        };
        getMedia();
    }, []);

    // Start Call (Initiator key action)
    const startCall = useCallback(async () => {
        const pc = peerRef.current;
        if (!pc) return;

        // Create Data Channel (Initiator side)
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

    return { localStream, remoteStream, sendSubtitle, startCall, connectionStatus };
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { RealtimeChannel } from '@supabase/supabase-js';

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
    isHost: boolean;
    guestStatus: 'idle' | 'waiting' | 'approved' | 'rejected';
    guestRequest: string | null; // ID of the guest waiting
    approveGuest: (guestId: string) => void;
    rejectGuest: (guestId: string) => void;
}

export function useWebRTC(
    onSubtitleReceived: (text: string) => void
): UseWebRTCReturn {
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<string>('disconnected');
    const [error, setError] = useState<string | null>(null);

    // Host / Guest Logic
    const [isHost, setIsHost] = useState(false);
    const [guestStatus, setGuestStatus] = useState<'idle' | 'waiting' | 'approved' | 'rejected'>('idle');
    const [guestRequest, setGuestRequest] = useState<string | null>(null);
    const [myId, setMyId] = useState<string>('');

    const channelRef = useRef<RealtimeChannel | null>(null);
    const peerRef = useRef<RTCPeerConnection | null>(null);
    const dataChannelRef = useRef<RTCDataChannel | null>(null);
    const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);

    // 1. Initialize Local Media (Once)
    useEffect(() => {
        let mounted = true;
        const id = crypto.randomUUID();
        setMyId(id);

        console.log('[useWebRTC] Initializing local media...', id);
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

    // 2. Initialize Supabase Realtime & WebRTC
    useEffect(() => {
        if (!localStream || !myId) return;

        const supabase = getSupabaseBrowserClient();
        const roomName = 'meeting-room-v1'; // TODO: Make dynamic if needed
        const channel = supabase.channel(roomName, {
            config: {
                presence: {
                    key: myId,
                },
            },
        });
        channelRef.current = channel;

        // Setup PC
        const pc = new RTCPeerConnection(ICE_SERVERS);
        peerRef.current = pc;

        // --- PC Handlers ---
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                channel.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: { type: 'candidate', candidate: event.candidate, from: myId }
                });
            }
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

        // --- Channel Handlers ---
        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                const users = Object.keys(state).map(key => {
                    const presence = state[key][0] as any;
                    return {
                        id: key,
                        joinedAt: new Date(presence.at as string).getTime() // Supabase adds 'at' timestamp
                    };
                }).sort((a, b) => a.joinedAt - b.joinedAt);

                if (users.length > 0) {
                    const hostId = users[0].id;
                    const amIHost = hostId === myId;
                    setIsHost(amIHost);
                    console.log(`[Presence] I am ${amIHost ? 'HOST' : 'GUEST'}. Host is ${hostId}`);

                    if (!amIHost && guestStatus === 'idle') {
                        // Automatically request to join if I'm a guest and haven't requested yet
                        console.log('[Signaling] Requesting to join as Guest...');
                        setGuestStatus('waiting');
                        channel.send({
                            type: 'broadcast',
                            event: 'join-request',
                            payload: { guestId: myId }
                        });
                    }
                }
            })
            .on('broadcast', { event: 'join-request' }, ({ payload }: { payload: { guestId: string } }) => {
                // Only Host cares about join requests
                // We need to use valid ref for isHost because of closure if not careful, 
                // but here we trust the state update will trigger re-render if needed. 
                // Actually, inside event listener 'isHost' might be stale.
                // Presence sync happens first usually. 
                // Let's rely on the user interface to check `isHost` before showing the request.
                // But we need to store the request.
                if (payload.guestId !== myId) {
                    console.log('[Signaling] Received Join Request from', payload.guestId);
                    setGuestRequest(payload.guestId);
                }
            })
            .on('broadcast', { event: 'approve-guest' }, ({ payload }: { payload: { guestId: string } }) => {
                if (payload.guestId === myId) {
                    console.log('[Signaling] Approved by Host!');
                    setGuestStatus('approved');
                    setConnectionStatus('connecting...');
                    // Host initiates the call usually, or Guest can now?
                    // Let's have the Host initiate the offer upon approval? 
                    // Or Guest sends 'ready-for-offer'.
                    // Simpler: Host approves -> Host creates Offer immediately.
                }
            })
            .on('broadcast', { event: 'reject-guest' }, ({ payload }: { payload: { guestId: string } }) => {
                if (payload.guestId === myId) {
                    console.log('[Signaling] Rejected by Host.');
                    setGuestStatus('rejected');
                }
            })
            .on('broadcast', { event: 'signal' }, async ({ payload }: { payload: any }) => {
                if (payload.from === myId) return; // Ignore own messages

                try {
                    if (payload.type === 'offer') {
                        console.log('[Signaling] Received offer');
                        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        channel.send({
                            type: 'broadcast',
                            event: 'signal',
                            payload: { type: 'answer', sdp: answer.sdp, from: myId }
                        });

                    } else if (payload.type === 'answer') {
                        console.log('[Signaling] Received answer');
                        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

                    } else if (payload.type === 'candidate') {
                        console.log('[Signaling] Received ICE candidate');
                        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
                    }
                } catch (e) {
                    console.error('[WebRTC] Error processing signal:', e);
                }
            })
            .subscribe(async (status: string) => {
                if (status === 'SUBSCRIBED') {
                    console.log('[Signaling] Connected to Supabase channel');
                    setConnectionStatus('connected to signaling');
                    await channel.track({ joined_at: new Date().toISOString() });
                }
            });

        return () => {
            console.log('[useWebRTC] Cleanup');
            channel.unsubscribe();
            pc.close();
        };
    }, [localStream, myId]);


    const startCall = useCallback(async () => {
        // Now called automatically when Host approves
        const pc = peerRef.current;
        const channel = channelRef.current;
        if (!pc || !channel) return;

        console.log('[useWebRTC] Starting call (Creating Offer)...');

        // Create Data Channel
        const dataChannel = pc.createDataChannel('subtitles');
        dataChannelRef.current = dataChannel;
        dataChannel.onmessage = (e) => onSubtitleReceived(e.data);

        // Create Offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        channel.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type: 'offer', sdp: offer, from: myId }
        });
    }, [myId, onSubtitleReceived]);


    const approveGuest = useCallback((guestId: string) => {
        if (!channelRef.current) return;
        channelRef.current.send({
            type: 'broadcast',
            event: 'approve-guest',
            payload: { guestId }
        });
        setGuestRequest(null);
        // Determine who calls whom?
        // Let's say Host calls Guest upon approval.
        setTimeout(() => {
            startCall();
        }, 1000);
    }, [startCall]);

    const rejectGuest = useCallback((guestId: string) => {
        if (!channelRef.current) return;
        channelRef.current.send({
            type: 'broadcast',
            event: 'reject-guest',
            payload: { guestId }
        });
        setGuestRequest(null);
    }, []);

    const sendSubtitle = useCallback((text: string) => {
        if (dataChannelRef.current?.readyState === 'open') {
            dataChannelRef.current.send(text);
        }
    }, []);

    return {
        localStream,
        remoteStream,
        sendSubtitle,
        startCall,
        connectionStatus,
        error,
        isHost,
        guestStatus,
        guestRequest,
        approveGuest,
        rejectGuest
    };
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { RealtimeChannel } from '@supabase/supabase-js';

const getIceServers = () => {
    const servers: RTCIceServer[] = [
        { urls: 'stun:stun.l.google.com:19302' }
    ];

    if (process.env.NEXT_PUBLIC_TURN_URL && process.env.NEXT_PUBLIC_TURN_USERNAME && process.env.NEXT_PUBLIC_TURN_PASSWORD) {
        servers.push({
            urls: process.env.NEXT_PUBLIC_TURN_URL,
            username: process.env.NEXT_PUBLIC_TURN_USERNAME,
            credential: process.env.NEXT_PUBLIC_TURN_PASSWORD,
        });
    }
    return { iceServers: servers };
};

interface UseWebRTCReturn {
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    sendSubtitle: (text: string) => void;
    startCall: () => void;
    leaveCall: () => void;
    connectionStatus: string;
    error: string | null;
    isHost: boolean;
    guestStatus: 'idle' | 'waiting' | 'approved' | 'rejected';
    guestRequest: string | null; // ID of the guest waiting
    approveGuest: (guestId: string) => void;
    rejectGuest: (guestId: string) => void;
}

export function useWebRTC(
    onSubtitleReceived: (text: string) => void,
    roomId: string
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
        if (!localStream || !myId || !roomId) return;

        console.log('[useWebRTC] Connecting to room:', roomId);
        const supabase = getSupabaseBrowserClient();
        const channel = supabase.channel(roomId, {
            config: {
                presence: {
                    key: myId,
                },
            },
        });
        channelRef.current = channel;

        // Setup PC
        const pc = new RTCPeerConnection(getIceServers());
        peerRef.current = pc;

        // --- PC Handlers ---
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[WebRTC] 🧊 Generated ICE candidate:', event.candidate.candidate);
                channel.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: { type: 'candidate', candidate: event.candidate, from: myId }
                });
            } else {
                console.log('[WebRTC] 🧊 ICE gathering complete');
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log('[WebRTC] 🔄 ICE Connection State Change:', pc.iceConnectionState);
        };

        pc.onconnectionstatechange = () => {
            console.log('[WebRTC] 🔄 Connection State Change:', pc.connectionState);
            if (pc.connectionState === 'connected') {
                setConnectionStatus('connected');
            } else if (pc.connectionState === 'failed') {
                setConnectionStatus('failed');
                setError('Connection failed. Please refresh.');
            }
        };

        pc.onsignalingstatechange = () => {
            console.log('[WebRTC] 🚦 Signaling State Change:', pc.signalingState);
        };

        pc.ontrack = (event) => {
            console.log('[WebRTC] 🎥 Received remote track:', event.streams[0].id);
            setRemoteStream(event.streams[0]);
        };

        pc.ondatachannel = (event) => {
            console.log('[WebRTC] 📨 Received data channel:', event.channel.label);
            const receiveChannel = event.channel;
            dataChannelRef.current = receiveChannel;
            receiveChannel.onopen = () => console.log('[DataChannel] Open');
            receiveChannel.onclose = () => console.log('[DataChannel] Closed');
            receiveChannel.onmessage = (e) => onSubtitleReceived(e.data);
        };

        // Add Tracks
        localStream.getTracks().forEach(track => {
            console.log(`[WebRTC] Adding local track: ${track.kind} (${track.label})`);
            pc.addTrack(track, localStream);
        });

        // --- Channel Handlers ---
        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                console.log('[Presence] 👥 Sync:', state);
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
                        console.log('[Signaling] 👇 Requesting to join as Guest...');
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
                    console.log('[Signaling] 📩 Received Join Request from', payload.guestId);
                    setGuestRequest(payload.guestId);
                }
            })
            .on('broadcast', { event: 'approve-guest' }, ({ payload }: { payload: { guestId: string } }) => {
                if (payload.guestId === myId) {
                    console.log('[Signaling] ✅ Approved by Host! Waiting for offer...');
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
                    console.log('[Signaling] ❌ Rejected by Host.');
                    setGuestStatus('rejected');
                }
            })
            .on('broadcast', { event: 'signal' }, async ({ payload }: { payload: any }) => {
                if (payload.from === myId) return; // Ignore own messages

                try {
                    console.log(`[Signaling] 📨 Received signal: ${payload.type} from ${payload.from}`);

                    if (payload.type === 'offer') {
                        console.log('[Signaling] Handling Offer...');
                        if (pc.signalingState !== 'stable') {
                            console.warn('[Signaling] Received offer in non-stable state, ignoring or rolling back? State:', pc.signalingState);
                            // In a simple app, we might just proceed or error out.
                            // Ideally, we should handle glare, but let's just log for now.
                        }
                        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                        console.log('[WebRTC] Remote description set (Offer)');

                        const answer = await pc.createAnswer();
                        console.log('[WebRTC] Answer created');
                        await pc.setLocalDescription(answer);
                        console.log('[WebRTC] Local description set (Answer)');

                        channel.send({
                            type: 'broadcast',
                            event: 'signal',
                            payload: { type: 'answer', sdp: answer, from: myId }
                        });
                        console.log('[Signaling] Sent Answer');

                    } else if (payload.type === 'answer') {
                        console.log('[Signaling] Handling Answer...');
                        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                        console.log('[WebRTC] Remote description set (Answer)');

                    } else if (payload.type === 'candidate') {
                        console.log('[Signaling] Handling ICE Candidate...');
                        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
                        console.log('[WebRTC] Added ICE Candidate');
                    }
                } catch (e) {
                    console.error('[WebRTC] 💥 Error processing signal:', e);
                }
            })
            .subscribe(async (status: string) => {
                console.log(`[Supabase] Channel status change: ${status}`);
                if (status === 'SUBSCRIBED') {
                    console.log('[Signaling] Connected to Supabase channel:', roomId);
                    setConnectionStatus('connected to signaling');
                    await channel.track({ joined_at: new Date().toISOString() });
                }
            });

        return () => {
            console.log('[useWebRTC] Cleanup channel:', roomId);
            channel.unsubscribe();
            pc.close();
        };
    }, [localStream, myId, roomId]);


    const startCall = useCallback(async () => {
        // Now called automatically when Host approves
        const pc = peerRef.current;
        const channel = channelRef.current;
        if (!pc || !channel) {
            console.error('[useWebRTC] ❌ Cannot start call: PC or Channel missing', { pc: !!pc, channel: !!channel });
            return;
        }

        console.log('[useWebRTC] 📞 Starting call (Creating Offer)...');

        // Create Data Channel
        try {
            const dataChannel = pc.createDataChannel('subtitles');
            console.log('[WebRTC] 📨 Created data channel: subtitles');
            dataChannelRef.current = dataChannel;
            dataChannel.onmessage = (e) => onSubtitleReceived(e.data);

            // Create Offer
            const offer = await pc.createOffer();
            console.log('[WebRTC] 📜 Offer created');
            await pc.setLocalDescription(offer);
            console.log('[WebRTC] 📜 Local description set (Offer)');

            channel.send({
                type: 'broadcast',
                event: 'signal',
                payload: { type: 'offer', sdp: offer, from: myId }
            });
            console.log('[Signaling] 📤 Sent Offer');
        } catch (err) {
            console.error('[useWebRTC] 💥 Error creating offer:', err);
        }
    }, [myId, onSubtitleReceived]);


    const approveGuest = useCallback((guestId: string) => {
        if (!channelRef.current) return;
        console.log('[useWebRTC] ✅ Approving guest:', guestId);
        channelRef.current.send({
            type: 'broadcast',
            event: 'approve-guest',
            payload: { guestId }
        });
        setGuestRequest(null);
        // Determine who calls whom?
        // Let's say Host calls Guest upon approval.
        setTimeout(() => {
            console.log('[useWebRTC] ⏳ Timeout trigger: Calling startCall()');
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

    const leaveCall = useCallback(() => {
        console.log('[useWebRTC] Leaving call...');

        // Stop local tracks
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }

        // Close Peer Connection
        if (peerRef.current) {
            peerRef.current.close();
        }

        // Unsubscribe from Supabase
        if (channelRef.current) {
            channelRef.current.unsubscribe();
        }

        // Reset state
        setLocalStream(null);
        setRemoteStream(null);
        setConnectionStatus('disconnected');
        setGuestStatus('idle');
        setIsHost(false);
    }, [localStream]);

    return {
        localStream,
        remoteStream,
        sendSubtitle,
        startCall,
        leaveCall,
        connectionStatus,
        error,
        isHost,
        guestStatus,
        guestRequest,
        approveGuest,
        rejectGuest
    };
}

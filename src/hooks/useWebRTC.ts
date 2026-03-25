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
    const startCallRequestedRef = useRef(false);

    // 1. Initialize Local Media (Once)
    useEffect(() => {
        let mounted = true;
        const id = crypto.randomUUID();
        setMyId(id);

        const getMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { 
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        facingMode: 'user'
                    }, 
                    audio: true 
                });
                
                if (mounted) {
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
        return () => { 
            mounted = false;
        };
    }, []);

    // 2. Initialize Supabase Realtime & WebRTC
    useEffect(() => {
        if (!localStream || !myId || !roomId) return;

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
                // RTCIceCandidate isn't JSON-serializable; always send the plain init form.
                const candidateWithToJSON = event.candidate as unknown as {
                    toJSON?: () => RTCIceCandidateInit;
                    candidate: string;
                    sdpMid?: string | null;
                    sdpMLineIndex?: number | null;
                };
                const candidateInit =
                    typeof candidateWithToJSON.toJSON === 'function'
                        ? candidateWithToJSON.toJSON()
                        : {
                              candidate: candidateWithToJSON.candidate,
                              sdpMid: candidateWithToJSON.sdpMid,
                              sdpMLineIndex: candidateWithToJSON.sdpMLineIndex,
                          };
                channel.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: { type: 'candidate', candidate: candidateInit, from: myId }
                });
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log('[useWebRTC] iceConnectionState', pc.iceConnectionState);
            if (pc.iceConnectionState === 'failed') {
                setError('Connection failed. Please refresh.');
            }
        };

        pc.onconnectionstatechange = () => {
            console.log('[useWebRTC] connectionState', pc.connectionState);
            if (pc.connectionState === 'connected') {
                setConnectionStatus('connected');
            } else if (pc.connectionState === 'failed') {
                setConnectionStatus('failed');
                setError('Connection failed. Please refresh.');
            }
        };

        pc.onsignalingstatechange = () => {
            // Signaling state changes are noisy, only log errors
            if (pc.signalingState === 'closed') {
                console.error('[WebRTC] Signaling failed:', pc.signalingState);
            }
        };

        pc.ontrack = (event) => {
            console.log('[useWebRTC] ontrack received', {
                kind: event.track.kind,
                trackId: event.track.id
            });
            setRemoteStream((prev) => {
                if (prev) {
                    const existingTrack = prev.getTracks().find((t: MediaStreamTrack) => t.id === event.track.id);
                    if (existingTrack) {
                        return prev;
                    }
                    
                    const newStream = new MediaStream(prev.getTracks());
                    newStream.addTrack(event.track);
                    return newStream;
                } else {
                    return new MediaStream([event.track]);
                }
            });
        };

        pc.ondatachannel = (event) => {
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
                    const presence = state[key][0] as unknown as { at?: string };
                    return {
                        id: key,
                        joinedAt: presence.at ? new Date(presence.at).getTime() : 0
                    };
                }).sort((a, b) => a.joinedAt - b.joinedAt);

                if (users.length > 0) {
                    const hostId = users[0].id;
                    const amIHost = hostId === myId;
                    setIsHost(amIHost);

                    if (!amIHost && guestStatus === 'idle') {
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
                if (payload.guestId !== myId) {
                    setGuestRequest(payload.guestId);
                }
            })
            .on('broadcast', { event: 'approve-guest' }, ({ payload }: { payload: { guestId: string } }) => {
                if (payload.guestId === myId) {
                    setGuestStatus('approved');
                    setConnectionStatus('connecting...');
                    // Only the approved guest should initiate the WebRTC offer.
                    startCallRequestedRef.current = true;
                    console.log('[useWebRTC] approve-guest received for me; will startCall');
                }
            })
            .on('broadcast', { event: 'reject-guest' }, ({ payload }: { payload: { guestId: string } }) => {
                if (payload.guestId === myId) {
                    setGuestStatus('rejected');
                }
            })
            .on('broadcast', { event: 'signal' }, async ({ payload }: { payload: unknown }) => {
                if (!payload || typeof payload !== 'object') return;
                const p = payload as Partial<{
                    from: string;
                    type: 'offer' | 'answer' | 'candidate';
                    sdp: RTCSessionDescriptionInit;
                    candidate: RTCIceCandidateInit;
                }>;

                if (!p.from || p.from === myId) return; // Ignore own messages / invalid payload

                try {
                    if (p.type === 'offer') {
                        if (pc.signalingState === 'closed') return;
                        if (!p.sdp) return;
                        // Don't ignore offers due to timing; just ensure we only set it once.
                        if (pc.remoteDescription) {
                            console.log('[useWebRTC] ignoring duplicate offer (remoteDescription already set)');
                            return;
                        }
                        await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
                        console.log('[useWebRTC] offer applied, creating answer');

                        // Process queued candidates
                        while (iceCandidateQueue.current.length > 0) {
                            const cand = iceCandidateQueue.current.shift();
                            if (cand) {
                                try {
                                    await pc.addIceCandidate(new RTCIceCandidate(cand));
                                } catch (e) {
                                    console.error('[WebRTC] Error processing queued candidate:', e);
                                }
                            }
                        }

                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);

                        channel.send({
                            type: 'broadcast',
                            event: 'signal',
                            payload: {
                                type: 'answer',
                                sdp: (answer as RTCSessionDescription).toJSON
                                    ? (answer as RTCSessionDescription).toJSON()
                                    : { type: (answer as RTCSessionDescription).type, sdp: (answer as RTCSessionDescription).sdp },
                                from: myId
                            }
                        });
                        console.log('[useWebRTC] answer sent');

                    } else if (p.type === 'answer') {
                        if (!p.sdp) return;
                        if (pc.remoteDescription) {
                            console.log('[useWebRTC] ignoring duplicate answer (remoteDescription already set)');
                            return;
                        }
                        console.log('[useWebRTC] applying remote answer');
                        await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));

                        // Process queued candidates
                        while (iceCandidateQueue.current.length > 0) {
                            const cand = iceCandidateQueue.current.shift();
                            if (cand) {
                                try {
                                    await pc.addIceCandidate(new RTCIceCandidate(cand));
                                } catch (e) {
                                    console.error('[WebRTC] Error processing queued candidate:', e);
                                }
                            }
                        }

                    } else if (p.type === 'candidate') {
                        if (!p.candidate || !p.candidate.candidate) return;

                        if (pc.remoteDescription) {
                            await pc.addIceCandidate(new RTCIceCandidate(p.candidate));
                        } else {
                            iceCandidateQueue.current.push(p.candidate);
                        }
                    }
                } catch (e) {
                    console.error('[WebRTC] 💥 Error processing signal:', e);
                }
            })
            .subscribe(async (status: string) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ joined_at: new Date().toISOString() });
                }
            });

        return () => {
            channel.unsubscribe();
            pc.close();
        };
    }, [localStream, myId, roomId]);


    const startCall = useCallback(async () => {
        const pc = peerRef.current;
        const channel = channelRef.current;
        if (!pc || !channel) {
            return;
        }

        // Create Data Channel
        try {
            const dataChannel = pc.createDataChannel('subtitles');
            dataChannelRef.current = dataChannel;
            dataChannel.onmessage = (e) => onSubtitleReceived(e.data);

            // Create Offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            channel.send({
                type: 'broadcast',
                event: 'signal',
                payload: {
                    type: 'offer',
                    sdp: (offer as RTCSessionDescription).toJSON
                        ? (offer as RTCSessionDescription).toJSON()
                        : { type: (offer as RTCSessionDescription).type, sdp: (offer as RTCSessionDescription).sdp },
                    from: myId
                }
            });
        } catch (err) {
            console.error('[useWebRTC] 💥 Error creating offer:', err);
        }
    }, [myId, onSubtitleReceived]);

    // When the host approves us, we initiate the WebRTC offer exactly once.
    useEffect(() => {
        if (guestStatus !== 'approved') return;
        if (!startCallRequestedRef.current) return;

        startCallRequestedRef.current = false;
        console.log('[useWebRTC] starting WebRTC offer now');
        void startCall();
    }, [guestStatus, startCall]);


    const approveGuest = useCallback((guestId: string) => {
        if (!channelRef.current) return;
        channelRef.current.send({
            type: 'broadcast',
            event: 'approve-guest',
            payload: { guestId }
        });
        setGuestRequest(null);
    }, []);

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
        // Stop local tracks
        if (localStream) {
            localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
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
        startCallRequestedRef.current = false;
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

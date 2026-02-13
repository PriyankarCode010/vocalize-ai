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
                channel.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: { type: 'candidate', candidate: event.candidate, from: myId }
                });
            }
        };

        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'failed') {
                setError('Connection failed. Please refresh.');
            }
        };

        pc.onconnectionstatechange = () => {
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
                    const presence = state[key][0] as any;
                    return {
                        id: key,
                        joinedAt: new Date(presence.at as string).getTime()
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
                }
            })
            .on('broadcast', { event: 'reject-guest' }, ({ payload }: { payload: { guestId: string } }) => {
                if (payload.guestId === myId) {
                    setGuestStatus('rejected');
                }
            })
            .on('broadcast', { event: 'signal' }, async ({ payload }: { payload: any }) => {
                if (payload.from === myId) return; // Ignore own messages

                try {
                    if (payload.type === 'offer') {
                        if (pc.signalingState !== 'stable') {
                            return;
                        }
                        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

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
                            payload: { type: 'answer', sdp: answer, from: myId }
                        });

                    } else if (payload.type === 'answer') {
                        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

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

                    } else if (payload.type === 'candidate') {
                        if (pc.remoteDescription) {
                            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
                        } else {
                            iceCandidateQueue.current.push(payload.candidate);
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
                payload: { type: 'offer', sdp: offer, from: myId }
            });
        } catch (err) {
            console.error('[useWebRTC] 💥 Error creating offer:', err);
        }
    }, [myId, onSubtitleReceived]);


    const approveGuest = useCallback((guestId: string) => {
        if (!channelRef.current) return;
        channelRef.current.send({
            type: 'broadcast',
            event: 'approve-guest',
            payload: { guestId }
        });
        setGuestRequest(null);
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

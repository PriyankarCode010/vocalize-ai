# WebRTC Implementation - Pseudocode

## Table of Contents
1. [Create Peer Connection](#1-create-peer-connection)
2. [Handle Incoming Signal](#2-handle-incoming-signal)
3. [Flush ICE Candidates](#3-flush-ice-candidates)
4. [Call Peer (Initiate Call)](#4-call-peer-initiate-call)
5. [Subscribe to Signals](#5-subscribe-to-signals)
6. [Send Signal](#6-send-signal)
7. [ICE Candidate Event Handler](#7-ice-candidate-event-handler)

---

## 1. Create Peer Connection

```
FUNCTION createPeerConnection(meetingId, selfId, remoteId, localStream):
    // Initialize RTCPeerConnection with ICE configuration
    pc = NEW RTCPeerConnection(iceConfig)
    
    // Add local media tracks to peer connection
    FOR EACH track IN localStream.getTracks():
        pc.addTrack(track, localStream)
    
    // Setup ICE candidate event handler
    pc.onicecandidate = FUNCTION(event):
        IF event.candidate IS NOT NULL AND candidate is not empty:
            sendSignal({
                type: "ice",
                from_peer: selfId,
                to_peer: remoteId,
                payload: event.candidate.toJSON()
            })
    
    // Setup remote track event handler
    pc.ontrack = FUNCTION(event):
        stream = event.streams[0]
        IF stream EXISTS:
            addPeerToStore(remoteId, stream)
    
    // Setup connection state change handler
    pc.onconnectionstatechange = FUNCTION():
        IF pc.connectionState IS "disconnected" OR "failed":
            removePeerFromStore(remoteId)
    
    RETURN pc
END FUNCTION
```

---

## 2. Handle Incoming Signal

```
FUNCTION handleIncomingSignal(meetingId, selfId, pcs, localStream, signal):
    // Validate signal is for this peer
    IF signal.from_peer == selfId:
        RETURN  // Ignore own signals
    
    IF signal.to_peer IS NOT NULL AND signal.to_peer != selfId:
        RETURN  // Signal not intended for this peer
    
    // Get or create peer connection
    pc = pcs.get(signal.from_peer)
    IF pc IS NULL:
        pc = createPeerConnection(meetingId, selfId, signal.from_peer, localStream)
        pcs.set(signal.from_peer, pc)
    
    // Process signal based on type
    IF signal.type == "offer":
        // Handle incoming offer
        pc.setRemoteDescription(NEW RTCSessionDescription(signal.payload))
        answer = pc.createAnswer()
        pc.setLocalDescription(answer)
        sendSignal({
            type: "answer",
            from_peer: selfId,
            to_peer: signal.from_peer,
            payload: answer
        })
        flushIceCandidates(pc, signal.from_peer, meetingId, selfId)
    
    ELSE IF signal.type == "answer":
        // Handle incoming answer
        IF pc.currentRemoteDescription IS NULL:
            pc.setRemoteDescription(NEW RTCSessionDescription(signal.payload))
            flushIceCandidates(pc, signal.from_peer, meetingId, selfId)
    
    ELSE IF signal.type == "ice":
        // Handle incoming ICE candidate
        IF signal.payload IS NULL OR candidate is empty:
            RETURN  // Ignore invalid candidates
        
        IF pc.remoteDescription IS NULL:
            // Buffer candidate for later
            buffer = iceCandidateBuffers.get(signal.from_peer) OR []
            buffer.push(NEW RTCIceCandidate(signal.payload))
            iceCandidateBuffers.set(signal.from_peer, buffer)
        ELSE:
            // Add candidate immediately
            pc.addIceCandidate(NEW RTCIceCandidate(signal.payload))
END FUNCTION
```

---

## 3. Flush ICE Candidates

```
FUNCTION flushIceCandidates(pc, peerId, meetingId, selfId):
    // Get buffered candidates for this peer
    buffer = iceCandidateBuffers.get(peerId)
    
    IF buffer IS NULL OR buffer.length == 0:
        RETURN  // No candidates to flush
    
    // Process all buffered candidates in order
    FOR EACH candidate IN buffer:
        TRY:
            pc.addIceCandidate(candidate)
        CATCH error:
            LOG error
    
    // Clear buffer after flushing
    iceCandidateBuffers.delete(peerId)
END FUNCTION
```

---

## 4. Call Peer (Initiate Call)

```
FUNCTION callPeer(meetingId, selfId, remoteId, pc):
    // Create WebRTC offer
    offer = pc.createOffer()
    
    // Set local description with offer
    pc.setLocalDescription(offer)
    
    // Send offer to remote peer via signaling
    sendSignal({
        meeting_id: meetingId,
        type: "offer",
        from_peer: selfId,
        to_peer: remoteId,
        payload: offer
    })
END FUNCTION
```

---

## 5. Subscribe to Signals

```
FUNCTION subscribeSignals(meetingId, onSignal):
    supabase = getSupabaseBrowserClient()
    
    // Create realtime channel for meeting signals
    channel = supabase.channel("signals:" + meetingId)
    
    // Listen for new signal inserts
    channel.on("postgres_changes", {
        event: "INSERT",
        table: "meeting_signals",
        filter: "meeting_id == meetingId"
    }, FUNCTION(payload):
        signal = payload.new
        onSignal(signal)  // Callback with received signal
    )
    
    // Subscribe to channel
    channel.subscribe()
    
    // Return unsubscribe function
    RETURN FUNCTION():
        channel.unsubscribe()
END FUNCTION
```

---

## 6. Send Signal

```
FUNCTION sendSignal(payload):
    supabase = getSupabaseBrowserClient()
    
    // Insert signal into database
    result = supabase.from("meeting_signals").insert({
        meeting_id: payload.meeting_id,
        from_peer: payload.from_peer,
        to_peer: payload.to_peer,
        type: payload.type,
        payload: payload.payload
    })
    
    IF result.error:
        LOG error
    ELSE:
        LOG success
END FUNCTION
```

---

## 7. ICE Candidate Event Handler

```
EVENT HANDLER pc.onicecandidate(event):
    // Validate candidate before sending
    IF event.candidate IS NOT NULL:
        IF event.candidate.candidate IS NOT NULL:
            IF event.candidate.candidate.trim() != "":
                // Send valid ICE candidate via signaling
                sendSignal({
                    meeting_id: meetingId,
                    type: "ice",
                    from_peer: selfId,
                    to_peer: remoteId,
                    payload: event.candidate.toJSON()
                })
END EVENT HANDLER
```

---

## Key Data Structures

### ICE Candidate Buffer
```
iceCandidateBuffers: Map<peerId, RTCIceCandidate[]>
    - Stores buffered ICE candidates per peer
    - Used when candidates arrive before remote description is set
```

### Peer Connections Map
```
pcs: Map<peerId, RTCPeerConnection>
    - Stores active peer connections
    - Key: remote peer ID
    - Value: RTCPeerConnection instance
```

### Signal Types
```
Signal Types:
    - "offer": WebRTC offer SDP
    - "answer": WebRTC answer SDP
    - "ice": ICE candidate information
```

---

## WebRTC Signaling Flow

```
1. Peer A initiates call:
   callPeer() → createOffer() → setLocalDescription() → sendSignal("offer")

2. Peer B receives offer:
   handleIncomingSignal("offer") → setRemoteDescription() → createAnswer() 
   → setLocalDescription() → sendSignal("answer") → flushIceCandidates()

3. Peer A receives answer:
   handleIncomingSignal("answer") → setRemoteDescription() → flushIceCandidates()

4. ICE candidates exchanged:
   onicecandidate() → sendSignal("ice")
   handleIncomingSignal("ice") → buffer OR addIceCandidate()
```

---

## Important Notes

1. **ICE Candidate Ordering**: Candidates must be added after `setRemoteDescription()` is called
2. **Buffering**: Early-arriving candidates are buffered and flushed after remote description is set
3. **Validation**: Null/empty candidates are filtered at both send and receive
4. **Signaling**: Uses Supabase Realtime for peer-to-peer signaling
5. **Connection Management**: Peer connections are stored in a Map and cleaned up on disconnect

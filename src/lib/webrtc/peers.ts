"use client"

import { iceConfig } from "./config"
import { sendSignal } from "./signaling"
import { useMeetingStore } from "@/hooks/useMeetingStore"

// Per-peer ICE candidate buffer: Map<peerId, RTCIceCandidate[]>
const iceCandidateBuffers = new Map<string, RTCIceCandidate[]>()

export async function createPeerConnection(
  meetingId: string,
  selfId: string,
  remoteId: string,
  localStream: MediaStream
) {
  console.log("[webrtc] createPeerConnection called", {
    meetingId,
    selfId,
    remoteId,
    trackKinds: localStream.getTracks().map((t) => t.kind),
  })
  const pc = new RTCPeerConnection(iceConfig)
  console.log("[webrtc] RTCPeerConnection created", {
    meetingId,
    selfId,
    remoteId,
    iceServers: iceConfig.iceServers,
  })

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))
  console.log("[webrtc] local tracks added to pc", {
    meetingId,
    selfId,
    remoteId,
    audioTracks: localStream.getAudioTracks().length,
    videoTracks: localStream.getVideoTracks().length,
  })

  pc.onicecandidate = (event) => {
    // Only send non-null, non-empty candidates
    if (event.candidate && event.candidate.candidate && event.candidate.candidate.trim() !== "") {
      console.log("[webrtc] onicecandidate", {
        meetingId,
        selfId,
        remoteId,
        candidate: event.candidate,
      })
      void sendSignal({
        meeting_id: meetingId,
        from_peer: selfId,
        to_peer: remoteId,
        type: "ice",
        payload: event.candidate.toJSON(),
      })
    }
  }

  pc.ontrack = (event) => {
    const [stream] = event.streams
    if (stream) {
      console.log("[webrtc] ontrack received", {
        meetingId,
        selfId,
        remoteId,
        trackKinds: event.streams?.[0]?.getTracks().map((t) => t.kind),
      })
      useMeetingStore.getState().addPeer({ peerId: remoteId, stream })
    }
  }

  pc.onconnectionstatechange = () => {
    console.log("[webrtc] connection state", {
      meetingId,
      selfId,
      remoteId,
      state: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
    })
    if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
      useMeetingStore.getState().removePeer(remoteId)
    }
  }

  return pc
}

/**
 * Flushes buffered ICE candidates for a peer connection.
 * This should be called after setRemoteDescription() is called.
 */
async function flushIceCandidates(
  pc: RTCPeerConnection,
  peerId: string,
  meetingId: string,
  selfId: string
): Promise<void> {
  const buffer = iceCandidateBuffers.get(peerId)
  if (!buffer || buffer.length === 0) {
    return
  }

  console.log("[webrtc] flushing buffered ICE candidates", {
    meetingId,
    selfId,
    peerId,
    count: buffer.length,
  })

  // Process all buffered candidates in order
  for (const candidate of buffer) {
    try {
      await pc.addIceCandidate(candidate)
      console.log("[webrtc] added buffered ice candidate", {
        meetingId,
        from: peerId,
        to: selfId,
      })
    } catch (error) {
      console.error("[webrtc] Error adding buffered ICE candidate", {
        meetingId,
        from: peerId,
        to: selfId,
        error,
      })
    }
  }

  // Clear the buffer after flushing
  iceCandidateBuffers.delete(peerId)
  console.log("[webrtc] cleared ICE candidate buffer", {
    meetingId,
    selfId,
    peerId,
  })
}

export async function handleIncomingSignal(
  meetingId: string,
  selfId: string,
  pcs: Map<string, RTCPeerConnection>,
  localStream: MediaStream,
  signal: { from_peer: string; to_peer: string | null; type: "offer" | "answer" | "ice"; payload: any }
) {
  if (signal.from_peer === selfId) return
  if (signal.to_peer && signal.to_peer !== selfId) {
    console.log("[webrtc] ignoring signal for different peer", {
      meetingId,
      selfId,
      expectedTo: selfId,
      actualTo: signal.to_peer,
      from: signal.from_peer,
      type: signal.type,
    })
    return
  }

  console.log("[webrtc] incoming signal", {
    meetingId,
    selfId,
    from: signal.from_peer,
    to: signal.to_peer,
    type: signal.type,
  })

  let pc = pcs.get(signal.from_peer)
  if (!pc) {
    console.log("[webrtc] no existing pc found for peer, creating new one", {
      meetingId,
      selfId,
      remoteId: signal.from_peer,
    })
    pc = await createPeerConnection(meetingId, selfId, signal.from_peer, localStream)
    pcs.set(signal.from_peer, pc)
  }

  if (signal.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
    console.log("[webrtc] set remote offer, creating answer", {
      meetingId,
      from: signal.from_peer,
      to: selfId,
    })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await sendSignal({
      meeting_id: meetingId,
      from_peer: selfId,
      to_peer: signal.from_peer,
      type: "answer",
      payload: answer,
    })
    console.log("[webrtc] sent answer", {
      meetingId,
      from: selfId,
      to: signal.from_peer,
    })
    // Flush any buffered ICE candidates after setting remote description
    await flushIceCandidates(pc, signal.from_peer, meetingId, selfId)
  } else if (signal.type === "answer") {
    if (!pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
      console.log("[webrtc] set remote answer", {
        meetingId,
        from: signal.from_peer,
        to: selfId,
      })
      // Flush any buffered ICE candidates after setting remote description
      await flushIceCandidates(pc, signal.from_peer, meetingId, selfId)
    }
  } else if (signal.type === "ice") {
    // Validate payload: must exist and not be null/empty
    if (!signal.payload || !signal.payload.candidate || signal.payload.candidate.trim() === "") {
      console.log("[webrtc] ignoring null or empty ICE candidate", {
        meetingId,
        from: signal.from_peer,
        to: selfId,
      })
      return
    }

    // Check if remote description is set before adding ICE candidate
    if (!pc.remoteDescription) {
      // Buffer the candidate for later
      console.log("[webrtc] buffering ICE candidate (remote description not set)", {
        meetingId,
        from: signal.from_peer,
        to: selfId,
      })
      const buffer = iceCandidateBuffers.get(signal.from_peer) || []
      try {
        buffer.push(new RTCIceCandidate(signal.payload))
        iceCandidateBuffers.set(signal.from_peer, buffer)
      } catch (error) {
        console.error("[webrtc] Error creating RTCIceCandidate from payload", {
          meetingId,
          from: signal.from_peer,
          to: selfId,
          error,
        })
      }
    } else {
      // Remote description is set, add candidate immediately
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.payload))
        console.log("[webrtc] added ice candidate", {
          meetingId,
          from: signal.from_peer,
          to: selfId,
        })
      } catch (error) {
        console.error("[webrtc] Error adding ICE candidate", {
          meetingId,
          from: signal.from_peer,
          to: selfId,
          error,
        })
      }
    }
  }
}

export async function callPeer(
  meetingId: string,
  selfId: string,
  remoteId: string,
  pc: RTCPeerConnection
) {
  console.log("[webrtc] callPeer start", {
    meetingId,
    selfId,
    remoteId,
    signalingState: pc.signalingState,
    connectionState: pc.connectionState,
  })
  const offer = await pc.createOffer()
  console.log("[webrtc] offer created", {
    meetingId,
    selfId,
    remoteId,
    type: offer.type,
    hasSdp: !!offer.sdp,
  })
  await pc.setLocalDescription(offer)
  console.log("[webrtc] local description set (offer)", {
    meetingId,
    selfId,
    remoteId,
    signalingState: pc.signalingState,
  })
  await sendSignal({
    meeting_id: meetingId,
    from_peer: selfId,
    to_peer: remoteId,
    type: "offer",
    payload: offer,
  })
  console.log("[webrtc] offer signal sent", {
    meetingId,
    from: selfId,
    to: remoteId,
  })
}





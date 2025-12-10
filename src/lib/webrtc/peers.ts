"use client"

import { iceConfig } from "./config"
import { sendSignal } from "./signaling"
import { useMeetingStore } from "@/hooks/useMeetingStore"

export async function createPeerConnection(
  meetingId: string,
  selfId: string,
  remoteId: string,
  localStream: MediaStream
) {
  const pc = new RTCPeerConnection(iceConfig)

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))

  pc.onicecandidate = (event) => {
    if (event.candidate) {
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
      console.log("[webrtc] ontrack received", { from: remoteId, to: selfId, trackKinds: event.streams?.[0]?.getTracks().map((t) => t.kind) })
      useMeetingStore.getState().addPeer({ peerId: remoteId, stream })
    }
  }

  pc.onconnectionstatechange = () => {
    console.log("[webrtc] connection state", { selfId, remoteId, state: pc.connectionState })
    if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
      useMeetingStore.getState().removePeer(remoteId)
    }
  }

  return pc
}

export async function handleIncomingSignal(
  meetingId: string,
  selfId: string,
  pcs: Map<string, RTCPeerConnection>,
  localStream: MediaStream,
  signal: { from_peer: string; to_peer: string | null; type: "offer" | "answer" | "ice"; payload: any }
) {
  if (signal.from_peer === selfId) return
  if (signal.to_peer && signal.to_peer !== selfId) return

  console.log("[webrtc] incoming signal", { meetingId, selfId, signal })

  let pc = pcs.get(signal.from_peer)
  if (!pc) {
    pc = await createPeerConnection(meetingId, selfId, signal.from_peer, localStream)
    pcs.set(signal.from_peer, pc)
  }

  if (signal.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
    console.log("[webrtc] set remote offer, creating answer", { from: signal.from_peer, to: selfId })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await sendSignal({
      meeting_id: meetingId,
      from_peer: selfId,
      to_peer: signal.from_peer,
      type: "answer",
      payload: answer,
    })
    console.log("[webrtc] sent answer", { from: selfId, to: signal.from_peer })
  } else if (signal.type === "answer") {
    if (!pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
      console.log("[webrtc] set remote answer", { from: signal.from_peer, to: selfId })
    }
  } else if (signal.type === "ice" && signal.payload) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(signal.payload))
      console.log("[webrtc] added ice candidate", { from: signal.from_peer, to: selfId })
    } catch (error) {
      console.error("Error adding ICE candidate", error)
    }
  }
}

export async function callPeer(
  meetingId: string,
  selfId: string,
  remoteId: string,
  pc: RTCPeerConnection
) {
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  await sendSignal({
    meeting_id: meetingId,
    from_peer: selfId,
    to_peer: remoteId,
    type: "offer",
    payload: offer,
  })
}





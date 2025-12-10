"use client"

import { create } from "zustand"

type PeerStream = { peerId: string; stream: MediaStream }

type ControlState = {
  mic: boolean
  cam: boolean
  screen: boolean
}

type MeetingState = {
  localStream: MediaStream | null
  peers: PeerStream[]
  controls: ControlState
  setLocalStream: (stream: MediaStream | null) => void
  addPeer: (peer: PeerStream) => void
  removePeer: (peerId: string) => void
  setControls: (partial: Partial<ControlState>) => void
  reset: () => void
}

export const useMeetingStore = create<MeetingState>((set) => ({
  localStream: null,
  peers: [],
  controls: { mic: true, cam: true, screen: false },
  setLocalStream: (stream) => set({ localStream: stream }),
  addPeer: (peer) =>
    set((state) => {
      if (state.peers.some((p) => p.peerId === peer.peerId)) return state
      return { peers: [...state.peers, peer] }
    }),
  removePeer: (peerId) => set((state) => ({ peers: state.peers.filter((p) => p.peerId !== peerId) })),
  setControls: (partial) => set((state) => ({ controls: { ...state.controls, ...partial } })),
  reset: () => set({ localStream: null, peers: [], controls: { mic: true, cam: true, screen: false } }),
}))




"use client"

import React from "react"
import MeetingRoom from "@/components/MeetingRoom"

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  return <MeetingRoom roomId={id} />
}

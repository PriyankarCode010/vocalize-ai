export type Meeting = {
  id: string
  host_id: string | null
  title: string | null
  status: "scheduled" | "live" | "ended"
  created_at: string
}

export type MeetingRequest = {
  id: string
  meeting_id: string
  requester_id: string | null
  requester_name: string | null
  status: "pending" | "approved" | "rejected"
  created_at: string
}

export type MeetingSignal = {
  id: number
  meeting_id: string
  from_peer: string
  to_peer: string | null
  type: "offer" | "answer" | "ice"
  payload: any
  created_at: string
}





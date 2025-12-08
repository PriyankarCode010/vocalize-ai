import CallRoom from "@/components/CallRoom"
import { getSession } from "@/lib/auth/session"

type CallRoomPageProps = {
  params: { roomId: string }
}

export default async function CallRoomPage({ params }: CallRoomPageProps) {
  const session = await getSession()

  return (
    <div className="min-h-screen bg-background">
      <CallRoom roomId={params.roomId} userName={session?.name ?? "Guest"} />
    </div>
  )
}





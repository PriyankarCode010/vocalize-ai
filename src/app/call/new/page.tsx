import { redirect } from "next/navigation"

export default function NewCallPage() {
  const roomId = crypto.randomUUID()
  redirect(`/call/${roomId}`)
}









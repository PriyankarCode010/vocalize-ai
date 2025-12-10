const turnServers = [
  process.env.NEXT_PUBLIC_TURN_URL_UDP,
  process.env.NEXT_PUBLIC_TURN_URL_TCP,
  process.env.NEXT_PUBLIC_TURN_URL_TLS,
  process.env.NEXT_PUBLIC_TURN_URL_TURNS,
  process.env.NEXT_PUBLIC_TURN_URL,
].filter(Boolean) as string[]

export const iceConfig: RTCConfiguration = {
  iceServers: [
    // STUN(s)
    { urls: process.env.NEXT_PUBLIC_STUN_URL || "stun:stun.l.google.com:19302" },
    // TURN(s)
    ...turnServers.map((urls) => ({
      urls,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_PASSWORD,
    })),
  ],
}





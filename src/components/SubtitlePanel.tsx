"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export type CaptionItem = {
  id: string
  text: string
  speaker: "local" | "remote"
  interim?: boolean
  timestamp: number
}

type SubtitlePanelProps = {
  captions: CaptionItem[]
  listening: boolean
  onToggleListening: () => void
}

export function SubtitlePanel({ captions, listening, onToggleListening }: SubtitlePanelProps) {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Their Speech → Text</p>
          <CardTitle className="text-lg">Live Captions</CardTitle>
        </div>
        <Button size="sm" variant={listening ? "default" : "outline"} onClick={onToggleListening}>
          {listening ? "Stop Captions" : "Start Captions"}
        </Button>
      </CardHeader>
      <CardContent className="h-[320px]">
        <ScrollArea className="h-full rounded-md border">
          <div className="flex flex-col gap-3 p-4">
            {captions.length === 0 && <p className="text-sm text-muted-foreground">Captions will appear here.</p>}
            {captions.map((caption) => (
              <div key={caption.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={caption.speaker === "local" ? "secondary" : "default"} className="text-xs">
                    {caption.speaker === "local" ? "You" : "Partner"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(caption.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p
                  className={cn("rounded-md bg-muted/60 p-3 text-sm leading-relaxed", {
                    "opacity-70 italic": caption.interim,
                  })}
                >
                  {caption.text}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}









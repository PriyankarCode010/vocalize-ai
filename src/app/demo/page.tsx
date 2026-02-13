"use client"

import { useState } from "react"
import { Eye, Hand } from "lucide-react"

import Yolo11CameraDemo from "@/components/yolo11-camera-demo"
import HandDetector from "@/components/HandDetector"
import { Button } from "@/components/ui/button"

export default function DemoPage() {
  const [mode, setMode] = useState<"yolo" | "asl">("yolo")

  return (
    <div className="relative min-h-screen">
      {/* Switcher Control - Floating on top */}
      <div className="absolute top-4 right-4 z-50 flex gap-2 bg-background/80 p-2 rounded-lg backdrop-blur-sm shadow-sm border">
        <Button
          variant={mode === "yolo" ? "default" : "ghost"}
          size="sm"
          onClick={() => setMode("yolo")}
          className="gap-2"
        >
          <Eye className="h-4 w-4" />
          Object Detection
        </Button>
        <Button
          variant={mode === "asl" ? "default" : "ghost"}
          size="sm"
          onClick={() => setMode("asl")}
          className="gap-2"
        >
          <Hand className="h-4 w-4" />
          ASL Recognition
        </Button>
      </div>

      {mode === "yolo" ? <Yolo11CameraDemo /> : <HandDetector />}
    </div>
  )
}

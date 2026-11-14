import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  Pen,
  Highlighter,
  Eraser,
  RotateCcw,
  Trash2,
  Code2,
  FileText,
  Image as ImageIcon,
  Share2,
  Check,
  ChevronDown,
  Sparkles,
  Maximize2,
  X,
  Play,
} from "lucide-react";

interface LiveScreenShareStudioProps {
  onStreamReady: (stream: MediaStream) => void;
  onStopSharing: () => void;
  partnerName?: string;
  skillName?: string;
}

type StudioMode = "whiteboard" | "code" | "notes" | "slide";
type DrawTool = "pen" | "highlighter" | "eraser";

const COLOR_PALETTE = [
  { name: "White", hex: "#FFFFFF" },
  { name: "Sky Blue", hex: "#38BDF8" },
  { name: "Amber Gold", hex: "#FBBF24" },
  { name: "Mint Emerald", hex: "#34D399" },
  { name: "Crimson", hex: "#F43F5E" },
  { name: "Purple", hex: "#A855F7" },
];

export const LiveScreenShareStudio: React.FC<LiveScreenShareStudioProps> = ({
  onStreamReady,
  onStopSharing,
  partnerName = "Partner",
  skillName = "Live Skill Swap",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Studio Mode State
  const [activeMode, setActiveMode] = useState<StudioMode>("whiteboard");
  const [activeTool, setActiveTool] = useState<DrawTool>("pen");
  const [activeColor, setActiveColor] = useState<string>("#38BDF8");
  const [strokeWidth, setStrokeWidth] = useState<number>(4);

  // Content state for Code & Notes
  const [codeContent, setCodeContent] = useState<string>(
    `// Live Code Presentation for ${partnerName}\nfunction solveProblem(input) {\n  console.log("Analyzing skill swap solution...");\n  return input.map(x => x * 2);\n}\n\n// Try modifying this code live!\nconsole.log(solveProblem([1, 2, 3, 4]));`
  );
  const [codeLanguage, setCodeLanguage] = useState<string>("JavaScript");
  const [notesTitle, setNotesTitle] = useState<string>(`${skillName} - Key Notes`);
  const [notesContent, setNotesContent] = useState<string>(
    `• Concept Overview: Core Fundamentals\n• Step 1: Implementation Strategy\n• Step 2: Practical Live Demonstration\n• Q&A & Code Walkthrough`
  );

  // Slide Image state
  const slideImageRef = useRef<HTMLImageElement | null>(null);
  const [slideFileName, setSlideFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // History for Undo
  const historyRef = useRef<ImageData[]>([]);

  /**
   * Initialize Canvas and WebRTC MediaStream
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set internal resolution to 1280x720 (Crisp 16:9 720p HD)
    canvas.width = 1280;
    canvas.height = 720;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Initial background render
    renderStudioContent();

    // Capture standard 30 FPS MediaStream from canvas
    try {
      // @ts-ignore
      const stream: MediaStream = canvas.captureStream ? canvas.captureStream(30) : (canvas as any).mozCaptureStream(30);
      streamRef.current = stream;
      console.log("[SCREEN_STUDIO] Captured 30fps canvas MediaStream with tracks:", stream.getVideoTracks().length);
      onStreamReady(stream);
    } catch (err) {
      console.error("[SCREEN_STUDIO] canvas.captureStream error:", err);
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  /**
   * Save canvas snapshot for Undo
   */
  const saveSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current.push(snapshot);
    if (historyRef.current.length > 20) {
      historyRef.current.shift();
    }
  }, []);

  /**
   * Render Canvas Background based on Active Mode
   */
  const renderStudioContent = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Base dark backdrop
    ctx.fillStyle = "#0D1117";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle grid pattern for professional engineering / meeting look
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Header watermark / live badge on canvas
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctx.font = "bold 16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(`SwapSkill Live Screen Share · ${partnerName}`, 40, 42);

    ctx.fillStyle = "rgba(56, 189, 248, 0.85)";
    ctx.font = "bold 14px monospace";
    ctx.fillText(`[${activeMode.toUpperCase()}]`, canvas.width - 140, 42);

    if (activeMode === "code") {
      renderCodeCard(ctx, canvas);
    } else if (activeMode === "notes") {
      renderNotesCard(ctx, canvas);
    } else if (activeMode === "slide" && slideImageRef.current) {
      renderSlideImage(ctx, canvas);
    }
  }, [activeMode, codeContent, codeLanguage, notesTitle, notesContent, partnerName]);

  const renderCodeCard = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    // IDE Window Card
    const cardX = 40;
    const cardY = 65;
    const cardW = canvas.width - 80;
    const cardH = canvas.height - 100;

    // Window shadow & body
    ctx.fillStyle = "#161B22";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 12);
    ctx.fill();
    ctx.stroke();

    // Window Header Bar
    ctx.fillStyle = "#0D1117";
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, 42, [12, 12, 0, 0]);
    ctx.fill();

    // Window Buttons
    ctx.fillStyle = "#EF4444";
    ctx.beginPath();
    ctx.arc(cardX + 22, cardY + 21, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#F59E0B";
    ctx.beginPath();
    ctx.arc(cardX + 42, cardY + 21, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#10B981";
    ctx.beginPath();
    ctx.arc(cardX + 62, cardY + 21, 6, 0, Math.PI * 2);
    ctx.fill();

    // Window Title
    ctx.fillStyle = "#94A3B8";
    ctx.font = "14px monospace";
    ctx.fillText(`${codeLanguage} Snippet · Live Presentation`, cardX + 85, cardY + 26);

    // Code lines rendering with syntax styling
    ctx.font = "16px 'Fira Code', 'JetBrains Mono', Consolas, monospace";
    const lines = codeContent.split("\n");
    const startY = cardY + 75;
    const lineHeight = 26;

    lines.forEach((line, index) => {
      const lineY = startY + index * lineHeight;
      if (lineY > cardY + cardH - 20) return;

      // Line number
      ctx.fillStyle = "#475569";
      ctx.fillText(String(index + 1).padStart(3, " "), cardX + 20, lineY);

      // Syntax color determination
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
        ctx.fillStyle = "#6B7280"; // Comment
      } else if (trimmed.startsWith("function") || trimmed.startsWith("def ") || trimmed.startsWith("class ") || trimmed.startsWith("const ") || trimmed.startsWith("let ") || trimmed.startsWith("import ")) {
        ctx.fillStyle = "#F43F5E"; // Keyword
      } else if (trimmed.includes("return ") || trimmed.includes("console.log") || trimmed.includes("print")) {
        ctx.fillStyle = "#38BDF8"; // Function / Return
      } else if (trimmed.includes('"') || trimmed.includes("'") || trimmed.includes("`")) {
        ctx.fillStyle = "#34D399"; // String
      } else {
        ctx.fillStyle = "#F1F5F9"; // Normal text
      }

      ctx.fillText(line, cardX + 70, lineY);
    });
  };

  const renderNotesCard = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const cardX = 50;
    const cardY = 70;
    const cardW = canvas.width - 100;
    const cardH = canvas.height - 110;

    ctx.fillStyle = "#161B22";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 12);
    ctx.fill();
    ctx.stroke();

    // Notes Title
    ctx.fillStyle = "#FBBF24";
    ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(notesTitle, cardX + 35, cardY + 55);

    ctx.strokeStyle = "rgba(251, 191, 36, 0.3)";
    ctx.beginPath();
    ctx.moveTo(cardX + 35, cardY + 70);
    ctx.lineTo(cardX + cardW - 35, cardY + 70);
    ctx.stroke();

    // Notes Content
    ctx.fillStyle = "#E2E8F0";
    ctx.font = "19px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const lines = notesContent.split("\n");
    const startY = cardY + 115;
    const lineHeight = 34;

    lines.forEach((line, index) => {
      const lineY = startY + index * lineHeight;
      if (lineY > cardY + cardH - 30) return;
      ctx.fillText(line, cardX + 35, lineY);
    });
  };

  const renderSlideImage = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const img = slideImageRef.current;
    if (!img) return;

    const margin = 40;
    const maxW = canvas.width - margin * 2;
    const maxH = canvas.height - margin * 2;

    const ratio = Math.min(maxW / img.width, maxH / img.height);
    const drawW = img.width * ratio;
    const drawH = img.height * ratio;
    const drawX = (canvas.width - drawW) / 2;
    const drawY = (canvas.height - drawH) / 2 + 10;

    // Slide backing shadow
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#1E293B";
    ctx.fillRect(drawX, drawY, drawW, drawH);
    ctx.shadowColor = "transparent";

    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  };

  // Re-render when active mode or content changes
  useEffect(() => {
    renderStudioContent();
  }, [renderStudioContent]);

  /**
   * Pointer Drawing Engine (Works with Touch, Pen, & Mouse)
   */
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    saveSnapshot();

    isDrawingRef.current = true;
    const coords = getCanvasCoords(e);
    lastPointRef.current = coords;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.beginPath();
    ctx.arc(coords.x, coords.y, strokeWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = activeTool === "eraser" ? "#0D1117" : activeColor;
    ctx.fill();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawingRef.current || !lastPointRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentCoords = getCanvasCoords(e);

    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(currentCoords.x, currentCoords.y);

    if (activeTool === "eraser") {
      ctx.strokeStyle = "#0D1117";
      ctx.lineWidth = strokeWidth * 3;
      ctx.globalAlpha = 1;
    } else if (activeTool === "highlighter") {
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = strokeWidth * 2.5;
      ctx.globalAlpha = 0.35;
    } else {
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = strokeWidth;
      ctx.globalAlpha = 1;
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.globalAlpha = 1;

    lastPointRef.current = currentCoords;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleUndo = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (historyRef.current.length > 0) {
      const previousState = historyRef.current.pop();
      if (previousState) {
        ctx.putImageData(previousState, 0, 0);
      }
    } else {
      renderStudioContent();
    }
  };

  const handleClear = () => {
    saveSnapshot();
    renderStudioContent();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSlideFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        slideImageRef.current = img;
        setActiveMode("slide");
        renderStudioContent();
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#0A0D14] text-white overflow-hidden select-none animate-in fade-in zoom-in-95 duration-200">
      {/* Top Professional Floating Control Bar */}
      <div className="h-14 bg-[#111620]/95 backdrop-blur-xl border-b border-white/10 px-3 sm:px-6 flex items-center justify-between z-40 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold tracking-wide">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
            <span className="truncate max-w-[120px] sm:max-w-none">Live Screen Share</span>
          </div>
          <span className="hidden md:inline-block text-xs text-white/50">|</span>
          <span className="hidden md:inline-block text-xs font-medium text-white/70">
            Streaming to {partnerName} (30 FPS HD)
          </span>
        </div>

        {/* Studio Modes Tabs */}
        <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
          <button
            type="button"
            onClick={() => setActiveMode("whiteboard")}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeMode === "whiteboard"
                ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
                : "text-white/70 hover:text-white hover:bg-white/5"
            }`}
          >
            <Pen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Whiteboard</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMode("code")}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeMode === "code"
                ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
                : "text-white/70 hover:text-white hover:bg-white/5"
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Code</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMode("notes")}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeMode === "notes"
                ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
                : "text-white/70 hover:text-white hover:bg-white/5"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Notes</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeMode === "slide"
                ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
                : "text-white/70 hover:text-white hover:bg-white/5"
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Slides / Image</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>

        {/* Stop Sharing Button */}
        <button
          type="button"
          onClick={onStopSharing}
          className="px-3.5 sm:px-4 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs sm:text-sm font-bold shadow-lg shadow-rose-600/30 transition cursor-pointer shrink-0"
        >
          Stop Sharing
        </button>
      </div>

      {/* Main Studio Viewport */}
      <div className="relative flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden bg-[#0A0D14]">
        {/* The Live Broadcast Canvas */}
        <div className="relative w-full h-full max-w-5xl max-h-[82vh] aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-[#0D1117] flex items-center justify-center">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="w-full h-full object-contain cursor-crosshair touch-none"
          />

          {/* Code Editor Floating Drawer when in Code Mode */}
          {activeMode === "code" && (
            <div className="absolute bottom-3 right-3 left-3 sm:left-auto sm:w-96 p-3 rounded-xl bg-[#161B22]/95 backdrop-blur-md border border-white/15 shadow-2xl z-20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-sky-400">Live Code Input</span>
                <select
                  value={codeLanguage}
                  onChange={(e) => setCodeLanguage(e.target.value)}
                  className="bg-black/50 text-white text-[11px] rounded px-2 py-0.5 border border-white/20"
                >
                  <option value="JavaScript">JavaScript</option>
                  <option value="Python">Python</option>
                  <option value="React/TSX">React/TSX</option>
                  <option value="HTML/CSS">HTML/CSS</option>
                  <option value="SQL">SQL</option>
                </select>
              </div>
              <textarea
                value={codeContent}
                onChange={(e) => setCodeContent(e.target.value)}
                placeholder="Type or paste code here to update the live presentation..."
                rows={4}
                className="w-full bg-[#0D1117] text-white font-mono text-xs p-2 rounded-lg border border-white/10 focus:border-sky-500 focus:outline-none resize-none"
              />
              <span className="text-[10px] text-white/50 block mt-1">
                Updates directly in your partner's video stream
              </span>
            </div>
          )}

          {/* Notes Floating Drawer when in Notes Mode */}
          {activeMode === "notes" && (
            <div className="absolute bottom-3 right-3 left-3 sm:left-auto sm:w-96 p-3 rounded-xl bg-[#161B22]/95 backdrop-blur-md border border-white/15 shadow-2xl z-20">
              <span className="text-xs font-bold text-amber-400 block mb-1">Live Notes & Outline</span>
              <input
                type="text"
                value={notesTitle}
                onChange={(e) => setNotesTitle(e.target.value)}
                placeholder="Lesson / Topic Title"
                className="w-full bg-[#0D1117] text-white font-bold text-xs p-1.5 mb-2 rounded-lg border border-white/10 focus:border-amber-500 focus:outline-none"
              />
              <textarea
                value={notesContent}
                onChange={(e) => setNotesContent(e.target.value)}
                placeholder="Type bullet points or notes..."
                rows={3}
                className="w-full bg-[#0D1117] text-white text-xs p-2 rounded-lg border border-white/10 focus:border-amber-500 focus:outline-none resize-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Floating Whiteboard Toolbar */}
      <div className="h-16 bg-[#111620]/95 backdrop-blur-xl border-t border-white/10 px-3 sm:px-6 flex items-center justify-between z-40 shrink-0 overflow-x-auto">
        {/* Drawing Tools */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setActiveTool("pen")}
            className={`p-2 rounded-xl transition cursor-pointer ${
              activeTool === "pen"
                ? "bg-sky-500/25 border border-sky-400 text-sky-300 shadow-md"
                : "text-white/70 hover:text-white hover:bg-white/10"
            }`}
            title="Pen"
          >
            <Pen className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("highlighter")}
            className={`p-2 rounded-xl transition cursor-pointer ${
              activeTool === "highlighter"
                ? "bg-amber-500/25 border border-amber-400 text-amber-300 shadow-md"
                : "text-white/70 hover:text-white hover:bg-white/10"
            }`}
            title="Highlighter"
          >
            <Highlighter className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("eraser")}
            className={`p-2 rounded-xl transition cursor-pointer ${
              activeTool === "eraser"
                ? "bg-rose-500/25 border border-rose-400 text-rose-300 shadow-md"
                : "text-white/70 hover:text-white hover:bg-white/10"
            }`}
            title="Eraser"
          >
            <Eraser className="w-4 h-4" />
          </button>

          {/* Stroke Width Picker */}
          <div className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded-xl border border-white/10 ml-1">
            {[2, 4, 8].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setStrokeWidth(w)}
                className={`w-5 h-5 rounded-full flex items-center justify-center transition cursor-pointer ${
                  strokeWidth === w ? "bg-white/20" : "hover:bg-white/10"
                }`}
              >
                <span
                  className="rounded-full bg-white"
                  style={{ width: `${w * 1.5}px`, height: `${w * 1.5}px` }}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Color Palette */}
        <div className="flex items-center gap-1.5 sm:gap-2 mx-2">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => {
                setActiveColor(c.hex);
                if (activeTool === "eraser") setActiveTool("pen");
              }}
              style={{ backgroundColor: c.hex }}
              className={`w-6 h-6 rounded-full transition-transform cursor-pointer relative ${
                activeColor === c.hex && activeTool !== "eraser"
                  ? "ring-2 ring-white scale-110 shadow-lg"
                  : "hover:scale-105 opacity-80 hover:opacity-100"
              }`}
              title={c.name}
            />
          ))}
        </div>

        {/* Actions (Undo & Clear) */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={handleUndo}
            className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Undo stroke"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="p-2 rounded-xl text-white/70 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
            title="Clear canvas"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

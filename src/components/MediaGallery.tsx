import React, { useState } from "react";
import { Message } from "../types";
import { 
  FileText, 
  Video, 
  Mic, 
  Download, 
  ExternalLink, 
  X, 
  Image as ImageIcon,
  Layers,
  ArrowRight,
  Calendar
} from "lucide-react";

interface MediaGalleryProps {
  messages: Message[];
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}

type TabType = "images" | "videos" | "audio" | "files";

export default function MediaGallery({ messages, onClose, onJumpToMessage }: MediaGalleryProps) {
  const [activeTab, setActiveTab] = useState<TabType>("images");

  // Filter messages by media type
  const images = messages.filter((m) => m.imageUrl && !m.isDeleted);
  const videos = messages.filter((m) => m.fileUrl && m.fileType?.startsWith("video/") && !m.isDeleted);
  const audio = messages.filter((m) => m.audioUrl && !m.isDeleted);
  const files = messages.filter(
    (m) => m.fileUrl && !m.fileType?.startsWith("video/") && !m.isDeleted
  );

  const formatSize = (bytes?: number) => {
    if (!bytes) return "0 KB";
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(0)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  const formatTime = (ts?: any) => {
    if (!ts) return "";
    const date = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div className="w-80 border-l border-gray-200 bg-white flex flex-col h-full shrink-0 relative z-40 animate-slide-left shadow-2xl text-gray-900">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
            Vault Gallery
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-900 rounded-lg transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-4 p-2 gap-1 border-b border-gray-200 bg-gray-50 text-[10px] font-semibold">
        <button
          onClick={() => setActiveTab("images")}
          className={`py-1.5 rounded-lg flex flex-col items-center gap-1 transition ${
            activeTab === "images" 
              ? "bg-white text-gray-900 shadow-xs font-bold border border-gray-200" 
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Photos ({images.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("videos")}
          className={`py-1.5 rounded-lg flex flex-col items-center gap-1 transition ${
            activeTab === "videos" 
              ? "bg-white text-gray-900 shadow-xs font-bold border border-gray-200" 
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          <Video className="w-3.5 h-3.5" />
          <span>Videos ({videos.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("audio")}
          className={`py-1.5 rounded-lg flex flex-col items-center gap-1 transition ${
            activeTab === "audio" 
              ? "bg-white text-gray-900 shadow-xs font-bold border border-gray-200" 
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          <Mic className="w-3.5 h-3.5" />
          <span>Audio ({audio.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("files")}
          className={`py-1.5 rounded-lg flex flex-col items-center gap-1 transition ${
            activeTab === "files" 
              ? "bg-white text-gray-900 shadow-xs font-bold border border-gray-200" 
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Docs ({files.length})</span>
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Images Grid */}
        {activeTab === "images" && (
          images.length === 0 ? (
            <div className="text-center text-[11px] text-gray-400 py-12">No shared images</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {images.map((msg) => (
                <div key={msg.id} className="group relative rounded-xl overflow-hidden border border-gray-200 bg-slate-100 aspect-square">
                  <img
                    src={msg.imageUrl || undefined}
                    alt="gallery shared"
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                  />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition duration-200 flex flex-col justify-end p-2 gap-1.5">
                    <span className="text-[9px] text-white/80 flex items-center gap-1 font-mono">
                      <Calendar className="w-2.5 h-2.5" /> {formatTime(msg.timestamp)}
                    </span>
                    <div className="flex gap-1">
                      <a
                        href={msg.imageUrl}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg transition"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                      <button
                        onClick={() => onJumpToMessage(msg.id)}
                        className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition text-[9px] font-mono uppercase flex items-center gap-0.5"
                      >
                        Jump <ArrowRight className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Videos List */}
        {activeTab === "videos" && (
          videos.length === 0 ? (
            <div className="text-center text-[11px] text-gray-400 py-12">No shared videos</div>
          ) : (
            <div className="flex flex-col gap-2">
              {videos.map((msg) => (
                <div key={msg.id} className="p-3 bg-slate-50 border border-gray-200 rounded-xl flex flex-col gap-2 hover:border-blue-300 transition">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 bg-blue-100 rounded-lg shrink-0">
                      <Video className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-semibold text-gray-800 block truncate" title={msg.fileName}>
                        {msg.fileName}
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-0.5">
                        <span>{formatSize(msg.fileSize)}</span>
                        <span>•</span>
                        <span>{formatTime(msg.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-1">
                    <a
                      href={msg.fileUrl}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 h-7 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold uppercase rounded-lg transition flex items-center justify-center gap-1"
                    >
                      <Download className="w-3 h-3" /> Download
                    </a>
                    <button
                      onClick={() => onJumpToMessage(msg.id)}
                      className="h-7 px-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-[10px] font-bold uppercase rounded-lg transition flex items-center gap-1"
                    >
                      Jump <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Voice Notes List */}
        {activeTab === "audio" && (
          audio.length === 0 ? (
            <div className="text-center text-[11px] text-gray-400 py-12">No shared voice notes</div>
          ) : (
            <div className="flex flex-col gap-2">
              {audio.map((msg) => (
                <div key={msg.id} className="p-3 bg-slate-50 border border-gray-200 rounded-xl flex items-center justify-between gap-3 hover:border-blue-300 transition">
                  <div className="flex items-center gap-2 min-w-0">
                    <Mic className="w-4 h-4 text-blue-600 shrink-0" />
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-gray-800 block">Voice Note</span>
                      <span className="text-[10px] text-gray-400 block">{formatTime(msg.timestamp)}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <a
                      href={msg.audioUrl}
                      download="voice-note.webm"
                      className="p-1.5 bg-white border border-gray-200 hover:bg-gray-100 text-gray-600 rounded-lg transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => onJumpToMessage(msg.id)}
                      className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition"
                      title="Jump to message"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Files List */}
        {activeTab === "files" && (
          files.length === 0 ? (
            <div className="text-center text-[11px] text-gray-400 py-12">No shared files</div>
          ) : (
            <div className="flex flex-col gap-2">
              {files.map((msg) => (
                <div key={msg.id} className="p-3 bg-slate-50 border border-gray-200 rounded-xl flex flex-col gap-2 hover:border-emerald-300 transition">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 bg-emerald-100 rounded-lg shrink-0">
                      <FileText className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-semibold text-gray-800 block truncate" title={msg.fileName}>
                        {msg.fileName}
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-0.5">
                        <span>{formatSize(msg.fileSize)}</span>
                        <span>•</span>
                        <span>{formatTime(msg.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-1">
                    <a
                      href={msg.fileUrl}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 h-7 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase rounded-lg transition flex items-center justify-center gap-1"
                    >
                      <Download className="w-3 h-3" /> Download
                    </a>
                    <button
                      onClick={() => onJumpToMessage(msg.id)}
                      className="h-7 px-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-[10px] font-bold uppercase rounded-lg transition flex items-center gap-1"
                    >
                      Jump <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

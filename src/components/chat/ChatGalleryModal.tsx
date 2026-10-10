import React, { useState, useMemo } from "react";
import { X, Image as ImageIcon, FileText, Link2, Download, ExternalLink, Search } from "lucide-react";
import { sanitizeUrl } from "../../utils/urlSecurity";
import { extractAllUrls, getLinkMetadata } from "../../utils/linkPreview";

export interface GalleryMessageItem {
  id: string;
  senderId: string;
  text?: string;
  imageUrl?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  timestamp?: any;
}

interface ChatGalleryModalProps {
  isOpen: boolean;
  messages: GalleryMessageItem[];
  partnerName?: string;
  onSelectMessage?: (msgId: string) => void;
  onClose: () => void;
}

export const ChatGalleryModal: React.FC<ChatGalleryModalProps> = ({
  isOpen,
  messages,
  partnerName = "Contact",
  onSelectMessage,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<"media" | "docs" | "links">("media");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 1. Media List (Images)
  const mediaItems = useMemo(() => {
    return messages
      .filter((m) => Boolean(m.imageUrl))
      .map((m) => ({
        id: m.id,
        url: m.imageUrl!,
        timestamp: m.timestamp,
      }));
  }, [messages]);

  // 2. Documents List
  const docItems = useMemo(() => {
    return messages
      .filter((m) => Boolean(m.fileUrl))
      .map((m) => ({
        id: m.id,
        url: m.fileUrl!,
        name: m.fileName || "document",
        size: m.fileSize || 0,
        timestamp: m.timestamp,
      }));
  }, [messages]);

  // 3. Links List
  const linkItems = useMemo(() => {
    const list: { id: string; url: string; timestamp: any }[] = [];
    messages.forEach((m) => {
      if (m.text) {
        const urls = extractAllUrls(m.text);
        urls.forEach((u) => {
          list.push({ id: m.id, url: u, timestamp: m.timestamp });
        });
      }
    });
    return list;
  }, [messages]);

  if (!isOpen) return null;

  const formatItemDate = (ts: any) => {
    if (!ts) return "";
    try {
      let d: Date | null = null;
      if (typeof ts === "number") d = new Date(ts);
      else if (ts?.toDate) d = ts.toDate();
      else if (ts?.seconds !== undefined) d = new Date(ts.seconds * 1000);
      else if (ts instanceof Date) d = ts;
      else if (typeof ts === "string") {
        const p = Date.parse(ts);
        if (!isNaN(p)) d = new Date(p);
      }
      if (!d || isNaN(d.getTime())) return "";
      return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return "";
    }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return "File";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Shared Content"
      className="fixed inset-0 z-[120] bg-black/65 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#111216]/95 border border-white/[0.08] rounded-3xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.7)] flex flex-col h-[85vh] max-h-[700px] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between bg-black/20 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-white tracking-tight">Shared Content</h3>
            <p className="text-[11px] text-zinc-400">Media, Docs & Links with {partnerName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/10 active:scale-90 text-zinc-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            aria-label="Close shared content modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center px-4 pt-3 pb-1 border-b border-white/[0.05] gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("media")}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTab === "media"
                ? "bg-[#D4AF37] text-black shadow-md shadow-[#D4AF37]/20"
                : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
            }`}
          >
            <ImageIcon size={14} />
            <span>Media ({mediaItems.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("docs")}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTab === "docs"
                ? "bg-[#D4AF37] text-black shadow-md shadow-[#D4AF37]/20"
                : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
            }`}
          >
            <FileText size={14} />
            <span>Docs ({docItems.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("links")}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTab === "links"
                ? "bg-[#D4AF37] text-black shadow-md shadow-[#D4AF37]/20"
                : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
            }`}
          >
            <Link2 size={14} />
            <span>Links ({linkItems.length})</span>
          </button>
        </div>

        {/* Search input for docs & links */}
        {(activeTab === "docs" || activeTab === "links") && (
          <div className="px-4 py-2 border-b border-white/[0.05] shrink-0">
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${activeTab}...`}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#D4AF37]/70 transition"
              />
            </div>
          </div>
        )}

        {/* Tab Content Panels */}
        <div className="p-4 overflow-y-auto flex-1 scrollbar-none">
          {/* 1. MEDIA TAB */}
          {activeTab === "media" && (
            mediaItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-zinc-500">
                <ImageIcon size={32} className="mb-2 opacity-50" />
                <p className="text-xs">No media shared yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {mediaItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setPreviewImage(item.url)}
                    className="group relative aspect-square rounded-xl overflow-hidden bg-black/40 border border-white/[0.08] hover:border-[#D4AF37] transition cursor-pointer"
                  >
                    <img
                      src={item.url}
                      alt="shared"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-[10px] text-white font-medium">View</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* 2. DOCS TAB */}
          {activeTab === "docs" && (
            docItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-zinc-500">
                <FileText size={32} className="mb-2 opacity-50" />
                <p className="text-xs">No documents shared yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {docItems
                  .filter((d) => !searchQuery || d.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((doc) => (
                    <div
                      key={doc.id}
                      className="p-3 rounded-2xl bg-white/[0.025] hover:bg-white/[0.06] border border-white/[0.06] flex items-center justify-between gap-3 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/15 text-[#D4AF37] flex items-center justify-center shrink-0">
                          <FileText size={18} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{doc.name}</p>
                          <p className="text-[10px] text-zinc-400 font-mono tabular-nums mt-0.5">
                            {formatFileSize(doc.size)} · {formatItemDate(doc.timestamp)}
                          </p>
                        </div>
                      </div>

                      <a
                        href={sanitizeUrl(doc.url)}
                        download={doc.name}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-xl bg-white/[0.06] hover:bg-[#D4AF37] hover:text-black text-zinc-300 transition shrink-0 cursor-pointer"
                        title="Download Document"
                      >
                        <Download size={14} />
                      </a>
                    </div>
                  ))}
              </div>
            )
          )}

          {/* 3. LINKS TAB */}
          {activeTab === "links" && (
            linkItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-zinc-500">
                <Link2 size={32} className="mb-2 opacity-50" />
                <p className="text-xs">No links shared yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {linkItems
                  .filter((l) => !searchQuery || l.url.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((item, idx) => {
                    const meta = getLinkMetadata(item.url);
                    return (
                      <a
                        key={`${item.id}_${idx}`}
                        href={meta.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group p-3 rounded-2xl bg-white/[0.025] hover:bg-white/[0.06] border border-white/[0.06] flex items-start justify-between gap-3 transition block"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[10px] uppercase font-mono text-[#D4AF37] font-semibold tracking-wider">
                              {meta.domain}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-white group-hover:text-[#D4AF37] transition-colors truncate">
                            {meta.title}
                          </p>
                          <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                            {meta.url}
                          </p>
                        </div>
                        <ExternalLink size={14} className="text-zinc-500 group-hover:text-white shrink-0 mt-1 transition" />
                      </a>
                    );
                  })}
              </div>
            )
          )}
        </div>

        {/* Fullscreen Image Preview Overlay */}
        {previewImage && (
          <div
            className="fixed inset-0 z-[130] bg-black/95 flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setPreviewImage(null)}
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:scale-90 text-white flex items-center justify-center transition cursor-pointer"
              aria-label="Close fullscreen preview"
            >
              <X size={20} />
            </button>
            <img
              src={previewImage}
              alt="fullscreen preview"
              className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatGalleryModal;

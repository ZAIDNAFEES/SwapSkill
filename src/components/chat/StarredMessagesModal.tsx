import React, { useState } from "react";
import { Star, X, ChevronRight, FileText, Image as ImageIcon, Mic, Search } from "lucide-react";

export interface StarredMessageItem {
  id: string;
  senderId: string;
  senderName?: string;
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  fileUrl?: string;
  fileName?: string;
  timestamp?: any;
}

interface StarredMessagesModalProps {
  isOpen: boolean;
  starredMessages: StarredMessageItem[];
  currentUserId: string;
  partnerName?: string;
  onSelectMessage: (msgId: string) => void;
  onUnstarMessage: (msgId: string) => void;
  onClose: () => void;
}

export const StarredMessagesModal: React.FC<StarredMessagesModalProps> = ({
  isOpen,
  starredMessages,
  currentUserId,
  partnerName = "Contact",
  onSelectMessage,
  onUnstarMessage,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  if (!isOpen) return null;

  const formatMsgTime = (timestamp: any) => {
    if (!timestamp) return "";
    try {
      let date: Date | null = null;
      if (typeof timestamp === "number") date = new Date(timestamp);
      else if (timestamp?.toDate) date = timestamp.toDate();
      else if (timestamp?.seconds !== undefined) date = new Date(timestamp.seconds * 1000);
      else if (timestamp instanceof Date) date = timestamp;
      else if (typeof timestamp === "string") {
        const p = Date.parse(timestamp);
        if (!isNaN(p)) date = new Date(p);
      }
      if (!date || isNaN(date.getTime())) return "";
      return date.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + 
             date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const filteredMessages = starredMessages.filter((msg) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      msg.text?.toLowerCase().includes(q) ||
      msg.fileName?.toLowerCase().includes(q) ||
      msg.senderName?.toLowerCase().includes(q)
    );
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Starred Messages"
      className="fixed inset-0 z-[120] bg-black/65 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#111216]/95 border border-white/[0.08] rounded-3xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.7)] flex flex-col max-h-[85vh] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
              <Star size={16} fill="currentColor" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">Starred Messages</h3>
              <p className="text-[11px] text-zinc-400">
                {starredMessages.length} saved message{starredMessages.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/10 active:scale-90 text-zinc-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            aria-label="Close starred messages modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search Bar (when list has items) */}
        {starredMessages.length > 2 && (
          <div className="px-5 py-2.5 border-b border-white/[0.05] shrink-0">
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search starred messages..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#D4AF37]/70 transition"
              />
            </div>
          </div>
        )}

        {/* Content List */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 flex-1 scrollbar-none">
          {filteredMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-500 mb-3">
                <Star size={22} />
              </div>
              <p className="text-sm font-semibold text-zinc-200">
                {searchQuery ? "No matching messages" : "No Starred Messages"}
              </p>
              <p className="text-xs text-zinc-400 max-w-xs mt-1">
                {searchQuery 
                  ? "Try searching for a different keyword"
                  : "Touch and hold any message in this conversation and tap Star to easily find it later."}
              </p>
            </div>
          ) : (
            filteredMessages.map((msg) => {
              const isSelf = msg.senderId === currentUserId;
              const senderDisplayName = isSelf ? "You" : (msg.senderName || partnerName);

              return (
                <div
                  key={msg.id}
                  onClick={() => onSelectMessage(msg.id)}
                  className="group relative p-3 sm:p-3.5 rounded-2xl bg-white/[0.025] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.14] transition-all cursor-pointer flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-[#D4AF37] truncate">
                        {senderDisplayName}
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono tabular-nums shrink-0">
                        {formatMsgTime(msg.timestamp)}
                      </span>
                    </div>

                    {/* Image Attachment Preview */}
                    {msg.imageUrl && (
                      <div className="relative w-24 h-20 rounded-xl overflow-hidden mb-1.5 border border-white/10 bg-black/40">
                        <img src={msg.imageUrl} alt="attachment" className="w-full h-full object-cover" />
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-sm bg-black/70 text-[9px] text-white flex items-center gap-1">
                          <ImageIcon size={9} /> Photo
                        </span>
                      </div>
                    )}

                    {/* Voice Attachment */}
                    {msg.audioUrl && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.05] text-xs text-zinc-300 mb-1">
                        <Mic size={12} className="text-[#D4AF37]" />
                        <span className="text-[11px]">Voice message</span>
                      </div>
                    )}

                    {/* Document Attachment */}
                    {msg.fileUrl && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.05] text-xs text-zinc-300 mb-1 truncate max-w-full">
                        <FileText size={12} className="text-[#D4AF37] shrink-0" />
                        <span className="truncate text-[11px]">{msg.fileName || "Document"}</span>
                      </div>
                    )}

                    {/* Text Preview */}
                    {msg.text && (
                      <p className="text-xs text-zinc-200 line-clamp-3 leading-relaxed">
                        {msg.text}
                      </p>
                    )}
                  </div>

                  {/* Actions: Unstar & Jump */}
                  <div className="flex flex-col items-center gap-2 shrink-0 pt-0.5">
                    <button
                      type="button"
                      title="Unstar message"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnstarMessage(msg.id);
                      }}
                      className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-400/10 active:scale-90 transition cursor-pointer"
                    >
                      <Star size={15} fill="currentColor" />
                    </button>
                    <ChevronRight size={14} className="text-zinc-600 group-hover:text-zinc-300 transition" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default StarredMessagesModal;

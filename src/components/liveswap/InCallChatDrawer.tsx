import React, { useRef, useEffect } from "react";
import { MessageSquare, X, Send, Sparkles } from "lucide-react";

export interface LiveChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

export interface InCallChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: LiveChatMessage[];
  currentUserId: string;
  partnerName: string;
  chatInput: string;
  setChatInput: (val: string) => void;
  onSendMessage: (e: React.FormEvent) => void;
}

export const InCallChatDrawer: React.FC<InCallChatDrawerProps> = ({
  isOpen,
  onClose,
  messages,
  currentUserId,
  partnerName,
  chatInput,
  setChatInput,
  onSendMessage,
}) => {
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatScrollRef.current && isOpen) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 z-40 w-full sm:w-80 md:w-96 bg-[#121216]/95 backdrop-blur-2xl border-l border-white/10 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200 pointer-events-auto">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between bg-white/5">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#C9A96E]" />
          <span className="text-xs sm:text-sm font-bold text-[#F7F4EE]">In-Call Messages</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages Stream */}
      <div ref={chatScrollRef} className="flex-1 p-3.5 overflow-y-auto space-y-3 text-xs">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-white/50 p-4">
            <div className="w-10 h-10 rounded-full bg-[#C9A96E]/10 border border-[#C9A96E]/30 flex items-center justify-center text-[#C9A96E] mb-2 shadow-inner">
              <Sparkles className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-white/80">No in-call messages yet</p>
            <p className="text-[11px] text-white/50 mt-1 max-w-[200px]">
              Share links, code snippets, or notes in real-time with {partnerName}.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderId === currentUserId;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
              >
                <div className="flex items-center gap-1 text-[10px] text-white/50 mb-1 px-1">
                  <span>{isMe ? "You" : msg.senderName}</span>
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                </div>
                <div
                  className={`px-3.5 py-2.5 rounded-2xl max-w-[85%] text-xs leading-relaxed break-words shadow-md ${
                    isMe
                      ? "bg-gradient-to-tr from-[#C9A96E] to-[#DFCA98] text-[#0A0A0C] font-medium rounded-tr-xs"
                      : "bg-[#1E1E24] text-[#F7F4EE] border border-white/10 rounded-tl-xs"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Message Input Box */}
      <form
        onSubmit={onSendMessage}
        className="p-3 border-t border-white/10 bg-white/5 flex items-center gap-2"
      >
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="Send a message to everyone..."
          className="flex-1 bg-[#0A0A0C] border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-[#F7F4EE] placeholder-white/40 focus:outline-hidden focus:border-[#C9A96E] transition"
        />
        <button
          type="submit"
          disabled={!chatInput.trim()}
          className="p-2.5 bg-[#C9A96E] hover:bg-[#b5955a] disabled:opacity-40 disabled:hover:bg-[#C9A96E] text-[#0A0A0C] rounded-xl transition cursor-pointer font-bold shrink-0 shadow-md active:scale-95"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};

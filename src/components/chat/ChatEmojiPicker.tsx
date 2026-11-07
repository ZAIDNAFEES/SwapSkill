import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, X, Delete, Clock, Smile, User, PawPrint, Utensils, Trophy, Plane, Lightbulb, Hash, Flag } from "lucide-react";

export interface ChatEmojiPickerProps {
  isOpen: boolean;
  onSelectEmoji: (emoji: string) => void;
  onDeleteChar?: () => void;
  onClose: () => void;
  title?: string;
  isReactionPicker?: boolean;
}

interface EmojiCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  emojis: string[];
}

// Comprehensive Apple / Google Unicode Emoji Catalog (A to Z)
const ALL_EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "frequently_used",
    name: "Frequently Used",
    icon: <Clock size={16} />,
    emojis: [
      "❤️", "😂", "🔥", "👍", "🙏", "😍", "🎉", "✨",
      "👏", "😊", "💯", "🥰", "😎", "🤩", "🤝", "💪",
      "🥺", "😭", "😘", "🙌", "💀", "👀", "🥳", "💖",
      "👌", "🌹", "⚡", "🫡", "🕊️", "☕", "🌟", "🎯"
    ],
  },
  {
    id: "smileys",
    name: "Smileys & Emotion",
    icon: <Smile size={16} />,
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂",
      "🙂", "🙃", "🫠", "😉", "😊", "😇", "🥰", "😍",
      "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛",
      "😜", "🤪", "😝", "🤑", "🤗", "🫣", "🤭", "🫢",
      "🤫", "🤔", "🫡", "🤐", "🤨", "😐", "😑", "😶",
      "🫥", "😏", "😒", "🙄", "😬", "😮‍💨", "🤥", "😌",
      "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢",
      "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "😵‍💫", "🤯",
      "🤠", "🥳", "🥸", "😎", "🤓", "🧐", "😕", "🫤",
      "😟", "🙁", "😮", "😯", "😲", "😳", "🥺", "🥹",
      "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱",
      "😖", "😣", "😞", "😓", "😩", "😫", "🥱", "😤",
      "😡", "😠", "🤬", "😈", "👿", "💀", "☠️", "💩",
      "🤡", "👹", "👺", "👻", "👽", "👾", "🤖"
    ],
  },
  {
    id: "people",
    name: "People & Gestures",
    icon: <User size={16} />,
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "🫱", "🫲", "🫳",
      "🫴", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟",
      "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️",
      "🫵", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏",
      "🙌", "🫶", "👐", "🤲", "🤝", "🙏", "✍️", "💅",
      "🤳", "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻",
      "👃", "🧠", "🫀", "🫁", "🦷", "🦴", "👀", "👁️",
      "👅", "👄", "🫦", "👶", "👧", "🧒", "👦", "👩",
      "🧑", "👨", "👩‍🦱", "👨‍🦱", "🧓", "👴", "👵", "🫂"
    ],
  },
  {
    id: "animals",
    name: "Animals & Nature",
    icon: <PawPrint size={16} />,
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼",
      "🐻‍❄️", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵",
      "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤",
      "🐣", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴",
      "🦄", "🐝", "🪱", "🐛", "🦋", "🐌", "🐞", "🐜",
      "🪰", "🪲", "🪴", "🌲", "🌳", "🌴", "🌵", "🌾",
      "🌿", "☘️", "🍀", "🍁", "🍂", "🍃", "🌸", "🌹"
    ],
  },
  {
    id: "food",
    name: "Food & Drink",
    icon: <Utensils size={16} />,
    emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇",
      "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥",
      "🥝", "🍅", "🥑", "🥦", "🥬", "🥒", "🌶️", "🌽",
      "🥕", "🧄", "🧅", "🥔", "🥐", "🍞", "🥖", "🥨",
      "🧀", "🥚", "🍳", "🥞", "🧇", "🥓", "🥩", "🍗",
      "🍖", "🌭", "🍔", "🍟", "🍕", "🥪", "🌮", "🌯",
      "🍜", "🍝", "🍣", "🍱", "🥟", "🍤", "🍦", "🍧",
      "🎂", "🍰", "🧁", "🍫", "🍿", "🍩", "🍪", "☕",
      "🍵", "🧃", "🥤", "🧋", "🍺", "🍻", "🥂", "🍷"
    ],
  },
  {
    id: "activities",
    name: "Activity & Sports",
    icon: <Trophy size={16} />,
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉",
      "🥏", "🎱", "🏓", "🏸", "🏒", "🏏", "⛳", "🏹",
      "🎣", "🥊", "🥋", "🛹", "⛸️", "🎿", "🏋️", "🤼",
      "🤸", "🧘", "🏄", "🏊", "🧗", "🚴", "🏆", "🥇",
      "🥈", "🥉", "🏅", "🎖️", "🎫", "🎪", "🎨", "🎬",
      "🎤", "🎧", "🎼", "🎹", "🥁", "🎷", "🎺", "🎸",
      "🎲", "♟️", "🎯", "🎳", "🎮", "🎰", "🧩", "🪄"
    ],
  },
  {
    id: "travel",
    name: "Travel & Places",
    icon: <Plane size={16} />,
    emojis: [
      "🚗", "🚕", "🚙", "🚌", "🏎️", "🚓", "🚑", "🚒",
      "🚐", "🛻", "🚚", "🚜", "🛴", "🚲", "🛵", "🏍️",
      "🚨", "🚔", "🚍", "🚘", "🚖", "🚄", "🚆", "🚇",
      "✈️", "🛫", "🛬", "🛰️", "🚀", "🛸", "🚁", "🛶",
      "⛵", "🚤", "🚢", "⚓", "⛽", "🚦", "🏖️", "🏝️",
      "🏜️", "🌋", "⛰️", "🏔️", "🏕️", "⛺", "🏠", "🏡",
      "🏙️", "🌆", "🌇", "🌃", "🌉", "🗽", "🗼", "🏰"
    ],
  },
  {
    id: "objects",
    name: "Objects & Tech",
    icon: <Lightbulb size={16} />,
    emojis: [
      "📱", "📲", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "📷",
      "📸", "📹", "🎥", "📽️", "📞", "☎️", "📺", "📻",
      "🎙️", "⏱️", "⏰", "⏳", "📡", "🔋", "🔌", "💡",
      "🔦", "🕯️", "💸", "💵", "💰", "💳", "💎", "⚖️",
      "🧰", "🔧", "🔨", "🛠️", "⚙️", "⛓️", "🧲", "🔫",
      "💣", "🧨", "🗡️", "⚔️", "🛡️", "🔮", "🧿", "💊",
      "🩺", "💉", "🧬", "🧪", "🔑", "🗝️", "🚪", "🪑",
      "🛍️", "🛒", "🎁", "🎈", "🎉", "🎊", "✉️", "📦"
    ],
  },
  {
    id: "symbols",
    name: "Symbols & Love",
    icon: <Hash size={16} />,
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
      "🤎", "💔", "❤️‍🔥", "❤️‍🩹", "❣️", "💕", "💞", "💓",
      "💗", "💖", "💘", "💝", "💟", "☮️", "✝️", "☪️",
      "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️", "☦️", "🛐",
      "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏",
      "♐", "♑", "♒", "♓", "🆔", "⚛️", "❌", "⭕",
      "🛑", "⛔", "💯", "💢", "♨️", "❗", "❓", "‼️",
      "⁉️", "⚠️", "♻️", "✅", "🌐", "🌀", "💤", "🆗",
      "🆕", "🆓", "0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣",
      "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟", "🔢", "🎵", "🎶"
    ],
  },
  {
    id: "flags",
    name: "Flags",
    icon: <Flag size={16} />,
    emojis: [
      "🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🏳️‍⚧️", "🏴‍☠️",
      "🇮🇳", "🇺🇸", "🇬🇧", "🇦🇪", "🇨🇦", "🇦🇺", "🇯🇵", "🇩🇪",
      "🇫🇷", "🇧🇷", "🇮🇹", "🇪🇸", "🇷🇺", "🇨🇳", "🇰🇷", "🇸🇦",
      "🇹🇷", "🇿🇦", "🇸🇬", "🇲🇾", "🇮🇩", "🇳🇿", "🇲🇽", "🇦🇷"
    ],
  },
];

// Quick keywords map for intelligent Apple / Google search
const EMOJI_KEYWORD_MAP: Record<string, string[]> = {
  love: ["❤️", "😍", "🥰", "😘", "💖", "💕", "💓", "💗", "💘", "💝", "🌹"],
  heart: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "💖"],
  happy: ["😀", "😃", "😄", "😁", "😆", "😅", "😊", "😇", "🙂", "🥳"],
  laugh: ["😂", "🤣", "😆", "😄", "😸"],
  fire: ["🔥", "💥", "⚡", "✨", "💯"],
  cry: ["😭", "😢", "😥", "😿", "🥺"],
  sad: ["😞", "😔", "😟", "🙁", "😢", "😭", "💔"],
  cool: ["😎", "🤙", "🕶️", "🧊", "🤩"],
  kiss: ["😘", "😗", "😙", "😚", "💋"],
  party: ["🥳", "🎉", "🎊", "🎈", "🍾", "🍻"],
  thumbs: ["👍", "👎"],
  yes: ["✅", "👍", "👌", "💯", "🆗"],
  no: ["❌", "👎", "🚫", "🛑", "⛔"],
  star: ["⭐", "🌟", "✨", "💫", "🤩"],
  money: ["💰", "💵", "💸", "💳", "🤑", "🪙"],
  clap: ["👏", "🙌"],
  pray: ["🙏", "🤲", "🛐"],
  cat: ["🐱", "🐈", "😸", "😹", "😻"],
  dog: ["🐶", "🐕", "🦮", "🐩"],
  food: ["🍕", "🍔", "🍟", "🌭", "🍿", "🍩", "☕"],
  car: ["🚗", "🏎️", "🚕", "🚙", "🚘"],
  check: ["✅", "✔️", "☑️"],
};

export const ChatEmojiPicker: React.FC<ChatEmojiPickerProps> = ({
  isOpen,
  onSelectEmoji,
  onDeleteChar,
  onClose,
  title,
  isReactionPicker = false,
}) => {
  const [activeCategoryId, setActiveCategoryId] = useState<string>("frequently_used");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Close when clicked outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (pickerRef.current && !pickerRef.current.contains(target)) {
        if (!target.closest("#btn-chat-toggle-emoji") && !target.closest("#btn-quick-reaction-plus")) {
          onClose();
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Filter emojis dynamically with smart fuzzy keyword matching
  const filteredEmojis = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return null;

    const results = new Set<string>();

    // 1. Check keyword map
    Object.entries(EMOJI_KEYWORD_MAP).forEach(([keyword, list]) => {
      if (keyword.includes(q) || q.includes(keyword)) {
        list.forEach((e) => results.add(e));
      }
    });

    // 2. Check category names
    ALL_EMOJI_CATEGORIES.forEach((cat) => {
      if (cat.name.toLowerCase().includes(q)) {
        cat.emojis.slice(0, 24).forEach((e) => results.add(e));
      }
    });

    // If query matches literal emoji character
    ALL_EMOJI_CATEGORIES.flatMap((c) => c.emojis).forEach((e) => {
      if (e.includes(q)) results.add(e);
    });

    return Array.from(results);
  }, [searchQuery]);

  const activeCategory = useMemo(() => {
    return (
      ALL_EMOJI_CATEGORIES.find((c) => c.id === activeCategoryId) ||
      ALL_EMOJI_CATEGORIES[0]
    );
  }, [activeCategoryId]);

  if (!isOpen) return null;

  return (
    <>
      {/* Dim backdrop for reaction picker modal */}
      {isReactionPicker && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-xs animate-fade-in"
        />
      )}

      <motion.div
        ref={pickerRef}
        initial={{ opacity: 0, y: isReactionPicker ? 20 : 12, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        style={{
          boxShadow: "0 24px 64px -12px rgba(0,0,0,0.85), 0 0 1px 1px rgba(255,255,255,0.08)",
        }}
        className={`z-[125] select-none flex flex-col overflow-hidden bg-[#16171D]/98 backdrop-blur-2xl border border-white/15 text-white ${
          isReactionPicker
            ? "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[410px] h-[480px] max-h-[82vh] rounded-3xl"
            : "absolute bottom-full left-1.5 sm:left-4 mb-2.5 w-[calc(100vw-12px)] sm:w-[410px] max-w-[430px] h-[400px] max-h-[55vh] rounded-3xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* iOS / Google Header Area: Title & Search */}
        <div className="px-3.5 pt-3 pb-2 border-b border-white/[0.08] flex flex-col gap-2 shrink-0 bg-white/[0.02]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold tracking-wide text-zinc-200">
                {title || (isReactionPicker ? "React with any emoji" : "Emojis")}
              </span>
              <span className="text-[10px] font-mono text-[#D4AF37] px-2 py-0.5 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20">
                A – Z
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
              title="Close"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          {/* Apple / Google Rounded Search Pill Input */}
          <div className="relative w-full flex items-center">
            <Search size={14} className="absolute left-3 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search emojis (love, fire, smile, clap)..."
              className="w-full h-8.5 pl-8.5 pr-8 bg-white/10 hover:bg-white/15 focus:bg-white/15 border border-white/10 focus:border-[#D4AF37]/60 rounded-xl text-xs text-white placeholder-zinc-400 outline-none transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 w-4 h-4 rounded-full bg-zinc-600/60 hover:bg-zinc-500 text-zinc-300 flex items-center justify-center cursor-pointer text-[10px]"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Emojis Grid Area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-3 py-2.5 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent overscroll-contain"
        >
          {filteredEmojis !== null ? (
            <div>
              <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-2 px-1">
                Search Results ({filteredEmojis.length})
              </div>
              {filteredEmojis.length > 0 ? (
                <div className="grid grid-cols-8 gap-1 sm:gap-1.5">
                  {filteredEmojis.map((emoji, idx) => (
                    <button
                      key={`search-${emoji}-${idx}`}
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.vibrate) {
                          navigator.vibrate(10);
                        }
                        onSelectEmoji(emoji);
                      }}
                      className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-[22px] sm:text-[24px] rounded-xl hover:bg-white/15 active:scale-125 transition-all cursor-pointer native-emoji"
                      title={emoji}
                      aria-label={emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-12 flex flex-col items-center justify-center text-center text-zinc-400 gap-2">
                  <span className="text-3xl">🔍</span>
                  <p className="text-xs">No matching emojis found</p>
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="text-[11px] text-[#D4AF37] hover:underline cursor-pointer mt-1"
                  >
                    View all emojis
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 px-1 flex items-center justify-between">
                <span>{activeCategory.name}</span>
                <span className="text-[10px] font-mono text-zinc-500 font-normal">
                  {activeCategory.emojis.length} emojis
                </span>
              </div>

              <div className="grid grid-cols-8 gap-1 sm:gap-1.5">
                {activeCategory.emojis.map((emoji, idx) => (
                  <button
                    key={`${activeCategory.id}-${emoji}-${idx}`}
                    type="button"
                    onClick={() => {
                      if (typeof navigator !== "undefined" && navigator.vibrate) {
                        navigator.vibrate(8);
                      }
                      onSelectEmoji(emoji);
                    }}
                    className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-[22px] sm:text-[24px] rounded-xl hover:bg-white/15 active:scale-125 transition-all cursor-pointer native-emoji"
                    title={emoji}
                    aria-label={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Apple / Google Bottom Dock: Category Quick Jump Bar + Erase Button */}
        <div className="px-2 py-1.5 border-t border-white/[0.08] bg-black/40 flex items-center justify-between gap-1 shrink-0">
          <div className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto scrollbar-none py-0.5 flex-1 min-w-0">
            {ALL_EMOJI_CATEGORIES.map((cat) => {
              const isActive = activeCategoryId === cat.id && !searchQuery;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setActiveCategoryId(cat.id);
                    setSearchQuery("");
                    if (scrollContainerRef.current) {
                      scrollContainerRef.current.scrollTop = 0;
                    }
                  }}
                  className={`w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                    isActive
                      ? "bg-[#D4AF37]/25 text-[#D4AF37] ring-1 ring-[#D4AF37]/50 shadow-xs"
                      : "text-zinc-400 hover:text-white hover:bg-white/10"
                  }`}
                  title={cat.name}
                  aria-label={cat.name}
                >
                  {cat.icon}
                </button>
              );
            })}
          </div>

          {/* Erase / Backspace Button (Only shown in Chat input mode, not in reaction mode) */}
          {!isReactionPicker && onDeleteChar && (
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.vibrate) {
                  navigator.vibrate(10);
                }
                onDeleteChar();
              }}
              className="h-8 px-2.5 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-zinc-200 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ml-1 border border-white/10"
              title="Delete last character"
              aria-label="Delete character"
            >
              <Delete size={14} />
              <span className="text-[11px] font-medium hidden sm:inline">Delete</span>
            </button>
          )}
        </div>
      </motion.div>
    </>
  );
};

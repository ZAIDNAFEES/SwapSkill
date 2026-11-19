import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Search, X, Delete, Clock, Smile, User, PawPrint, Utensils, Trophy, Plane, Lightbulb, Hash, Flag } from "lucide-react";

export interface ChatEmojiPickerProps {
  isOpen: boolean;
  onSelectEmoji: (emoji: string) => void;
  onDeleteChar?: () => void;
  onClose: () => void;
  title?: string;
  isReactionPicker?: boolean;
  dockHeight?: number;
}

interface EmojiCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  emojis: string[];
}

const RECENT_STORAGE_KEY = "swap_recent_emojis_v1";

const DEFAULT_RECENT_EMOJIS = [
  "❤️", "😂", "🔥", "👍", "🙏", "😍", "🎉", "✨",
  "👏", "😊", "💯", "🥰", "😎", "🤩", "🤝", "💪",
  "🥺", "😭", "😘", "🙌", "💀", "👀", "🥳", "💖",
  "👌", "🌹", "⚡", "🫡", "🕊️", "☕", "🌟", "🎯"
];

// Comprehensive Apple / Google Unicode Emoji Catalog
const BASE_EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "frequently_used",
    name: "Recent",
    icon: <Clock size={17} />,
    emojis: DEFAULT_RECENT_EMOJIS,
  },
  {
    id: "smileys",
    name: "Smileys & People",
    icon: <Smile size={17} />,
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
    name: "Gestures & Body",
    icon: <User size={17} />,
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
    icon: <PawPrint size={17} />,
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
    icon: <Utensils size={17} />,
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
    icon: <Trophy size={17} />,
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
    icon: <Plane size={17} />,
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
    icon: <Lightbulb size={17} />,
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
    icon: <Hash size={17} />,
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
    icon: <Flag size={17} />,
    emojis: [
      "🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🏳️‍⚧️", "🏴‍☠️",
      "🇮🇳", "🇺🇸", "🇬🇧", "🇦🇪", "🇨🇦", "🇦🇺", "🇯🇵", "🇩🇪",
      "🇫🇷", "🇧🇷", "🇮🇹", "🇪🇸", "🇷🇺", "🇨🇳", "🇰🇷", "🇸🇦",
      "🇹🇷", "🇿🇦", "🇸🇬", "🇲🇾", "🇮🇩", "🇳🇿", "🇲🇽", "🇦🇷"
    ],
  },
];

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

const loadRecentEmojis = (): string[] => {
  if (typeof window === "undefined") return DEFAULT_RECENT_EMOJIS;
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return DEFAULT_RECENT_EMOJIS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 32);
    }
  } catch (_) {}
  return DEFAULT_RECENT_EMOJIS;
};

export const ChatEmojiPicker: React.FC<ChatEmojiPickerProps> = ({
  isOpen,
  onSelectEmoji,
  onDeleteChar,
  onClose,
  title,
  isReactionPicker = false,
  dockHeight = 290,
}) => {
  const [activeCategoryId, setActiveCategoryId] = useState<string>("smileys");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(loadRecentEmojis);

  const pickerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const deleteHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteRepeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopDeleteHold = useCallback(() => {
    if (deleteHoldTimeoutRef.current) {
      clearTimeout(deleteHoldTimeoutRef.current);
      deleteHoldTimeoutRef.current = null;
    }
    if (deleteRepeatIntervalRef.current) {
      clearInterval(deleteRepeatIntervalRef.current);
      deleteRepeatIntervalRef.current = null;
    }
  }, []);

  useEffect(() => stopDeleteHold, [stopDeleteHold]);

  // Reset search state cleanly when closed
  useEffect(() => {
    if (!isOpen) {
      setIsSearchOpen(false);
      setSearchQuery("");
      stopDeleteHold();
    }
  }, [isOpen, stopDeleteHold]);

  // Only dismiss on click-outside for centered modal reaction picker (never collapse docked WhatsApp drawer mid-tap)
  useEffect(() => {
    if (!isOpen || !isReactionPicker) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (pickerRef.current && !pickerRef.current.contains(target)) {
        if (!target.closest("#btn-quick-reaction-plus")) {
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
  }, [isOpen, isReactionPicker, onClose]);

  const categories = useMemo<EmojiCategory[]>(() => {
    return BASE_EMOJI_CATEGORIES.map((cat) =>
      cat.id === "frequently_used" ? { ...cat, emojis: recentEmojis } : cat
    );
  }, [recentEmojis]);

  const handlePickEmoji = useCallback(
    (emoji: string) => {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(8);
      }
      setRecentEmojis((prev) => {
        const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 32);
        try {
          window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
        } catch (_) {}
        return next;
      });
      onSelectEmoji(emoji);
    },
    [onSelectEmoji]
  );

  const handleStartDeleteHold = useCallback(() => {
    if (!onDeleteChar) return;
    stopDeleteHold();
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(10);
    }
    onDeleteChar();
    deleteHoldTimeoutRef.current = setTimeout(() => {
      deleteRepeatIntervalRef.current = setInterval(() => {
        onDeleteChar();
      }, 75);
    }, 380);
  }, [onDeleteChar, stopDeleteHold]);

  const filteredEmojis = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return null;

    const results = new Set<string>();
    Object.entries(EMOJI_KEYWORD_MAP).forEach(([keyword, list]) => {
      if (keyword.includes(q) || q.includes(keyword)) {
        list.forEach((e) => results.add(e));
      }
    });
    categories.forEach((cat) => {
      if (cat.name.toLowerCase().includes(q)) {
        cat.emojis.slice(0, 24).forEach((e) => results.add(e));
      }
    });
    categories.flatMap((c) => c.emojis).forEach((e) => {
      if (e.includes(q)) results.add(e);
    });

    return Array.from(results);
  }, [searchQuery, categories]);

  const activeCategory = useMemo(() => {
    return categories.find((c) => c.id === activeCategoryId) || categories[1];
  }, [activeCategoryId, categories]);

  if (!isOpen) return null;

  // 1. Reaction Modal Mode (Centered overlay when tapping '+' on a message)
  if (isReactionPicker) {
    return (
      <>
        <div
          onClick={onClose}
          className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-xs animate-fade-in"
        />

        <motion.div
          ref={pickerRef}
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          style={{
            boxShadow: "0 24px 64px -12px rgba(0,0,0,0.85), 0 0 1px 1px rgba(255,255,255,0.08)",
          }}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[125] w-[92vw] max-w-[410px] h-[480px] max-h-[82vh] rounded-3xl select-none flex flex-col overflow-hidden bg-[#16171D]/98 backdrop-blur-2xl border border-white/15 text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3.5 pt-3 pb-2 border-b border-white/[0.08] flex flex-col gap-2 shrink-0 bg-white/[0.02]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold tracking-wide text-zinc-200">
                {title || "React with any emoji"}
              </span>
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

            <div className="relative w-full flex items-center">
              <Search size={14} className="absolute left-3 text-zinc-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search emojis..."
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

          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto px-3 py-2.5 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent overscroll-contain"
          >
            {filteredEmojis !== null ? (
              <div className="grid grid-cols-8 gap-1 sm:gap-1.5">
                {filteredEmojis.map((emoji, idx) => (
                  <button
                    key={`search-${emoji}-${idx}`}
                    type="button"
                    onClick={() => handlePickEmoji(emoji)}
                    className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-[23px] rounded-xl hover:bg-white/15 active:scale-125 transition-all cursor-pointer native-emoji"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 px-1">
                  {activeCategory.name}
                </div>
                <div className="grid grid-cols-8 gap-1 sm:gap-1.5">
                  {activeCategory.emojis.map((emoji, idx) => (
                    <button
                      key={`${activeCategory.id}-${emoji}-${idx}`}
                      type="button"
                      onClick={() => handlePickEmoji(emoji)}
                      className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-[23px] rounded-xl hover:bg-white/15 active:scale-125 transition-all cursor-pointer native-emoji"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="px-2 py-1.5 border-t border-white/[0.08] bg-black/40 flex items-center gap-0.5 overflow-x-auto scrollbar-none shrink-0">
            {categories.map((cat) => {
              const isActive = activeCategoryId === cat.id && !searchQuery;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setActiveCategoryId(cat.id);
                    setSearchQuery("");
                    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
                  }}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                    isActive
                      ? "bg-[#D4AF37]/25 text-[#D4AF37]"
                      : "text-zinc-400 hover:text-white hover:bg-white/10"
                  }`}
                  title={cat.name}
                >
                  {cat.icon}
                </button>
              );
            })}
          </div>
        </motion.div>
      </>
    );
  }

  // 2. WhatsApp Android Replica Bottom-Docked Emoji Keyboard
  const safeDockHeight = Math.min(340, Math.max(255, Math.round(dockHeight || 290)));

  return (
    <motion.div
      ref={pickerRef}
      initial={{ height: 0, opacity: 0.7 }}
      animate={{ height: safeDockHeight, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      style={{ maxHeight: "46dvh" }}
      onMouseDown={(e) => {
        // Keep focus/keyboard state untouched when interacting inside the emoji keyboard
        if ((e.target as HTMLElement)?.tagName !== "INPUT") {
          e.preventDefault();
        }
      }}
      className="flex-none shrink-0 w-full select-none flex flex-col overflow-hidden bg-[#F0F2F5] dark:bg-[#111216] border-t border-black/[0.08] dark:border-white/[0.08] text-[#111B21] dark:text-[#E9EDEF] z-20"
    >
      {/* Top Category Tabs Bar with WhatsApp Underline Indicator */}
      <div className="flex items-stretch border-b border-black/[0.06] dark:border-white/[0.06] bg-[#F0F2F5] dark:bg-[#111216] shrink-0 h-10 px-1">
        {categories.map((cat) => {
          const isActive = activeCategoryId === cat.id && !searchQuery;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setActiveCategoryId(cat.id);
                setSearchQuery("");
                setIsSearchOpen(false);
                if (scrollContainerRef.current) {
                  scrollContainerRef.current.scrollTop = 0;
                }
              }}
              className={`relative flex-1 min-w-0 flex items-center justify-center transition-colors cursor-pointer ${
                isActive
                  ? "text-[#0D0D0F] dark:text-[#C9A96E]"
                  : "text-[#667781] dark:text-[#8696A0] hover:text-[#111B21] dark:hover:text-[#D1D7DB]"
              }`}
              title={cat.name}
              aria-label={cat.name}
            >
              {cat.icon}
              {isActive && (
                <span className="absolute bottom-0 left-1.5 right-1.5 h-[2.5px] rounded-t-full bg-[#0D0D0F] dark:bg-[#C9A96E]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Expandable Inline Search Strip (Only visible when user taps 🔍 in bottom bar) */}
      {isSearchOpen && (
        <div className="px-2.5 py-1.5 border-b border-black/[0.06] dark:border-white/[0.06] bg-white/70 dark:bg-[#18191F] flex items-center gap-2 shrink-0">
          <Search size={14} className="text-[#667781] dark:text-[#8696A0] shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search emojis (love, fire, smile, clap)..."
            autoFocus
            className="flex-1 min-w-0 bg-transparent text-[14px] text-[#111B21] dark:text-[#E9EDEF] placeholder:text-[#667781] dark:placeholder:text-[#8696A0] outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setIsSearchOpen(false);
            }}
            className="w-6 h-6 rounded-full flex items-center justify-center text-[#667781] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            aria-label="Close emoji search"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Scrollable WhatsApp Emoji Grid */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-2 py-2 overscroll-contain scrollbar-none"
      >
        {filteredEmojis !== null ? (
          <div>
            <div className="text-[11px] font-medium text-[#667781] dark:text-[#8696A0] px-1.5 pb-1.5">
              {filteredEmojis.length > 0 ? `Results (${filteredEmojis.length})` : "No emojis found"}
            </div>
            <div className="grid grid-cols-8 gap-y-1">
              {filteredEmojis.map((emoji, idx) => (
                <button
                  key={`search-${emoji}-${idx}`}
                  type="button"
                  onClick={() => handlePickEmoji(emoji)}
                  className="h-10 flex items-center justify-center text-[25px] leading-none rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-125 transition-transform cursor-pointer native-emoji"
                  aria-label={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[11px] font-medium text-[#667781] dark:text-[#8696A0] px-1.5 pb-1">
              {activeCategory.name}
            </div>
            <div className="grid grid-cols-8 gap-y-0.5">
              {activeCategory.emojis.map((emoji, idx) => (
                <button
                  key={`${activeCategory.id}-${emoji}-${idx}`}
                  type="button"
                  onClick={() => handlePickEmoji(emoji)}
                  className="h-10 flex items-center justify-center text-[25px] leading-none rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-125 transition-transform cursor-pointer native-emoji"
                  aria-label={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* WhatsApp Bottom Action Strip: Search (left) + Category Label (center) + Backspace Delete (right) */}
      <div className="h-10 px-2.5 border-t border-black/[0.06] dark:border-white/[0.06] bg-[#E7EAEE] dark:bg-[#0D0E12] flex items-center justify-between shrink-0 pb-[max(env(safe-area-inset-bottom,0px),0px)]">
        <button
          type="button"
          onClick={() => {
            setIsSearchOpen((prev) => {
              const next = !prev;
              if (!next) setSearchQuery("");
              return next;
            });
          }}
          className={`w-9 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
            isSearchOpen
              ? "text-[#0D0D0F] dark:text-[#C9A96E] bg-black/5 dark:bg-white/10"
              : "text-[#54656F] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10"
          }`}
          title="Search Emojis"
          aria-label="Search Emojis"
        >
          <Search size={18} />
        </button>

        <span className="text-[11px] font-medium text-[#667781] dark:text-[#8696A0] tracking-tight">
          Emojis
        </span>

        {onDeleteChar ? (
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              handleStartDeleteHold();
            }}
            onPointerUp={stopDeleteHold}
            onPointerLeave={stopDeleteHold}
            onPointerCancel={stopDeleteHold}
            className="w-10 h-8 rounded-lg text-[#54656F] dark:text-[#8696A0] hover:text-[#111B21] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 active:scale-90 flex items-center justify-center transition-all cursor-pointer"
            title="Backspace"
            aria-label="Delete character"
          >
            <Delete size={19} />
          </button>
        ) : (
          <div className="w-9" />
        )}
      </div>
    </motion.div>
  );
};


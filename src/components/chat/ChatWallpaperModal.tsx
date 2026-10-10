import React, { useState } from "react";
import { Check, X, Palette, Sparkles } from "lucide-react";
import { safeLocalStorage } from "../../utils/safeStorage";

export interface WallpaperPreset {
  id: string;
  name: string;
  description: string;
  previewBg: string;
  patternSvg?: string;
  backgroundColor: string;
  textColor: string;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: "default",
    name: "Obsidian Theme",
    description: "Classic clean background matching system theme",
    previewBg: "bg-[#0E0F12]",
    backgroundColor: "transparent",
    textColor: "text-zinc-200",
  },
  {
    id: "royal_gold",
    name: "SwapSkill Royal Gold",
    description: "Luxury champagne gold starlight watermark",
    previewBg: "bg-[#14120e]",
    backgroundColor: "#14120e",
    textColor: "text-zinc-200",
    patternSvg: `url("data:image/svg+xml,%3Csvg width='50' height='50' viewBox='0 0 50 50' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23D4AF37' fill-opacity='0.05'%3E%3Cpath d='M25 0l4 18 18 4-18 4-4 18-4-18-18-4 18-4z'/%3E%3C/g%3E%3C/svg%3E")`,
  },
  {
    id: "whatsapp_doodle",
    name: "Classic Chat Motif",
    description: "Iconic chat doodle motifs with subtle contrast",
    previewBg: "bg-[#0b141a]",
    backgroundColor: "#0b141a",
    textColor: "text-zinc-200",
    patternSvg: `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.035'%3E%3Cpath d='M14 16H9v-2h5V9h2v5h5v2h-5v5h-2v-5zM64 16h-5v-2h5V9h2v5h5v2h-5v5h-2v-5zM29 40h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2v-2h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2v-2h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2v-2h2v2zM60 55a5 5 0 1 1-10 0 5 5 0 0 1 10 0zm-35 5a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 60l5-8h-3l-2 4-2-4H7l5 8z'/%3E%3C/g%3E%3C/svg%3E")`,
  },
  {
    id: "emerald_doodle",
    name: "Emerald Forest",
    description: "Deep calming green with fine hand-drawn icons",
    previewBg: "bg-[#0d1c16]",
    backgroundColor: "#0d1c16",
    textColor: "text-zinc-200",
    patternSvg: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%2310b981' fill-opacity='0.045'%3E%3Ccircle cx='30' cy='30' r='4'/%3E%3Cpath d='M10 20l5 5h-4v10H9V25H5l5-5zm40 20l-5-5h4V25h2v10h4l-5 5z'/%3E%3C/g%3E%3C/svg%3E")`,
  },
  {
    id: "midnight_dots",
    name: "Obsidian Matrix",
    description: "Minimalist dark dots with ultra-high readability",
    previewBg: "bg-[#090a0f]",
    backgroundColor: "#090a0f",
    textColor: "text-zinc-200",
    patternSvg: `url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='1' fill='%23ffffff' fill-opacity='0.06'/%3E%3C/svg%3E")`,
  },
  {
    id: "soft_light",
    name: "Soft Light Paper",
    description: "Pleasant warm paper tone for daytime messaging",
    previewBg: "bg-[#e5ddd5]",
    backgroundColor: "#efeae2",
    textColor: "text-zinc-800",
    patternSvg: `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23000000' fill-opacity='0.04'%3E%3Cpath d='M14 16H9v-2h5V9h2v5h5v2h-5v5h-2v-5zM64 16h-5v-2h5V9h2v5h5v2h-5v5h-2v-5zM60 55a5 5 0 1 1-10 0 5 5 0 0 1 10 0z'/%3E%3C/g%3E%3C/svg%3E")`,
  },
];

interface ChatWallpaperModalProps {
  isOpen: boolean;
  chatId: string;
  currentWallpaperId: string;
  onSelectWallpaper: (presetId: string) => void;
  onClose: () => void;
}

export const ChatWallpaperModal: React.FC<ChatWallpaperModalProps> = ({
  isOpen,
  chatId,
  currentWallpaperId,
  onSelectWallpaper,
  onClose,
}) => {
  const [selectedId, setSelectedId] = useState(currentWallpaperId || "default");
  const [applyGlobally, setApplyGlobally] = useState(false);

  if (!isOpen) return null;

  const handleApply = () => {
    onSelectWallpaper(selectedId);
    safeLocalStorage.setItem(`swapskill_wallpaper_${chatId}`, selectedId);
    if (applyGlobally) {
      safeLocalStorage.setItem("swapskill_wallpaper_default", selectedId);
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chat Wallpaper"
      className="fixed inset-0 z-[120] bg-black/65 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#111216]/95 border border-white/[0.08] rounded-3xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.7)] flex flex-col max-h-[88vh] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/15 text-[#D4AF37] flex items-center justify-center">
              <Palette size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">Chat Wallpaper</h3>
              <p className="text-[11px] text-zinc-400">Choose a luxury background for your messages</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/10 active:scale-90 text-zinc-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            aria-label="Close wallpaper modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Wallpaper Presets Grid */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1 scrollbar-none">
          <div className="grid grid-cols-2 gap-3">
            {WALLPAPER_PRESETS.map((preset) => {
              const isSelected = selectedId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedId(preset.id)}
                  className={`group relative flex flex-col text-left rounded-2xl overflow-hidden border transition-all p-2.5 cursor-pointer ${
                    isSelected
                      ? "border-[#D4AF37] ring-1 ring-[#D4AF37]/40 bg-white/[0.05]"
                      : "border-white/[0.07] hover:border-white/[0.18] bg-white/[0.02]"
                  }`}
                >
                  {/* Visual Wallpaper Preview Card */}
                  <div
                    className={`w-full h-24 rounded-xl mb-2.5 relative flex flex-col justify-end p-2 overflow-hidden shadow-inner ${preset.previewBg}`}
                    style={{
                      backgroundImage: preset.patternSvg,
                      backgroundColor: preset.backgroundColor !== "transparent" ? preset.backgroundColor : undefined,
                    }}
                  >
                    {/* Simulated Miniature Chat Bubbles */}
                    <div className="w-3/4 py-1 px-2 rounded-lg bg-zinc-800/90 text-[8px] text-white/90 shadow-xs mb-1 truncate">
                      Ready to swap skills?
                    </div>
                    <div className="w-2/3 py-1 px-2 rounded-lg bg-[#D4AF37] text-black text-[8px] font-semibold self-end shadow-xs truncate">
                      Yes, let's connect!
                    </div>

                    {isSelected && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#D4AF37] text-black flex items-center justify-center shadow-md">
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                  </div>

                  <p className="text-xs font-semibold text-white tracking-tight">{preset.name}</p>
                  <p className="text-[10px] text-zinc-400 truncate mt-0.5">{preset.description}</p>
                </button>
              );
            })}
          </div>

          {/* Option: Apply to all chats */}
          <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] cursor-pointer select-none transition mt-2">
            <input
              type="checkbox"
              checked={applyGlobally}
              onChange={(e) => setApplyGlobally(e.target.checked)}
              className="rounded-sm accent-[#D4AF37] w-4 h-4 cursor-pointer"
            />
            <span className="text-xs text-zinc-200">Set as default wallpaper for all chats</span>
          </label>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2.5 bg-black/30">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-[#D4AF37] hover:bg-[#c49f2e] text-black shadow-lg shadow-[#D4AF37]/20 active:scale-95 transition cursor-pointer"
          >
            Apply Wallpaper
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatWallpaperModal;

import React, { useState, useMemo, useRef, useEffect } from "react";
import { 
  Check, 
  X, 
  Palette, 
  Sparkles, 
  Compass, 
  Moon, 
  Sun, 
  Layers, 
  Feather, 
  Image as ImageIcon, 
  Sliders, 
  Eye, 
  RotateCcw,
  Camera,
  Users
} from "lucide-react";
import { safeLocalStorage } from "../../utils/safeStorage";
import { optimizeImage } from "../../utils/imageCompressor";

export interface WallpaperPreset {
  id: string;
  name: string;
  category: "photos" | "nature" | "aesthetic" | "luxury" | "doodles" | "minimal";
  description: string;
  previewBg: string;
  imageUrl?: string;
  patternSvg?: string;
  backgroundColor: string;
  textColor: string;
  backgroundSize?: string;
  backgroundRepeat?: string;
  backgroundPosition?: string;
}

// 100% Royalty-Free CC0 High-Resolution Curated Unsplash Photos & Handcrafted Patterns (Zero AI Quota)
export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: "photo_alpine_stars",
    name: "Starry Alpine Mirror",
    category: "photos",
    description: "Milky Way stars reflected on tranquil crystal mountain lake",
    previewBg: "bg-[#0A101D]",
    imageUrl: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#0A101D",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "photo_sunset_dolomites",
    name: "Golden Hour Dolomites",
    category: "nature",
    description: "Dramatic Italian alpine peaks glowing in warm evening sunset",
    previewBg: "bg-[#1E110E]",
    imageUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#1E110E",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "photo_cosmic_nebula",
    name: "Violet Cosmic Nebula",
    category: "aesthetic",
    description: "Deep interstellar dust clouds and glowing purple star clusters",
    previewBg: "bg-[#0B0818]",
    imageUrl: "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#0B0818",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "photo_emerald_forest",
    name: "Misty Evergreen Pines",
    category: "nature",
    description: "Atmospheric spruce forest shrouded in soft morning mist",
    previewBg: "bg-[#091512]",
    imageUrl: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#091512",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "photo_tokyo_rain",
    name: "Tokyo Neon Reflections",
    category: "aesthetic",
    description: "Cinematic rainy night street illuminated by neon cyan & magenta",
    previewBg: "bg-[#090B14]",
    imageUrl: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#090B14",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "photo_sunset_waves",
    name: "Pastel Sunset Surf",
    category: "aesthetic",
    description: "Dreamy golden ocean surf rolling on twilight lavender shores",
    previewBg: "bg-[#181124]",
    imageUrl: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#181124",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "photo_desert_dunes",
    name: "Minimalist Sahara Dunes",
    category: "nature",
    description: "Silky undulating sand dunes with clean architectural shadows",
    previewBg: "bg-[#1C140C]",
    imageUrl: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#1C140C",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "photo_cozy_cafe_rain",
    name: "Rainy Window & Warm Bokeh",
    category: "aesthetic",
    description: "Raindrops on glass window with golden ambient city lights",
    previewBg: "bg-[#141210]",
    imageUrl: "https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#141210",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "photo_black_marble",
    name: "Obsidian Marble & Gold",
    category: "luxury",
    description: "Prestige Nero Marquina black marble with delicate gold veins",
    previewBg: "bg-[#0D0D10]",
    imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#0D0D10",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "photo_minimal_arches",
    name: "Travertine Sunlit Arches",
    category: "luxury",
    description: "Warm modern minimalist architecture bathed in natural sunlight",
    previewBg: "bg-[#1C1A16]",
    imageUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#1C1A16",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "photo_ghibli_meadow",
    name: "Summer Green Meadow",
    category: "nature",
    description: "Lush rolling green hills under peaceful sunny sky",
    previewBg: "bg-[#0D1811]",
    imageUrl: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80",
    backgroundColor: "#0D1811",
    textColor: "text-zinc-100",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  {
    id: "whatsapp_deluxe",
    name: "Signature Chat Doodles",
    category: "doodles",
    description: "Handcrafted conversation motifs and icons",
    previewBg: "bg-[#0B141B]",
    backgroundColor: "#0B141B",
    textColor: "text-zinc-200",
    patternSvg: `url("data:image/svg+xml,%3Csvg width='120' height='120' viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23FFFFFF' stroke-width='1.2' stroke-opacity='0.09' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 25h16a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-8l-5 4v-4h-3a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z'/%3E%3Cpath d='M75 20l25 8-12 12-13-20zm13 8l-8 7'/%3E%3Cpath d='M20 75a6 6 0 0 0 6 6h12a6 6 0 0 0 6-6v-12h-24v12zm18-6a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-1a3 3 0 0 1-3-3z'/%3E%3Cpath d='M85 70a6 6 0 0 0-8.5 0l-.5.5-.5-.5a6 6 0 0 0-8.5 8.5l9 9 9-9a6 6 0 0 0 0-8.5z'/%3E%3Cpath d='M55 45l3 7 7 3-7 3-3 7-3-7-7-3 7-3z'/%3E%3Ccircle cx='60' cy='95' r='4'/%3E%3Cpath d='M64 95v-10h6'/%3E%3Cpath d='M10 100h15v10h-15z'/%3E%3C/g%3E%3C/svg%3E")`,
    backgroundSize: "120px 120px",
  },
  {
    id: "celestial_galaxy",
    name: "Celestial Gold Constellations",
    category: "luxury",
    description: "Starry golden constellations & celestial diamonds",
    previewBg: "bg-[#0B0C10]",
    backgroundColor: "#0B0C10",
    textColor: "text-zinc-200",
    patternSvg: `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23D4AF37' fill-opacity='0.16'%3E%3Ccircle cx='20' cy='20' r='1.8'/%3E%3Ccircle cx='80' cy='35' r='1.2'/%3E%3Ccircle cx='45' cy='75' r='2'/%3E%3Ccircle cx='70' cy='85' r='1.2'/%3E%3Cpath d='M20 20 L45 75 M45 75 L80 35' stroke='%23D4AF37' stroke-width='0.6' stroke-opacity='0.1' fill='none'/%3E%3Cpath d='M50 15l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'/%3E%3Cpath d='M88 70l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z'/%3E%3C/g%3E%3C/svg%3E")`,
    backgroundSize: "100px 100px",
  },
  {
    id: "royal_gold",
    name: "Imperial Rosette Gold",
    category: "luxury",
    description: "Swiss luxury guilloché rosette tile in champagne gold",
    previewBg: "bg-[#14120E]",
    backgroundColor: "#14120E",
    textColor: "text-zinc-200",
    patternSvg: `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23C9A96E' stroke-width='0.9' stroke-opacity='0.14'%3E%3Ccircle cx='40' cy='40' r='36'/%3E%3Ccircle cx='40' cy='40' r='28'/%3E%3Ccircle cx='40' cy='40' r='20'/%3E%3Ccircle cx='40' cy='40' r='12'/%3E%3Ccircle cx='0' cy='0' r='24'/%3E%3Ccircle cx='80' cy='0' r='24'/%3E%3Ccircle cx='0' cy='80' r='24'/%3E%3Ccircle cx='80' cy='80' r='24'/%3E%3C/g%3E%3C/svg%3E")`,
    backgroundSize: "80px 80px",
  },
  {
    id: "cozy_library",
    name: "Cozy Study & Coffee",
    category: "doodles",
    description: "Artistic books, desk lamp, spectacles & steaming mug doodles",
    previewBg: "bg-[#141312]",
    backgroundColor: "#141312",
    textColor: "text-zinc-200",
    patternSvg: `url("data:image/svg+xml,%3Csvg width='110' height='110' viewBox='0 0 110 110' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23E5C483' stroke-width='1.2' stroke-opacity='0.11' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 32c6-3 14-3 20 0v24c-6-3-14-3-20 0zm20 0c6-3 14-3 20 0v24c-6-3-14-3-20 0z'/%3E%3Ccircle cx='85' cy='30' r='8'/%3E%3Cpath d='M85 26v4l3 2'/%3E%3Cpath d='M25 85h25v6H25z'/%3E%3Cpath d='M30 85v-10h15v10'/%3E%3Cpath d='M75 75l18 18-5 5-18-18z'/%3E%3Cpath d='M72 72l3 3'/%3E%3C/g%3E%3C/svg%3E")`,
    backgroundSize: "110px 110px",
  },
  {
    id: "default",
    name: "Pure Obsidian Clean",
    category: "minimal",
    description: "Classic clean background matching system theme",
    previewBg: "bg-[#0D0D0F]",
    backgroundColor: "transparent",
    textColor: "text-zinc-200",
  },
];

export interface ChatWallpaperModalProps {
  isOpen: boolean;
  chatId: string;
  currentUserId?: string;
  currentWallpaperId: string;
  currentCustomUrl?: string | null;
  currentDim?: number;
  currentBlur?: boolean;
  onSelectWallpaper: (presetId: string, customUrl?: string, dim?: number, blur?: boolean) => void;
  onClose: () => void;
}

export const ChatWallpaperModal: React.FC<ChatWallpaperModalProps> = ({
  isOpen,
  chatId,
  currentWallpaperId,
  currentCustomUrl,
  currentDim = 0.35,
  currentBlur = false,
  onSelectWallpaper,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States
  const [selectedId, setSelectedId] = useState<string>(currentWallpaperId || "photo_alpine_stars");
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(() => {
    return currentCustomUrl || safeLocalStorage.getItem(`swapskill_custom_wallpaper_${chatId}`) || null;
  });
  const [dimming, setDimming] = useState<number>(() => {
    const saved = safeLocalStorage.getItem(`swapskill_wallpaper_dim_${chatId}`);
    return saved ? parseFloat(saved) : (typeof currentDim === "number" ? currentDim : 0.35);
  });
  const [isBlur, setIsBlur] = useState<boolean>(() => {
    const saved = safeLocalStorage.getItem(`swapskill_wallpaper_blur_${chatId}`);
    return saved ? saved === "true" : Boolean(currentBlur);
  });
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [uploadError, setUploadError] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [syncBothParticipants, setSyncBothParticipants] = useState<boolean>(true);

  // Sync state if current props change
  useEffect(() => {
    if (isOpen) {
      if (currentWallpaperId) setSelectedId(currentWallpaperId);
      if (currentCustomUrl) setCustomImageUrl(currentCustomUrl);
      if (typeof currentDim === "number") setDimming(currentDim);
      if (typeof currentBlur === "boolean") setIsBlur(currentBlur);
    }
  }, [isOpen, currentWallpaperId, currentCustomUrl, currentDim, currentBlur]);

  // Active preview preset object
  const activePreset = useMemo(() => {
    if (selectedId === "custom" && customImageUrl) {
      return {
        id: "custom",
        name: "Custom Gallery Photo",
        category: "photos" as const,
        description: "Uploaded from your personal gallery",
        previewBg: "bg-black",
        imageUrl: customImageUrl,
        backgroundColor: "#0D0D10",
        textColor: "text-zinc-100",
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    return WALLPAPER_PRESETS.find((p) => p.id === selectedId) || WALLPAPER_PRESETS[0];
  }, [selectedId, customImageUrl]);

  const filteredPresets = useMemo(() => {
    if (activeCategory === "all") return WALLPAPER_PRESETS;
    return WALLPAPER_PRESETS.filter((p) => p.category === activeCategory);
  }, [activeCategory]);

  if (!isOpen) return null;

  // Handle Gallery file picker upload (Client-side compression, 0 AI quota used)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");
    setIsProcessing(true);

    try {
      if (!file.type.startsWith("image/")) {
        setUploadError("Please select a valid image file (JPG, PNG, WebP).");
        setIsProcessing(false);
        return;
      }

      // Automatically downsample & optimize client-side for smooth real-time performance
      const optimizedBlob = await optimizeImage(file, {
        maxWidth: 1280,
        maxHeight: 1280,
        quality: 0.82,
        outputFormat: "image/webp",
      });

      const reader = new FileReader();
      reader.onload = () => {
        const resultUrl = reader.result as string;
        setCustomImageUrl(resultUrl);
        setSelectedId("custom");
        setIsProcessing(false);
      };
      reader.onerror = () => {
        setUploadError("Could not read image file. Please try another image.");
        setIsProcessing(false);
      };
      reader.readAsDataURL(optimizedBlob);
    } catch (err) {
      console.error("Gallery wallpaper upload error:", err);
      setUploadError("Failed to process photo from gallery.");
      setIsProcessing(false);
    }
  };

  const handleApply = () => {
    onSelectWallpaper(selectedId, customImageUrl || undefined, dimming, isBlur);

    // Save to local storage for immediate zero-lag recall
    safeLocalStorage.setItem(`swapskill_wallpaper_${chatId}`, selectedId);
    safeLocalStorage.setItem(`swapskill_wallpaper_dim_${chatId}`, dimming.toString());
    safeLocalStorage.setItem(`swapskill_wallpaper_blur_${chatId}`, isBlur ? "true" : "false");

    if (selectedId === "custom" && customImageUrl) {
      safeLocalStorage.setItem(`swapskill_custom_wallpaper_${chatId}`, customImageUrl);
    }

    onClose();
  };

  const handleResetToDefault = () => {
    setSelectedId("photo_alpine_stars");
    setDimming(0.35);
    setIsBlur(false);
  };

  const categories = [
    { id: "all", label: "All Themes" },
    { id: "photos", label: "Scenic Photos" },
    { id: "nature", label: "Mountains & Forest" },
    { id: "aesthetic", label: "Aesthetic Neon" },
    { id: "luxury", label: "Prestige Luxury" },
    { id: "doodles", label: "Chat Doodles" },
    { id: "minimal", label: "Clean Minimal" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chat Wallpaper Studio"
      className="fixed inset-0 z-[125] bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 select-none font-sans"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#0E0F14]/98 border border-white/[0.12] rounded-[32px] overflow-hidden shadow-[0_36px_90px_rgba(0,0,0,0.85)] flex flex-col max-h-[92vh] backdrop-blur-3xl animate-in fade-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hidden Gallery Input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
        />

        {/* Modal Top Bar */}
        <div className="px-6 py-3.5 border-b border-white/[0.08] flex items-center justify-between bg-black/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-[#C9A96E]/20 text-[#C9A96E] border border-[#C9A96E]/30 flex items-center justify-center shadow-inner">
              <Palette size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                Chat Wallpaper
                <span className="text-[9px] font-bold uppercase px-2 py-0.2 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <Users size={10} /> Synced
                </span>
              </h3>
              <p className="text-[10.5px] text-zinc-400">Applied in real-time for both participants</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleResetToDefault}
              className="p-1.5 px-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition cursor-pointer text-xs flex items-center gap-1"
              title="Reset default"
            >
              <RotateCcw size={13} />
              <span className="text-[11px] hidden sm:inline">Reset</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-white/10 active:scale-90 text-zinc-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              aria-label="Close modal"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scrollbar-none">
          {/* Interactive Live Preview Stage */}
          <div className="relative rounded-2xl overflow-hidden border border-white/15 shadow-xl aspect-[16/8] sm:aspect-[16/7] flex flex-col justify-between p-3.5 select-none">
            {/* Background Image / Pattern */}
            <div
              className={`absolute inset-0 transition-all duration-300 ${activePreset.previewBg}`}
              style={{
                backgroundImage: activePreset.imageUrl
                  ? `url('${activePreset.imageUrl}')`
                  : activePreset.patternSvg
                  ? activePreset.patternSvg
                  : undefined,
                backgroundSize: activePreset.backgroundSize || "cover",
                backgroundPosition: activePreset.backgroundPosition || "center",
                backgroundColor: activePreset.backgroundColor,
                filter: isBlur ? "blur(8px)" : "none",
                transform: isBlur ? "scale(1.08)" : "scale(1)",
              }}
            />

            {/* Dark Overlay Tint Layer */}
            <div
              className="absolute inset-0 bg-black transition-opacity duration-200"
              style={{ opacity: dimming }}
            />

            {/* Top Preview Badge */}
            <div className="relative z-10 flex items-center justify-between">
              <div className="px-2.5 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white text-[10px] font-semibold flex items-center gap-1.5 shadow-md">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="truncate max-w-[140px]">{activePreset.name}</span>
              </div>
            </div>

            {/* Realistic Chat Bubbles Demo */}
            <div className="relative z-10 space-y-2 py-1 max-w-xs mx-auto w-full">
              {/* Partner message */}
              <div className="flex items-end gap-1.5">
                <div className="px-3 py-1.5 rounded-2xl rounded-bl-xs bg-zinc-900/90 backdrop-blur-md border border-white/15 text-white shadow-md text-xs">
                  <p className="leading-snug">Let's practice the swap session! 👋</p>
                  <span className="text-[9px] text-white/50 block text-right mt-0.5 font-mono">10:42 AM</span>
                </div>
              </div>
              {/* Current user message */}
              <div className="flex items-end justify-end gap-1.5">
                <div className="px-3 py-1.5 rounded-2xl rounded-br-xs bg-[#C9A96E] text-zinc-950 font-medium shadow-md text-xs">
                  <p className="leading-snug">Awesome, joining right now! 🚀</p>
                  <span className="text-[9px] text-zinc-800 block text-right mt-0.5 font-mono">10:43 AM</span>
                </div>
              </div>
            </div>

            {/* Floating Editor Controls on Preview */}
            <div className="relative z-10 flex items-center justify-between gap-3 bg-black/65 backdrop-blur-xl border border-white/15 px-3 py-1.5 rounded-xl shadow-lg">
              <div className="flex items-center gap-2 flex-1">
                <span className="text-[10px] text-zinc-400 font-medium shrink-0">Darken</span>
                <input
                  type="range"
                  min="0.10"
                  max="0.80"
                  step="0.05"
                  value={dimming}
                  onChange={(e) => setDimming(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#C9A96E]"
                />
                <span className="text-[10px] font-mono font-bold text-white shrink-0 min-w-[28px] text-right">
                  {Math.round(dimming * 100)}%
                </span>
              </div>

              <div className="h-3 w-px bg-white/20 shrink-0" />

              <button
                type="button"
                onClick={() => setIsBlur(!isBlur)}
                className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-lg border transition cursor-pointer shrink-0 ${
                  isBlur
                    ? "bg-[#C9A96E] text-zinc-950 border-[#C9A96E]"
                    : "bg-white/10 text-white/80 border-white/15 hover:bg-white/20"
                }`}
              >
                Blur {isBlur ? "On" : "Off"}
              </button>
            </div>
          </div>

          {/* Quick Action: Pick from Device Gallery */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className={`flex-1 py-2.5 px-4 rounded-2xl border transition flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer shadow-sm ${
                selectedId === "custom"
                  ? "bg-[#C9A96E]/20 text-[#C9A96E] border-[#C9A96E]/40 ring-1 ring-[#C9A96E]/30"
                  : "bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.99] text-white border-white/[0.08]"
              }`}
            >
              <Camera size={15} className="text-[#C9A96E]" />
              <span>{isProcessing ? "Optimizing photo..." : "Upload from Gallery"}</span>
            </button>

            {customImageUrl && (
              <button
                type="button"
                onClick={() => setSelectedId("custom")}
                className={`py-2 px-3 rounded-2xl border text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  selectedId === "custom"
                    ? "bg-[#C9A96E] text-zinc-950 border-[#C9A96E] font-bold"
                    : "bg-white/5 text-zinc-300 border-white/10 hover:bg-white/10"
                }`}
              >
                <span>My Photo</span>
                {selectedId === "custom" && <Check size={13} />}
              </button>
            )}
          </div>

          {uploadError && (
            <p className="text-xs text-rose-400 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
              {uploadError}
            </p>
          )}

          {/* Categories Pill Bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-medium tracking-tight whitespace-nowrap transition cursor-pointer shrink-0 ${
                  activeCategory === cat.id
                    ? "bg-[#C9A96E] text-zinc-950 font-bold shadow-sm"
                    : "bg-white/[0.05] text-zinc-400 hover:text-white hover:bg-white/[0.09] border border-white/[0.06]"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Wallpapers Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
            {filteredPresets.map((preset) => {
              const isSelected = selectedId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedId(preset.id)}
                  className={`group relative aspect-[16/10] rounded-2xl overflow-hidden border-2 text-left transition-all duration-200 cursor-pointer shadow-sm ${
                    isSelected
                      ? "border-[#C9A96E] ring-2 ring-[#C9A96E]/40 scale-[1.02]"
                      : "border-white/10 hover:border-white/30"
                  }`}
                >
                  <div
                    className={`absolute inset-0 ${preset.previewBg}`}
                    style={{
                      backgroundImage: preset.imageUrl
                        ? `url('${preset.imageUrl}')`
                        : preset.patternSvg
                        ? preset.patternSvg
                        : undefined,
                      backgroundSize: preset.backgroundSize || "cover",
                      backgroundPosition: preset.backgroundPosition || "center",
                      backgroundColor: preset.backgroundColor,
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

                  {/* Selected Tick Indicator */}
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#C9A96E] text-zinc-950 flex items-center justify-center shadow-md">
                      <Check size={12} strokeWidth={3} />
                    </div>
                  )}

                  {/* Title & Category */}
                  <div className="absolute bottom-2 inset-x-2">
                    <p className="text-[11px] font-semibold text-white leading-tight truncate drop-shadow-sm">
                      {preset.name}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Bidirectional Sync Banner */}
          <div className="px-3.5 py-2.5 rounded-2xl bg-[#C9A96E]/10 border border-[#C9A96E]/20 flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-full bg-[#C9A96E]/20 text-[#C9A96E] flex items-center justify-center shrink-0">
              <Users size={12} />
            </div>
            <p className="text-[11px] text-[#E5C483] font-medium leading-tight">
              Setting this wallpaper will immediately update the chat background for both you and your partner.
            </p>
          </div>
        </div>

        {/* Modal Bottom Actions */}
        <div className="px-6 py-3.5 border-t border-white/[0.08] flex items-center justify-between gap-3 bg-black/40">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleApply}
            className="flex-1 max-w-[200px] py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#C9A96E] hover:opacity-95 active:scale-98 text-zinc-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-[#C9A96E]/20 cursor-pointer transition"
          >
            <Check size={14} strokeWidth={3} />
            <span>Apply Wallpaper</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatWallpaperModal;

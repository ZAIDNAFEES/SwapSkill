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
  UploadCloud, 
  Sliders, 
  Eye, 
  Trash2, 
  RotateCcw,
  Camera
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
  // --- TOP PHOTOGRAPHIC & AESTHETIC MASTERPIECES ---
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

  // --- SIGNATURE VECTOR PATTERNS & MOTIFS ---
  {
    id: "whatsapp_deluxe",
    name: "Signature Chat Doodles",
    category: "doodles",
    description: "Handcrafted Telegram & WhatsApp conversation motifs",
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

interface ChatWallpaperModalProps {
  isOpen: boolean;
  chatId: string;
  currentWallpaperId: string;
  onSelectWallpaper: (presetId: string, customUrl?: string, dim?: number, blur?: boolean) => void;
  onClose: () => void;
}

export const ChatWallpaperModal: React.FC<ChatWallpaperModalProps> = ({
  isOpen,
  chatId,
  currentWallpaperId,
  onSelectWallpaper,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States
  const [selectedId, setSelectedId] = useState<string>(currentWallpaperId || "photo_alpine_stars");
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(() => {
    return safeLocalStorage.getItem(`swapskill_custom_wallpaper_${chatId}`) ||
           safeLocalStorage.getItem("swapskill_custom_wallpaper_default") ||
           null;
  });
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [dimming, setDimming] = useState<number>(() => {
    const saved = safeLocalStorage.getItem(`swapskill_wallpaper_dim_${chatId}`) ||
                  safeLocalStorage.getItem("swapskill_wallpaper_dim_default");
    return saved ? parseFloat(saved) : 0.35;
  });
  const [isBlur, setIsBlur] = useState<boolean>(() => {
    const saved = safeLocalStorage.getItem(`swapskill_wallpaper_blur_${chatId}`) ||
                  safeLocalStorage.getItem("swapskill_wallpaper_blur_default");
    return saved === "true";
  });
  const [applyGlobally, setApplyGlobally] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Sync initial state
  useEffect(() => {
    if (currentWallpaperId) {
      setSelectedId(currentWallpaperId);
    }
  }, [currentWallpaperId]);

  // Derived current wallpaper object for live preview
  const currentPreviewPreset = useMemo(() => {
    if (selectedId === "custom" && customImageUrl) {
      return {
        id: "custom",
        name: "My Custom Photo",
        category: "photos" as const,
        description: "Uploaded from your phone gallery",
        previewBg: "bg-black",
        imageUrl: customImageUrl,
        backgroundColor: "#0D0D0F",
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

      // Automatically downsample & optimize client-side for smooth performance
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

    // Save to local storage for instant persistent recall
    safeLocalStorage.setItem(`swapskill_wallpaper_${chatId}`, selectedId);
    safeLocalStorage.setItem(`swapskill_wallpaper_dim_${chatId}`, dimming.toString());
    safeLocalStorage.setItem(`swapskill_wallpaper_blur_${chatId}`, isBlur ? "true" : "false");

    if (selectedId === "custom" && customImageUrl) {
      safeLocalStorage.setItem(`swapskill_custom_wallpaper_${chatId}`, customImageUrl);
    }

    if (applyGlobally) {
      safeLocalStorage.setItem("swapskill_wallpaper_default", selectedId);
      safeLocalStorage.setItem("swapskill_wallpaper_dim_default", dimming.toString());
      safeLocalStorage.setItem("swapskill_wallpaper_blur_default", isBlur ? "true" : "false");
      if (selectedId === "custom" && customImageUrl) {
        safeLocalStorage.setItem("swapskill_custom_wallpaper_default", customImageUrl);
      }
    }

    onClose();
  };

  const handleResetToDefault = () => {
    setSelectedId("photo_alpine_stars");
    setDimming(0.35);
    setIsBlur(false);
  };

  const categories = [
    { id: "all", label: "All Wallpapers", icon: <Layers size={13} /> },
    { id: "photos", label: "📸 Scenic Photos", icon: <ImageIcon size={13} /> },
    { id: "nature", label: "🌲 Nature & Mountains", icon: <Compass size={13} /> },
    { id: "aesthetic", label: "🌅 Aesthetic Sunset & Neon", icon: <Sparkles size={13} /> },
    { id: "luxury", label: "👑 Luxury Gold & Marble", icon: <Moon size={13} /> },
    { id: "doodles", label: "💬 Chat Doodles", icon: <Feather size={13} /> },
    { id: "minimal", label: "Minimalist", icon: <Sun size={13} /> },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chat Wallpaper"
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none animate-fade-in font-sans"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#0D0D10]/98 border border-white/[0.12] rounded-[32px] overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.85)] flex flex-col max-h-[92vh] backdrop-blur-2xl"
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
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between bg-black/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#C9A96E]/20 text-[#C9A96E] border border-[#C9A96E]/30 flex items-center justify-center shadow-inner">
              <Palette size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                Chat Wallpapers
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[#C9A96E]/15 text-[#C9A96E] border border-[#C9A96E]/30">
                  HD Studio
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400">Choose from aesthetic photos, vector art or your own gallery</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetToDefault}
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition cursor-pointer text-xs flex items-center gap-1"
              title="Reset to default wallpaper"
            >
              <RotateCcw size={14} />
              <span className="hidden sm:inline">Reset</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-white/10 active:scale-90 text-zinc-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              aria-label="Close wallpaper modal"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Main Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 scrollbar-none">
          
          {/* 1. INTERACTIVE LIVE SIMULATOR PREVIEW */}
          <div className="relative w-full h-44 rounded-2xl overflow-hidden border border-white/[0.12] shadow-xl flex flex-col justify-between p-3.5 group">
            {/* Background Layer with Dimming & Blur */}
            <div
              className="absolute inset-0 transition-all duration-300"
              style={{
                backgroundImage: currentPreviewPreset?.imageUrl
                  ? `linear-gradient(rgba(13, 13, 16, ${dimming}), rgba(13, 13, 16, ${dimming})), url("${currentPreviewPreset.imageUrl}")`
                  : (currentPreviewPreset?.patternSvg || undefined),
                backgroundColor: currentPreviewPreset?.backgroundColor !== "transparent" ? currentPreviewPreset?.backgroundColor : "#0D0D10",
                backgroundSize: currentPreviewPreset?.backgroundSize || (currentPreviewPreset?.imageUrl ? "cover" : "auto"),
                backgroundPosition: currentPreviewPreset?.backgroundPosition || "center",
                backgroundRepeat: currentPreviewPreset?.backgroundRepeat || (currentPreviewPreset?.imageUrl ? "no-repeat" : "repeat"),
                filter: isBlur ? "blur(6px)" : "none",
                transform: isBlur ? "scale(1.05)" : "none",
              }}
            />

            {/* Top Preview Label Badge */}
            <div className="relative z-10 flex items-center justify-between">
              <span className="px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md text-[10px] font-semibold text-white/90 border border-white/10 flex items-center gap-1.5 shadow-sm">
                <Eye size={12} className="text-[#C9A96E]" />
                Live Preview: <span className="text-[#C9A96E]">{currentPreviewPreset.name}</span>
              </span>
              {selectedId === "custom" && (
                <span className="px-2 py-0.5 rounded-full bg-[#C9A96E] text-black text-[9px] font-bold shadow-md">
                  From Gallery
                </span>
              )}
            </div>

            {/* Simulated Telegram / WhatsApp Message Bubbles */}
            <div className="relative z-10 flex flex-col gap-2 max-w-sm w-full mx-auto">
              <div className="self-start max-w-[78%] px-3 py-1.5 rounded-2xl rounded-tl-sm bg-[#1A1A1E]/90 text-white text-[11px] shadow-lg border border-white/10 backdrop-blur-md">
                <span>Hey! Let's swap skills today? ✦</span>
                <span className="text-[8px] text-zinc-400 block text-right mt-0.5">10:42 AM</span>
              </div>
              <div className="self-end max-w-[78%] px-3 py-1.5 rounded-2xl rounded-tr-sm bg-[#C9A96E] text-black font-semibold text-[11px] shadow-lg shadow-[#C9A96E]/20">
                <span>Yes, let's learn TypeScript! 🚀</span>
                <span className="text-[8px] text-black/70 block text-right mt-0.5">10:43 AM ✓✓</span>
              </div>
            </div>
          </div>

          {/* 2. GALLERY UPLOAD CARD + ADJUSTMENT SLIDERS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Gallery Upload Card */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="p-3.5 rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-[#C9A96E]/30 hover:border-[#C9A96E] flex items-center gap-3 transition-all cursor-pointer group text-left active:scale-[0.98] shadow-sm"
            >
              <div className="w-10 h-10 rounded-xl bg-[#C9A96E]/20 text-[#C9A96E] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Camera size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                  Choose from Gallery
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#C9A96E] text-black font-bold uppercase">Photos</span>
                </p>
                <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                  {isProcessing ? "Optimizing image..." : "Pick any image from your device"}
                </p>
              </div>
            </button>

            {/* Quick Dimming & Blur Controller */}
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                  <Sliders size={13} className="text-[#C9A96E]" />
                  Dark Overlay Tint: <span className="text-white font-mono">{Math.round(dimming * 100)}%</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsBlur(!isBlur)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition cursor-pointer ${
                    isBlur ? "bg-[#C9A96E] text-black" : "bg-white/10 text-zinc-300 hover:text-white"
                  }`}
                >
                  {isBlur ? "Blurred: ON" : "Blur: OFF"}
                </button>
              </div>

              {/* Range slider */}
              <input
                type="range"
                min="0.1"
                max="0.75"
                step="0.05"
                value={dimming}
                onChange={(e) => setDimming(parseFloat(e.target.value))}
                className="w-full accent-[#C9A96E] h-1.5 bg-white/10 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {uploadError && (
            <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
              {uploadError}
            </div>
          )}

          {/* 3. CATEGORY SELECTOR PILLS */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                  activeCategory === cat.id
                    ? "bg-[#C9A96E] text-black shadow-sm"
                    : "bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-white border border-white/[0.06]"
                }`}
              >
                {cat.icon}
                <span>{cat.label}</span>
              </button>
            ))}
          </div>

          {/* 4. WALLPAPER PRESETS GRID */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* If user has uploaded a custom image, show it first */}
            {customImageUrl && (
              <button
                type="button"
                onClick={() => setSelectedId("custom")}
                className={`group relative flex flex-col text-left rounded-2xl overflow-hidden border transition-all p-2 cursor-pointer ${
                  selectedId === "custom"
                    ? "border-[#C9A96E] ring-2 ring-[#C9A96E]/40 bg-white/[0.08] shadow-md shadow-[#C9A96E]/10"
                    : "border-white/[0.08] hover:border-white/[0.2] bg-white/[0.02]"
                }`}
              >
                <div
                  className="w-full h-28 rounded-xl mb-2 relative overflow-hidden bg-cover bg-center shadow-inner"
                  style={{ backgroundImage: `url("${customImageUrl}")` }}
                >
                  <div className="absolute inset-0 bg-black/30 pointer-events-none" />
                  <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[8px] font-bold text-[#C9A96E]">
                    My Photo
                  </span>
                  {selectedId === "custom" && (
                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#C9A96E] text-black flex items-center justify-center shadow-md">
                      <Check size={13} strokeWidth={3} />
                    </div>
                  )}
                </div>
                <p className="text-xs font-bold text-white truncate">My Custom Photo</p>
                <p className="text-[10px] text-zinc-400 truncate">From device gallery</p>
              </button>
            )}

            {filteredPresets.map((preset) => {
              const isSelected = selectedId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedId(preset.id)}
                  className={`group relative flex flex-col text-left rounded-2xl overflow-hidden border transition-all p-2 cursor-pointer ${
                    isSelected
                      ? "border-[#C9A96E] ring-2 ring-[#C9A96E]/40 bg-white/[0.08] shadow-md shadow-[#C9A96E]/10"
                      : "border-white/[0.08] hover:border-white/[0.2] bg-white/[0.02] hover:bg-white/[0.04]"
                  }`}
                >
                  {/* Thumbnail Card */}
                  <div
                    className={`w-full h-28 rounded-xl mb-2 relative overflow-hidden shadow-inner ${preset.previewBg}`}
                    style={{
                      backgroundImage: preset.imageUrl
                        ? `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.25)), url("${preset.imageUrl}")`
                        : preset.patternSvg,
                      backgroundColor: preset.backgroundColor !== "transparent" ? preset.backgroundColor : undefined,
                      backgroundSize: preset.backgroundSize || (preset.imageUrl ? "cover" : "auto"),
                      backgroundPosition: preset.backgroundPosition || "center",
                      backgroundRepeat: preset.backgroundRepeat || (preset.imageUrl ? "no-repeat" : "repeat"),
                    }}
                  >
                    {/* Simulated miniature bubble for realistic feel */}
                    <div className="absolute bottom-2 left-2 right-2 py-1 px-2 rounded-lg bg-black/60 backdrop-blur-xs text-[8px] text-white/90 truncate border border-white/10">
                      Hello! ✦
                    </div>

                    {isSelected && (
                      <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#C9A96E] text-black flex items-center justify-center shadow-md z-10 animate-scale-in">
                        <Check size={13} strokeWidth={3} />
                      </div>
                    )}
                  </div>

                  <p className="text-xs font-bold text-white truncate tracking-tight">{preset.name}</p>
                  <p className="text-[10px] text-zinc-400 line-clamp-1 mt-0.5 leading-snug">{preset.description}</p>
                </button>
              );
            })}
          </div>

          {/* 5. APPLY GLOBALLY TOGGLE */}
          <label className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] cursor-pointer select-none transition mt-2">
            <input
              type="checkbox"
              checked={applyGlobally}
              onChange={(e) => setApplyGlobally(e.target.checked)}
              className="rounded-md accent-[#C9A96E] w-4 h-4 cursor-pointer"
            />
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-zinc-200">Set as default wallpaper for all chats</span>
              <span className="text-[10px] text-zinc-400">All current and future conversation threads will use this wallpaper</span>
            </div>
          </label>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.08] flex items-center justify-between bg-black/40">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
          >
            Cancel
          </button>
          
          <button
            type="button"
            onClick={handleApply}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#C9A96E] hover:bg-[#d8b97d] text-black shadow-lg shadow-[#C9A96E]/20 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
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

import React, { useState, useCallback, useEffect } from "react";
import Cropper, { Area, Point } from "react-easy-crop";
import { motion, AnimatePresence } from "motion/react";
import { X, Check, ZoomIn, ZoomOut, RotateCw, Loader2, Sparkles, Image as ImageIcon } from "lucide-react";
import { getCroppedImg } from "../utils/cropImage";

export interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  cropType: "profile" | "cover";
  title?: string;
  isProcessing?: boolean;
  onClose: () => void;
  onConfirm: (croppedBlob: Blob, croppedUrl: string) => void | Promise<void>;
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageSrc,
  cropType,
  title,
  isProcessing = false,
  onClose,
  onConfirm,
}) => {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Reset controls when a new image or modal is opened
  useEffect(() => {
    if (isOpen) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setCroppedAreaPixels(null);
      setIsApplying(false);
      setErrorMessage("");
    }
  }, [isOpen, imageSrc]);

  const onCropComplete = useCallback((_croppedArea: Area, currentCroppedAreaPixels: Area) => {
    setCroppedAreaPixels(currentCroppedAreaPixels);
  }, []);

  const handleApplyCrop = async () => {
    if (!imageSrc || !croppedAreaPixels) return;

    try {
      setIsApplying(true);
      setErrorMessage("");

      const targetWidth = cropType === "profile" ? 640 : 1200;
      const targetHeight = cropType === "profile" ? 640 : 400; // 3:1 banner ratio

      const croppedBlob = await getCroppedImg(
        imageSrc,
        croppedAreaPixels,
        targetWidth,
        targetHeight,
        0.92
      );

      const croppedUrl = URL.createObjectURL(croppedBlob);
      await onConfirm(croppedBlob, croppedUrl);
    } catch (err: any) {
      console.error("Failed to crop image:", err);
      setErrorMessage(err?.message || "Failed to process image crop. Please try another image.");
      setIsApplying(false);
    }
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const isProfile = cropType === "profile";
  const aspect = isProfile ? 1 : 3 / 1; // 1:1 for profile, 3:1 for cover banner
  const modalTitle = title || (isProfile ? "Crop Profile Picture" : "Crop Cover Banner");
  const modalSubtitle = isProfile
    ? "Drag to reposition and pinch/zoom to frame your 1:1 square profile avatar."
    : "Drag to frame and adjust your wide banner (3:1 aspect ratio).";

  if (!isOpen || !imageSrc) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md select-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="bg-[#141417] border border-[#27272A] rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden text-[#F7F4EE] max-h-[92vh]"
        >
          {/* Header */}
          <div className="px-4 sm:px-6 py-4 border-b border-[#27272A] flex items-center justify-between shrink-0 bg-[#0D0D0F]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37] shrink-0">
                <ImageIcon size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-bold text-[#F7F4EE] tracking-tight truncate">
                  {modalTitle}
                </h3>
                <p className="text-[11px] text-[#A1A1AA] truncate">
                  {isProfile ? "Square (1:1 Ratio)" : "Banner (3:1 Ratio)"}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isApplying || isProcessing}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-[#A1A1AA] hover:text-[#F7F4EE] flex items-center justify-center transition cursor-pointer disabled:opacity-50"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Cropper Viewport */}
          <div className="relative w-full h-64 sm:h-80 bg-black/90 overflow-hidden flex items-center justify-center">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspect}
              cropShape={isProfile ? "round" : "rect"}
              showGrid={true}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              zoomSpeed={0.8}
              minZoom={1}
              maxZoom={3.5}
              classes={{
                containerClassName: "w-full h-full",
                cropAreaClassName: isProfile
                  ? "border-2 border-[#D4AF37] shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]"
                  : "border-2 border-[#D4AF37] shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] rounded-lg",
              }}
            />

            {(isApplying || isProcessing) && (
              <div className="absolute inset-0 z-30 bg-black/75 backdrop-blur-xs flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin" />
                <span className="text-xs font-semibold text-[#F7F4EE]">Processing & Uploading...</span>
              </div>
            )}
          </div>

          {/* Controls Panel */}
          <div className="p-4 sm:p-5 flex flex-col gap-4 bg-[#141417] shrink-0 border-t border-[#27272A]">
            <p className="text-xs text-[#A1A1AA] text-center leading-relaxed">
              {modalSubtitle}
            </p>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs text-center">
                {errorMessage}
              </div>
            )}

            {/* Zoom and Rotate controls */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(1, z - 0.2))}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-[#A1A1AA] hover:text-[#F7F4EE] flex items-center justify-center transition cursor-pointer"
                title="Zoom Out"
                aria-label="Zoom Out"
              >
                <ZoomOut size={16} />
              </button>

              <div className="flex-1 flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={3.5}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-full h-1.5 bg-[#27272A] rounded-lg appearance-none cursor-pointer accent-[#D4AF37]"
                />
              </div>

              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3.5, z + 0.2))}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-[#A1A1AA] hover:text-[#F7F4EE] flex items-center justify-center transition cursor-pointer"
                title="Zoom In"
                aria-label="Zoom In"
              >
                <ZoomIn size={16} />
              </button>

              <button
                type="button"
                onClick={handleRotate}
                className="px-2.5 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-[#A1A1AA] hover:text-[#F7F4EE] flex items-center gap-1.5 text-xs font-medium transition cursor-pointer shrink-0"
                title="Rotate 90°"
              >
                <RotateCw size={14} />
                <span className="hidden sm:inline">Rotate</span>
              </button>
            </div>

            {/* Actions: Cancel vs Confirm Crop */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={isApplying || isProcessing}
                className="flex-1 h-11 rounded-xl bg-white/5 hover:bg-white/10 text-[#F7F4EE] text-xs sm:text-sm font-semibold transition cursor-pointer border border-[#27272A] disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleApplyCrop}
                disabled={isApplying || isProcessing}
                className="flex-1 h-11 rounded-xl bg-[#D4AF37] hover:bg-[#C9A96E] active:scale-[0.98] text-[#0D0D0F] text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
              >
                {isApplying || isProcessing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check size={16} className="stroke-[2.5]" />
                    <span>Confirm & Upload</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

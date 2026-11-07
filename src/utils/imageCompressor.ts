/**
 * Image Optimization Utility for Cloudinary Uploads & Local Previews
 * 
 * Requirements satisfied:
 * - Profile images: max 800x800
 * - Other uploaded images (cover, chat, camera): max 1200x1200
 * - Automatic Cloudinary optimization: quality `q_auto` and format `f_auto`
 * - Aspect ratio strictly preserved for portrait, landscape, and square images
 * - High-quality downsampling with balanced compression to reduce Cloudinary storage usage
 * - Transparent PNG background handling (clean white background fill)
 * - Safe fallback to original file/blob on any browser canvas limitation
 */

export interface ImageOptimizationOptions {
  type?: "profile" | "other";
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  outputFormat?: "image/jpeg" | "image/webp";
  fileName?: string;
}

/**
 * Checks if a File or Blob is an image.
 */
export function isImageFile(fileOrBlob: File | Blob): boolean {
  if (!fileOrBlob) return false;
  if (fileOrBlob.type && fileOrBlob.type.startsWith("image/")) return true;
  if (fileOrBlob instanceof File && /\.(jpe?g|png|webp|gif|bmp|heic|tiff|avif)$/i.test(fileOrBlob.name)) {
    return true;
  }
  return false;
}

/**
 * Automatically optimizes an image file or blob before uploading to Cloudinary.
 * Resizes large images (Profile: max 800x800, Other: max 1200x1200),
 * maintains aspect ratio for portrait, landscape, and square,
 * and encodes with high visual quality (quality 0.85).
 * 
 * Returns the optimized version so the original uncompressed image is never stored.
 */
export function optimizeImage<T extends File | Blob>(
  fileOrBlob: T,
  options: ImageOptimizationOptions = {}
): Promise<T> {
  return new Promise((resolve) => {
    // Basic validation: only optimize images
    if (!isImageFile(fileOrBlob)) {
      resolve(fileOrBlob);
      return;
    }

    // Do not compress animated GIFs or SVGs
    if (fileOrBlob.type === "image/gif" || fileOrBlob.type === "image/svg+xml") {
      resolve(fileOrBlob);
      return;
    }

    const isProfile = options.type === "profile";
    const maxWidth = options.maxWidth ?? (isProfile ? 800 : 1200);
    const maxHeight = options.maxHeight ?? (isProfile ? 800 : 1200);
    const quality = typeof options.quality === "number" ? options.quality : 0.85;
    const outputFormat = options.outputFormat || "image/jpeg";

    let objectUrl: string | null = null;

    const cleanup = () => {
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (_) {}
        objectUrl = null;
      }
    };

    const processImage = (img: HTMLImageElement) => {
      try {
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;

        if (!naturalWidth || !naturalHeight) {
          cleanup();
          resolve(fileOrBlob);
          return;
        }

        let targetWidth = naturalWidth;
        let targetHeight = naturalHeight;

        // Proportional resize preserving aspect ratio for portrait, landscape, and square
        if (targetWidth > maxWidth || targetHeight > maxHeight) {
          const scale = Math.min(maxWidth / targetWidth, maxHeight / targetHeight);
          targetWidth = Math.max(1, Math.round(targetWidth * scale));
          targetHeight = Math.max(1, Math.round(targetHeight * scale));
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) {
          cleanup();
          resolve(fileOrBlob);
          return;
        }

        // Enable high quality image downsampling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        // For JPEG output, fill white background to prevent transparent areas from turning black
        if (outputFormat === "image/jpeg") {
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, targetWidth, targetHeight);
        }

        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (blob) => {
            cleanup();
            if (!blob) {
              resolve(fileOrBlob);
              return;
            }

            if (fileOrBlob instanceof File) {
              const originalName = options.fileName || fileOrBlob.name || "image.jpg";
              const baseName = originalName.replace(/\.[^/.]+$/, "");
              const extension = outputFormat === "image/webp" ? ".webp" : ".jpg";
              const optimizedFile = new File([blob], `${baseName}${extension}`, {
                type: outputFormat,
                lastModified: Date.now()
              });
              resolve(optimizedFile as unknown as T);
            } else {
              resolve(blob as unknown as T);
            }
          },
          outputFormat,
          quality
        );
      } catch (err) {
        console.warn("optimizeImage canvas processing error:", err);
        cleanup();
        resolve(fileOrBlob);
      }
    };

    // Load image using object URL with FileReader fallback
    try {
      objectUrl = URL.createObjectURL(fileOrBlob);
      const img = new Image();
      img.onload = () => processImage(img);
      img.onerror = () => {
        cleanup();
        // Fallback to FileReader
        const reader = new FileReader();
        reader.onload = (e) => {
          const fallbackImg = new Image();
          fallbackImg.onload = () => processImage(fallbackImg);
          fallbackImg.onerror = () => resolve(fileOrBlob);
          fallbackImg.src = e.target?.result as string;
        };
        reader.onerror = () => resolve(fileOrBlob);
        reader.readAsDataURL(fileOrBlob);
      };
      img.src = objectUrl;
    } catch (e) {
      cleanup();
      // Secondary fallback
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => processImage(img);
        img.onerror = () => resolve(fileOrBlob);
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(fileOrBlob);
      reader.readAsDataURL(fileOrBlob);
    }
  });
}

/**
 * Backward-compatible helper that compresses an image file to a Blob.
 */
export function compressImage(
  fileOrBlob: File | Blob,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.85
): Promise<Blob> {
  return optimizeImage(fileOrBlob, {
    maxWidth,
    maxHeight,
    quality
  }).then((result) => (result instanceof Blob ? result : new Blob([result], { type: "image/jpeg" })));
}

/**
 * Injects Cloudinary automatic optimization parameters: `f_auto,q_auto`.
 * Handles URLs with or without existing transformations cleanly,
 * preventing duplicate transformation segments.
 */
export function applyCloudinaryAutoOptimization(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "";
  if (!url.includes("res.cloudinary.com")) return url;

  const uploadIndex = url.indexOf("/upload/");
  if (uploadIndex === -1) return url;

  const prefix = url.substring(0, uploadIndex + 8); // ".../upload/"
  const remainder = url.substring(uploadIndex + 8);

  // If already contains f_auto and q_auto in the leading segment, return as-is
  const firstSlash = remainder.indexOf("/");
  if (firstSlash !== -1) {
    const firstSegment = remainder.substring(0, firstSlash);
    if (firstSegment.includes("f_auto") && firstSegment.includes("q_auto")) {
      return url;
    }
    // If first segment is another transformation (not a version like v1234567...)
    if (!/^v\d+$/.test(firstSegment) && (firstSegment.includes("_") || firstSegment.includes(","))) {
      const rest = remainder.substring(firstSlash + 1);
      const tags = firstSegment.split(",");
      if (!tags.includes("f_auto")) tags.unshift("f_auto");
      if (!tags.includes("q_auto")) tags.unshift("q_auto");
      return `${prefix}${tags.join(",")}/${rest}`;
    }
  }

  // Prepend f_auto,q_auto before remainder
  return `${prefix}f_auto,q_auto/${remainder}`;
}

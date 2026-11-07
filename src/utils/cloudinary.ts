/**
 * Cloudinary Production Upload Service for SwapSkill
 *
 * Requirements:
 * - Uses VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET for unsigned uploads.
 * - Integrates image optimization/compression before uploading (preserving aspect ratios, max dimensions).
 * - Injects Cloudinary automatic performance transformations (f_auto, q_auto).
 * - CRITICAL: When Cloudinary is configured, fails fast with actionable errors rather than
 *   silently dumping multi-megabyte Base64 strings into Firestore documents.
 */

import { optimizeImage, applyCloudinaryAutoOptimization } from "./imageCompressor";

export interface CloudinaryConfig {
  cloudName: string;
  uploadPreset: string;
  isConfigured: boolean;
}

export interface CloudinaryUploadOptions {
  type?: "profile" | "cover" | "chat" | "other";
  folder?: string;
  fileName?: string;
  onProgress?: (progressPercent: number) => void;
  // If true and Cloudinary is NOT configured, returns an aggressively compressed local thumbnail (offline dev only)
  allowDevOfflineFallback?: boolean;
}

/**
 * Reads Cloudinary credentials from Vite environment variables or local storage overrides.
 */
export function getCloudinaryConfig(): CloudinaryConfig {
  let savedCloudName = "";
  let savedUploadPreset = "";

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      savedCloudName = window.localStorage.getItem("cloudinary_cloud_name") || "";
      savedUploadPreset = window.localStorage.getItem("cloudinary_upload_preset") || "";
    }
  } catch (_) {
    // Ignore storage errors in restricted contexts
  }

  const cloudName = (
    ((import.meta as any).env?.VITE_CLOUDINARY_CLOUD_NAME as string) ||
    savedCloudName ||
    ""
  ).trim();

  const uploadPreset = (
    ((import.meta as any).env?.VITE_CLOUDINARY_UPLOAD_PRESET as string) ||
    savedUploadPreset ||
    ""
  ).trim();

  return {
    cloudName,
    uploadPreset,
    isConfigured: Boolean(cloudName && uploadPreset),
  };
}

/**
 * Checks if Cloudinary is configured for production uploads.
 */
export function isCloudinaryConfigured(): boolean {
  const { isConfigured } = getCloudinaryConfig();
  return isConfigured;
}

/**
 * Uploads an image to Cloudinary using unsigned upload.
 * Pre-optimizes and compresses the image before transmission.
 *
 * When Cloudinary credentials are present, this function NEVER falls back to Base64
 * if the upload fails. Instead, it rejects with a clear error so large Base64 strings
 * are never stored in Firestore.
 */
export async function uploadImageToCloudinary(
  fileOrBlob: File | Blob,
  options: CloudinaryUploadOptions = {}
): Promise<string> {
  const { cloudName, uploadPreset, isConfigured } = getCloudinaryConfig();
  const type = options.type || "other";
  const isProfile = type === "profile";
  const folder = options.folder || (isProfile ? "swap_skill_profiles" : "swap_skill_chat");

  options.onProgress?.(5);

  // 1. Optimize image before upload to minimize network usage and Cloudinary storage
  const optimizedBlob = await optimizeImage(fileOrBlob, {
    type: isProfile ? "profile" : "other",
    maxWidth: isProfile ? 800 : 1200,
    maxHeight: isProfile ? 800 : 1200,
    quality: 0.85,
  });

  options.onProgress?.(20);

  // 2. Production Path: Cloudinary is configured
  if (isConfigured) {
    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          options.onProgress?.(Math.max(20, percent));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.secure_url) {
              options.onProgress?.(100);
              const optimizedUrl = applyCloudinaryAutoOptimization(data.secure_url);
              resolve(optimizedUrl);
            } else {
              reject(new Error("Cloudinary response missing secure_url"));
            }
          } catch (parseErr) {
            reject(new Error("Invalid response received from Cloudinary"));
          }
        } else {
          try {
            const errData = JSON.parse(xhr.responseText);
            const msg = errData.error?.message || `Cloudinary upload failed with status ${xhr.status}`;
            reject(new Error(msg));
          } catch (_) {
            reject(new Error(`Cloudinary server error (${xhr.status}). Verify cloud name & upload preset.`));
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error("Network connection failed during image upload. Please check your internet connection."));
      };

      xhr.onabort = () => {
        reject(new Error("Image upload was cancelled"));
      };

      const formData = new FormData();
      const safeFileName = options.fileName || `${type}_${Date.now()}.jpg`;
      formData.append("file", optimizedBlob, safeFileName);
      formData.append("upload_preset", uploadPreset);
      formData.append("folder", folder);

      xhr.send(formData);
    });
  }

  // 3. Fallback Path: Cloudinary NOT configured (sandbox/dev mode only)
  if (options.allowDevOfflineFallback !== false) {
    console.warn(
      "[Cloudinary] VITE_CLOUDINARY_CLOUD_NAME or VITE_CLOUDINARY_UPLOAD_PRESET is missing. Using lightweight compressed fallback for local preview."
    );

    // Highly compress to prevent large Base64 blobs in Firestore (max 350x350, quality 0.6)
    const microBlob = await optimizeImage(optimizedBlob, {
      maxWidth: 350,
      maxHeight: 350,
      quality: 0.6,
    });

    options.onProgress?.(60);

    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        options.onProgress?.(100);
        resolve(reader.result as string);
      };
      reader.onerror = () => reject(new Error("Failed to process local image"));
      reader.readAsDataURL(microBlob);
    });
  }

  throw new Error("Cloudinary image storage is not configured (VITE_CLOUDINARY_CLOUD_NAME or VITE_CLOUDINARY_UPLOAD_PRESET is missing).");
}

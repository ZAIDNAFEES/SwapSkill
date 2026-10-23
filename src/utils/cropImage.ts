export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });

/**
 * Returns the cropped image Blob with the exact pixel bounds and optional target resolution
 */
export async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  targetWidth?: number,
  targetHeight?: number,
  quality = 0.92
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Unable to create canvas 2D rendering context");
  }

  // Calculate destination dimensions
  const outWidth = targetWidth || Math.max(100, Math.round(pixelCrop.width));
  const outHeight = targetHeight || Math.max(100, Math.round(pixelCrop.height));

  canvas.width = outWidth;
  canvas.height = outHeight;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Draw the selected crop region
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outWidth,
    outHeight
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Image processing failed: Canvas returned empty blob"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

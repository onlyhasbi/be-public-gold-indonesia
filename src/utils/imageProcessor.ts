import sharp from "sharp";

interface ProcessedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

/**
 * Compress and convert any uploaded image to WebP format.
 *
 * - Resizes to max 800x800 (preserving aspect ratio)
 * - Converts to WebP format (30-50% smaller than JPEG/PNG)
 * - Quality set to 80 (good balance between quality and file size)
 *
 * A typical 3MB phone photo becomes ~50-150KB after processing.
 */
export const processImage = async (file: File): Promise<ProcessedImage> => {
  const arrayBuffer = await file.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  // Jika formatnya sudah webp, maka langsung return tanpa memproses ulang (compress/resize)
  if (file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp")) {
    return {
      buffer: inputBuffer,
      mimeType: "image/webp",
      extension: "webp",
    };
  }

  const outputBuffer = await sharp(inputBuffer)
    .resize(800, 800, {
      fit: "inside", // Maintain aspect ratio, fit within 800x800
      withoutEnlargement: true, // Don't upscale small images
    })
    .webp({
      quality: 80, // 80% quality — great balance
      effort: 4, // Compression effort (0-6), 4 is balanced
    })
    .toBuffer();

  return {
    buffer: outputBuffer,
    mimeType: "image/webp",
    extension: "webp",
  };
};

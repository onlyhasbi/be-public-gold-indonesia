/**
 * Input sanitization utilities.
 * Prevents XSS and basic injection attacks by cleaning user inputs.
 */

/** Strip HTML tags and dangerous characters from a string */
export const sanitizeString = (input: string): string => {
  return input
    .replace(/[<>]/g, "") // Remove angle brackets (prevents HTML injection)
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, "") // Remove inline event handlers (onclick=, onerror=, etc.)
    .trim();
};

/** Validate and sanitize a PGCode format */
export const sanitizePGCode = (pgcode: string): string => {
  // Only allow alphanumeric characters and basic symbols
  return pgcode.replace(/[^a-zA-Z0-9_\-]/g, "").trim();
};

/** Validate and sanitize a Page ID format */
export const sanitizePageId = (pageid: string): string => {
  // Only allow URL-safe characters (lowercase alphanumeric, hyphens, underscores)
  return pageid
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, "")
    .trim();
};

/** Format search keyword for SQLite FTS5 MATCH clause safely */
export const escapeFts = (query: string): string => {
  // Remove special characters that can break FTS parser
  const cleaned = query.replace(/[^a-zA-Z0-9\s]/g, "").trim();
  if (!cleaned) return "";

  // Split into words and quote each to prevent syntax errors
  // Example: "john doe" -> '"john" AND "doe"'
  const words = cleaned.split(/\s+/);
  return words.map((word) => `"${word}"`).join(" AND ");
};

/** Validate email format */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/** Validate phone number (Indonesian format) */
export const isValidPhone = (phone: string): boolean => {
  // Accepts: 08xxx, 628xxx, +628xxx
  const phoneRegex = /^(\+?62|0)[0-9]{8,13}$/;
  return phoneRegex.test(phone.replace(/[\s\-]/g, ""));
};

/** Validate URL format */
export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/** Allowed image MIME types */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

/** Max file size: 2MB */
export const MAX_FILE_SIZE = 2 * 1024 * 1024;

/** Validate uploaded file */
export const validateImageFile = (
  file: File,
): { valid: boolean; error?: string } => {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Tipe file tidak didukung: ${file.type}. Gunakan JPEG, PNG, WebP, atau GIF.`,
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `Ukuran file terlalu besar (${(file.size / 1024 / 1024).toFixed(1)}MB). Maksimal 2MB.`,
    };
  }
  return { valid: true };
};

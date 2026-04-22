import { db } from "../db/db";

/**
 * Retrieves a system setting by its key.
 */
export const getSetting = async (key: string): Promise<string | null> => {
  try {
    const result = await db.execute({
      sql: "SELECT value FROM system_settings WHERE key = ?",
      args: [key],
    });
    return result.rows.length > 0 ? (result.rows[0].value as string) : null;
  } catch (error) {
    console.error(`[Settings] Failed to get setting ${key}:`, error);
    return null;
  }
};

/**
 * Updates or inserts a system setting.
 */
export const updateSetting = async (key: string, value: string) => {
  try {
    await db.execute({
      sql: `
        INSERT INTO system_settings (key, value, updated_at) 
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `,
      args: [key, value],
    });
  } catch (error) {
    console.error(`[Settings] Failed to update setting ${key}:`, error);
    throw error;
  }
};

/**
 * Generates a random alphanumeric secret code.
 */
export const generateRandomCode = (length = 8) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Rotates the portal secret code if the last rotation was not today.
 * This implements a passive scheduler that runs on server requests.
 */
export const rotateSecretIfNeeded = async () => {
  try {
    const lastRotation = await getSetting("last_rotation_date");
    const autoRotate = await getSetting("portal_secret_auto_rotate");
    const today = new Date().toISOString().split("T")[0];

    // Hanya lakukan generate ulang/rotate jika sakelar auto_rotate aktif ATAU default aktif belum diset (agar backward compatible, walau aman jika diset 'true')
    // Jika explicitly "false", berarti tidak memutar kodenya.
    if (autoRotate === "true" && lastRotation !== today) {
      const newCode = generateRandomCode(8);
      await updateSetting("portal_secret_code", newCode);
      await updateSetting("last_rotation_date", today);
    }
  } catch (err) {
    console.error("[Rotation] Passive rotation check failed:", err);
  }
};

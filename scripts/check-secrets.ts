import { execSync } from "node:child_process";

// List of regex patterns to look for (common secret formats)
const PATTERNS = [
  {
    name: "API Key / Secret (Generic)",
    // Matches keys/secrets in assignments: SECRET="...", API_KEY = "..."
    regex:
      /(?:SECRET|PASSWORD|TOKEN|AUTH_TOKEN|API_KEY|PRIVATE_KEY|DATABASE_URL)\s*[:=]\s*["'][^"']{8,}["']/i,
  },
  {
    name: "Potential Cloudinary Secret",
    regex: /CLOUDINARY_API_SECRET\s*[:=]\s*["'][a-zA-Z0-9_-]{20,}["']/i,
  },
  {
    name: "Potential Turso Auth Token",
    regex: /TURSO_AUTH_TOKEN\s*[:=]\s*["']eyJ[a-zA-Z0-9._-]{50,}["']/i,
  },
  {
    name: "Potential JWT Secret",
    regex: /JWT_SECRET\s*[:=]\s*["'][^"']{10,}["']/i,
  },
];

// Files to exclude from scanning (e.g., this script itself, lock files)
const EXCLUDE_FILES = [
  "scripts/check-secrets.ts",
  "bun.lock",
  "package-lock.json",
  ".gitignore",
  ".env.example",
];

function checkSecrets() {
  try {
    // Get staged files from git
    const stagedFiles = execSync("git diff --cached --name-only", {
      encoding: "utf8",
    })
      .split("\n")
      .filter(
        (file) =>
          file && !EXCLUDE_FILES.some((exclude) => file.includes(exclude)),
      );

    let foundSecrets = false;

    for (const file of stagedFiles) {
      try {
        const content = execSync(`cat "${file}"`, { encoding: "utf8" });

        for (const pattern of PATTERNS) {
          if (pattern.regex.test(content)) {
            console.error(
              `\x1b[31m[SECURITY ERROR]\x1b[0m Potensi \x1b[33m${pattern.name}\x1b[0m terdeteksi di file: \x1b[36m${file}\x1b[0m`,
            );
            console.error(
              `Silakan pindahkan nilai rahasia tersebut ke file \x1b[32m.env\x1b[0m lokal Anda.`,
            );
            foundSecrets = true;
          }
        }
      } catch (err) {
        // Skip binary files or files that can't be read
      }
    }

    if (foundSecrets) {
      console.error("\n\x1b[41m COMMIT DIBATALKAN UNTUK KEAMANAN \x1b[0m\n");
      process.exit(1);
    }

    console.log(
      "\x1b[32m[SECURITY CHECK]\x1b[0m Tidak ada data sensitif terdeteksi.",
    );
  } catch (error) {
    console.error("Gagal menjalankan pemeriksaan keamanan:", error);
    process.exit(0); // Don't block commits if git fails
  }
}

checkSecrets();

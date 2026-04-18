import { v2 as cloudinary } from "cloudinary";

// Cloudinary configuration is automatically picked up from CLOUDINARY_URL if available,
// or set manually via individual vars here.
cloudinary.config({
  cloud_name: Bun.env.CLOUDINARY_CLOUD_NAME,
  api_key: Bun.env.CLOUDINARY_API_KEY,
  api_secret: Bun.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export default cloudinary;

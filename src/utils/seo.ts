let cachedHtml = "";
let lastFetchedTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (Turbo Mode)

/**
 * Injects meta tags into an HTML template.
 */
export async function renderHtmlWithMeta(options: {
  url: string;
  title: string;
  description: string;
  image?: string;
  pageid?: string;
  preloadImages?: string[];
  preloadApis?: string[];
}) {
  try {
    const frontendUrl = Bun.env.FRONTEND_URL || "https://mypublicgold.id";
    const apiUrl =
      Bun.env.API_URL || "https://be-public-gold-indonesia.vercel.app";
    let html = cachedHtml;
    const now = Date.now();

    // Fetch and cache if empty or expired
    if (!html || now - lastFetchedTime > CACHE_TTL) {
      try {
        const response = await fetch(frontendUrl);
        if (response.ok) {
          html = await response.text();
          cachedHtml = html;
          lastFetchedTime = now;
        } else if (!html) {
          throw new Error(`Failed to fetch index.html: ${response.statusText}`);
        }
      } catch (error) {
        console.error("Failed to fetch base index.html from frontend:", error);
        if (!html)
          return "Error loading page template. Please try again later.";
      }
    }

    // 2. Prepare Preload Tags
    let preloadTags = "";

    // Preload Fonts (Critical for CLS)
    preloadTags += `<link rel="preload" href="https://fonts.gstatic.com/s/caveat/v18/Wn7xha5svzWvG2ER6V9Y9pAgf_o.woff2" as="font" type="font/woff2" crossorigin />\n`;

    // Preload Images (LCP)
    if (options.preloadImages) {
      options.preloadImages.forEach((img) => {
        preloadTags += `<link rel="preload" as="image" href="${img}" fetchpriority="high" />\n`;
      });
    }

    // Preload APIs (To break critical chain)
    if (options.preloadApis) {
      options.preloadApis.forEach((apiPath) => {
        // Construct full URL if relative
        const fullApiUrl = apiPath.startsWith("http")
          ? apiPath
          : `${apiUrl}${apiPath}`;
        preloadTags += `<link rel="preload" as="fetch" href="${fullApiUrl}" crossorigin="anonymous" />\n`;
      });
    }

    // 3. Prepare Meta Tags
    const metaTags = `
    <title>${options.title}</title>
    <meta name="description" content="${options.description}" />
    <meta property="og:title" content="${options.title}" />
    <meta property="og:description" content="${options.description}" />
    <meta property="og:url" content="${frontendUrl}${options.url}" />
    ${options.image ? `<meta property="og:image" content="${options.image}" />` : ""}
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${options.title}" />
    <meta name="twitter:description" content="${options.description}" />
    ${options.image ? `<meta name="twitter:image" content="${options.image}" />` : ""}
    `;

    // 4. Inject into <head>
    html = html.replace(/<title>[\s\S]*?<\/title>/gi, "");
    html = html.replace(/<meta[^>]*name=["']description["'][^>]*>/gi, "");
    html = html.replace(/<meta[^>]*property=["']og:[^>]*>/gi, "");
    html = html.replace(/<meta[^>]*name=["']twitter:[^>]*>/gi, "");
    html = html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, "");
    html = html.replace(
      "<head>",
      `<head>\n<link rel="canonical" href="${frontendUrl}${options.url}" />\n${preloadTags}${metaTags}`,
    );

    return html;
  } catch (error) {
    console.error("SEO Render Error:", error);
    return "Internal Server Error";
  }
}

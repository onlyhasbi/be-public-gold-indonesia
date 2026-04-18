let cachedHtml = "";
let lastFetchedTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Injects meta tags into an HTML template.
 */
export async function renderHtmlWithMeta(options: {
  url: string;
  title: string;
  description: string;
  image?: string;
  pageid?: string;
}) {
  try {
    const frontendUrl = Bun.env.FRONTEND_URL || "https://mypublicgold.id";
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

    // 2. Prepare Meta Tags
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

    // 3. Inject into <head>
    html = html.replace(/<title>[\s\S]*?<\/title>/gi, "");
    html = html.replace(/<meta[^>]*name=["']description["'][^>]*>/gi, "");
    html = html.replace(/<meta[^>]*property=["']og:[^>]*>/gi, "");
    html = html.replace(/<meta[^>]*name=["']twitter:[^>]*>/gi, "");
    html = html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, "");
    html = html.replace(
      "<head>",
      `<head>\n<link rel="canonical" href="${frontendUrl}${options.url}" />\n${metaTags}`,
    );

    return html;
  } catch (error) {
    console.error("SEO Render Error:", error);
    return "Internal Server Error";
  }
}

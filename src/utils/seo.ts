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
    // 1. Fetch base index.html from production frontend
    const frontendUrl = Bun.env.FRONTEND_URL || "https://mypublicgold.id";
    let html = "";
    
    try {
      const response = await fetch(frontendUrl);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
      html = await response.text();
    } catch (error) {
      console.error("Failed to fetch base index.html from frontend:", error);
      return "Error loading page template. Please try again later.";
    }

    // 2. Prepare Meta Tags
    const metaTags = `
    <title>${options.title}</title>
    <meta name="description" content="${options.description}" />
    <meta property="og:title" content="${options.title}" />
    <meta property="og:description" content="${options.description}" />
    ${options.image ? `<meta property="og:image" content="${options.image}" />` : ""}
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${options.title}" />
    <meta name="twitter:description" content="${options.description}" />
    ${options.image ? `<meta name="twitter:image" content="${options.image}" />` : ""}
    `;

    // 3. Inject into <head>
    html = html.replace(/<title>.*?<\/title>/gi, "");
    html = html.replace(/<meta name="description".*?>/gi, "");
    html = html.replace("<head>", `<head>${metaTags}`);

    return html;
  } catch (error) {
    console.error("SEO Render Error:", error);
    return "Internal Server Error";
  }
}

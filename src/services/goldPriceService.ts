import * as cheerio from "cheerio";
import { GoldPrice, GoldPricesResult } from "../types/gold.ts";

const PUBLIC_GOLD_URL = "https://publicgold.co.id/";

// Cache logic
let priceCache: { data: GoldPricesResult; timestamp: number } | null = null;
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export const fetchGoldPrices = async (): Promise<GoldPricesResult | null> => {
  const now = Date.now();
  if (priceCache && now - priceCache.timestamp < CACHE_TTL) {
    return priceCache.data;
  }

  try {
    const res = await fetch(PUBLIC_GOLD_URL, {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "max-age=0",
        Connection: "keep-alive",
        Cookie:
          "language=id; currency=IDR; _ga=GA1.1.270023591.1774490897; _fbp=fb.2.1774490897115.67458158652135436; PHPSESSID=8bjfp7mf1kc732dc5pjmh9ebd3; OCSESSID=b8ddc5c9df20cd45f6946dc45c; Path=/; _ga_QVVNQNTY87=GS2.1.s1776514308$o15$g1$t1776515213$j60$l0$h0",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36",
        "sec-ch-ua":
          '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Public Gold site: ${res.statusText}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // 1. Scraping POE Prices (GAP/Tabungan)
    const poe: GoldPrice[] = [];
    $(
      "a[href='https://my-cdn.publicgold.com.my/image/catalog/common/liveprice/langkahlangkahmembeligapv2.pdf']",
    ).each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes("=")) {
        const [price, label] = text.split("=");
        poe.push({
          label: label?.replace(/\s+/g, " ").trim() ?? "",
          price: price?.trim() ?? null,
        });
      }
    });

    // 2. Scraping Unit Prices (Dinar & Goldbar)
    const allUnitPrices: GoldPrice[] = [];
    $("#gold_price_col").each((_, el) => {
      const label = $(el).text().trim();
      const priceElement = $(el).next();
      const price = priceElement.text().trim() || null;
      if (label) {
        allUnitPrices.push({ label, price });
      }
    });

    const result = {
      poe,
      dinar: allUnitPrices.filter(
        (g) => g.label.includes("Dinar") || g.label.includes("Dirham"),
      ),
      goldbar: allUnitPrices.filter(
        (g) =>
          !g.label.includes("Dinar") &&
          !g.label.includes("Dirham") &&
          // Filter common non-gold items if any
          (g.label.includes("gram") || g.label.includes("Gram")),
      ),
    };

    // Update Cache
    priceCache = { data: result, timestamp: Date.now() };

    return result;
  } catch (error) {
    console.error("[GoldPriceService] Error scraping prices from HTML:", error);
    return null;
  }
};

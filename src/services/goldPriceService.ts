import * as cheerio from "cheerio";
import { GoldPrice, GoldPricesResult } from "../types/gold.ts";

const PUBLIC_GOLD_URL = "https://publicgold.co.id/index.php";

export const fetchGoldPrices = async (): Promise<GoldPricesResult | null> => {
  try {
    const res = await fetch(PUBLIC_GOLD_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
          label: label?.trim() ?? "",
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

    return {
      poe,
      dinar: allUnitPrices.filter(
        (g) => g.label.includes("Dinar") || g.label.includes("Dirham"),
      ),
      goldbar: allUnitPrices.filter(
        (g) => !g.label.includes("Dinar") && !g.label.includes("Dirham"),
      ),
    };
  } catch (error) {
    console.error("[GoldPriceService] Error scraping prices from HTML:", error);
    return null;
  }
};

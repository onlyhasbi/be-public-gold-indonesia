export interface GoldPrice {
  label: string;
  price: string | null;
}

export interface GoldPricesResult {
  poe: GoldPrice[];
  dinar: GoldPrice[];
  goldbar: GoldPrice[];
}

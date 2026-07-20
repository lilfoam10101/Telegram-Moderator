/** Curated US tickers shown by /stocks (not all markets). */
export const DEFAULT_STOCK_WATCHLIST = [
  { symbol: "AAPL", label: "Apple" },
  { symbol: "MSFT", label: "Microsoft" },
  { symbol: "AMZN", label: "Amazon" },
  { symbol: "META", label: "Meta" },
  { symbol: "QQQ", label: "Nasdaq 100" },
  { symbol: "SPY", label: "S&P 500" },
];

/**
 * Optional override via env:
 * STOCK_WATCHLIST=AAPL:Apple,MSFT:Microsoft,AMZN:Amazon,META:Meta,QQQ:Nasdaq 100,SPY:S&P 500
 */
export function getStockWatchlist() {
  const raw = process.env.STOCK_WATCHLIST?.trim();
  if (!raw) return DEFAULT_STOCK_WATCHLIST;

  const parsed = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const sep = part.indexOf(":");
      if (sep === -1) {
        return { symbol: part.toUpperCase(), label: part.toUpperCase() };
      }
      return {
        symbol: part.slice(0, sep).trim().toUpperCase(),
        label: part.slice(sep + 1).trim() || part.slice(0, sep).trim().toUpperCase(),
      };
    })
    .filter((item) => /^[A-Z.\-^]+$/.test(item.symbol));

  return parsed.length ? parsed : DEFAULT_STOCK_WATCHLIST;
}

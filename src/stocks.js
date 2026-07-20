import { getStockWatchlist } from "./stockWatchlist.js";

const CACHE_MS = Number(process.env.STOCK_CACHE_SECONDS || "30") * 1000;
const cache = { at: 0, payload: null };

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatChange(price, previousClose) {
  if (price == null || previousClose == null || previousClose === 0) return "—";
  const diff = price - previousClose;
  const pct = (diff / previousClose) * 100;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
}

function formatEtTime(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function inferMarketState(meta) {
  const now = Math.floor(Date.now() / 1000);
  const periods = meta?.currentTradingPeriod;
  if (!periods) {
    return { label: "US market", delayed: true };
  }

  if (periods.pre && now >= periods.pre.start && now < periods.pre.end) {
    return { label: "Pre-market", delayed: true };
  }
  if (periods.regular && now >= periods.regular.start && now < periods.regular.end) {
    return { label: "Market open", delayed: true };
  }
  if (periods.post && now >= periods.post.start && now < periods.post.end) {
    return { label: "After-hours", delayed: true };
  }
  return { label: "Market closed", delayed: false };
}

async function fetchQuote(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    "?interval=1d&range=1d";

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("No quote data");

  const price = meta.regularMarketPrice ?? meta.previousClose;
  const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? price;

  return {
    symbol: meta.symbol || symbol,
    price,
    previousClose,
    quoteTime: meta.regularMarketTime || null,
    market: inferMarketState(meta),
    currency: meta.currency || "USD",
  };
}

async function fetchAllQuotes(symbols) {
  return Promise.all(
    symbols.map(async (symbol) => {
      try {
        const quote = await fetchQuote(symbol);
        return { ...quote, ok: true };
      } catch (err) {
        console.warn(`Stock quote failed for ${symbol}:`, err.message);
        return { symbol, ok: false };
      }
    })
  );
}

export async function buildStocksMessage({ forceRefresh = false } = {}) {
  const ageMs = Date.now() - cache.at;
  if (!forceRefresh && cache.payload && ageMs < CACHE_MS) {
    return { ...cache.payload, fromCache: true, cacheAgeSec: Math.round(ageMs / 1000) };
  }

  const watchlist = getStockWatchlist();
  const symbols = watchlist.map((item) => item.symbol);
  let quotes;

  try {
    quotes = await fetchAllQuotes(symbols);
  } catch (err) {
    if (cache.payload) {
      return {
        ...cache.payload,
        fromCache: true,
        stale: true,
        cacheAgeSec: Math.round((Date.now() - cache.at) / 1000),
      };
    }
    throw err;
  }

  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  const lines = ["╭─ <b>US Market Watchlist</b> ───────╮"];

  let latestQuoteTime = null;
  let market = { label: "US market", delayed: true };

  for (let i = 0; i < watchlist.length; i++) {
    const item = watchlist[i];
    const q = quoteBySymbol.get(item.symbol);
    const last = i === watchlist.length - 1;
    const prefix = last ? "└" : "├";

    if (!q?.ok) {
      lines.push(
        `${prefix} <code>${escapeHtml(item.symbol)}</code>  ${escapeHtml(item.label)}  <i>unavailable</i>`
      );
      continue;
    }

    if (q.quoteTime && (!latestQuoteTime || q.quoteTime > latestQuoteTime)) {
      latestQuoteTime = q.quoteTime;
    }
    if (q.market?.label === "Market open") market = q.market;

    const change = formatChange(q.price, q.previousClose);
    const changeIcon = q.price >= q.previousClose ? "🟢" : "🔴";
    lines.push(
      `${prefix} <code>${escapeHtml(item.symbol)}</code>  ${escapeHtml(item.label)}  ` +
        `<b>${formatPrice(q.price)}</b>  ${changeIcon} ${escapeHtml(change)}`
    );
  }

  if (market.label === "US market") {
    const firstOk = quotes.find((q) => q.ok && q.market);
    if (firstOk?.market) market = firstOk.market;
  }

  const quoteLabel = formatEtTime(latestQuoteTime) || formatEtTime(Math.floor(Date.now() / 1000));
  const cacheSec = Math.round(CACHE_MS / 1000);

  lines.push("╰──────────────────────────────────╯");

  const footerParts = [
    market.label,
    market.delayed ? "Delayed ~15 min (Yahoo)" : "Last close",
    `Quote ${quoteLabel}`,
    `Refresh every ${cacheSec}s`,
  ];
  lines.push(`<i>${escapeHtml(footerParts.join(" · "))}</i>`);

  const payload = { text: lines.join("\n") };

  cache.at = Date.now();
  cache.payload = payload;
  return { ...payload, fromCache: false, cacheAgeSec: 0 };
}

async function handleStocks(ctx) {
  const ageMs = Date.now() - cache.at;
  const hasFreshCache = cache.payload && ageMs < CACHE_MS;
  const loading = hasFreshCache
    ? null
    : await ctx.reply("Fetching US stock prices…");

  try {
    const { text } = await buildStocksMessage();
    const watchlist = getStockWatchlist();
    const buttons = [];
    for (let i = 0; i < watchlist.length; i += 3) {
      buttons.push(
        watchlist.slice(i, i + 3).map((item) => ({
          text: item.symbol,
          url: `https://finance.yahoo.com/quote/${encodeURIComponent(item.symbol)}`,
        }))
      );
    }

    const opts = {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    };

    if (loading) {
      await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, text, opts);
    } else {
      await ctx.reply(text, opts);
    }
  } catch (err) {
    console.error("handleStocks failed:", err.message);
    const failText = "Could not fetch stock prices. Try again in a moment.";
    if (loading) {
      await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, failText);
    } else {
      await ctx.reply(failText);
    }
  }
}

export function registerStocksHandlers(bot) {
  bot.command("stocks", async (ctx) => {
    await handleStocks(ctx);
  });

  bot.on("channel_post", async (ctx, next) => {
    const text = ctx.channelPost?.text || "";
    if (!text.match(/^\/stocks(?:@[\w_]+)?(?:\s|$)/i)) return next();
    await handleStocks(ctx);
  });
}

import { env } from "../lib/env.js";

// The Example Search Agent must pull authentic sentences from real news, so we
// restrict Tavily to these domains only.
export const NEWS_DOMAINS = [
  "reuters.com",
  "bbc.com",
  "theguardian.com",
  "npr.org",
  "apnews.com",
];

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Search recent news for articles using the target word.
 * Uses Tavily's REST API directly (no SDK) — one POST, restricted to news.
 */
export async function searchNews(word: string): Promise<SearchResult[]> {
  if (!env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is not set — add it to backend/.env");
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query: `"${word}"`,
      search_depth: "advanced",
      include_domains: NEWS_DOMAINS,
      max_results: 8,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { results?: SearchResult[] };
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}

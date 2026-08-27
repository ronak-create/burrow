import { fetch } from "@tauri-apps/plugin-http";

/**
 * General web search (spec G).
 *
 * Distinct from paper search, which is free and keyless because four public
 * academic indexes exist. General web search has no such thing: every usable API
 * needs a key, and the alternative — scraping a search engine's HTML — is exactly
 * what this project already refused to do for Google Scholar. Consistency matters
 * more than one extra capability, so this is BYOK and simply stays dark until a
 * key exists, like every other optional feature (spec E).
 */

export interface WebResult {
  title: string;
  url: string;
  snippet: string | null;
}

export interface SearchProvider {
  id: string;
  label: string;
  keyUrl: string;
  search(opts: {
    apiKey: string;
    query: string;
    limit: number;
    signal?: AbortSignal;
  }): Promise<WebResult[]>;
}

function clean(s: string | null | undefined): string | null {
  // Several of these APIs mark query terms in snippets with HTML tags.
  const t = (s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return t ? t : null;
}

async function failure(label: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new Error(`${label} ${res.status}: ${body.slice(0, 300)}`);
}

const brave: SearchProvider = {
  id: "brave",
  label: "Brave Search",
  keyUrl: "https://brave.com/search/api/",

  async search({ apiKey, query, limit, signal }) {
    const url =
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}` +
      `&count=${limit}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", "x-subscription-token": apiKey },
      signal,
    });
    if (!res.ok) await failure("Brave Search", res);

    const json = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return (json.web?.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        title: clean(r.title) ?? "Untitled",
        url: r.url as string,
        snippet: clean(r.description),
      }));
  },
};

const tavily: SearchProvider = {
  id: "tavily",
  label: "Tavily",
  keyUrl: "https://app.tavily.com/",

  async search({ apiKey, query, limit, signal }) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal,
      body: JSON.stringify({ query, max_results: limit, search_depth: "basic" }),
    });
    if (!res.ok) await failure("Tavily", res);

    const json = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (json.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        title: clean(r.title) ?? "Untitled",
        url: r.url as string,
        snippet: clean(r.content),
      }));
  },
};

export const SEARCH_PROVIDERS: SearchProvider[] = [brave, tavily];

/** One result as a compact line for a tool result, matching formatPaper's shape. */
export function formatResult(r: WebResult): string {
  const bits = [r.title, `  ${r.url}`];
  if (r.snippet) bits.push(`  ${r.snippet.slice(0, 400)}${r.snippet.length > 400 ? "…" : ""}`);
  return bits.join("\n");
}

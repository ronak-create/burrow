import { fetch } from "@tauri-apps/plugin-http";

/**
 * Paper search (spec G).
 *
 * Four sources, all free and none needing a key, which is the point: research is
 * the core loop of this tool and it must not sit behind another BYOK step. They
 * are genuinely different corpora rather than mirrors — arXiv is preprints,
 * PubMed is biomedical, OpenAlex is the broad index, Semantic Scholar carries
 * abstracts and citation counts — so the caller picks, and "all" fans out.
 *
 * Google Scholar is deliberately absent. It has no official API and scraping it
 * violates its terms; for an open-source tool that is a liability, not a feature.
 * Anything Scholar-only, the user imports as a document.
 */

export type Source = "arxiv" | "openalex" | "semanticscholar" | "pubmed";

export interface Paper {
  title: string;
  authors: string[];
  year: string | null;
  abstract: string | null;
  url: string | null;
  venue: string | null;
  citations: number | null;
  source: Source;
}

/** Identify the app to the services, several of which ask politely for this. */
const UA = "Burrow/0.1 (research canvas; https://github.com/ronakcreate/burrow)";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "GET", headers: { accept: "application/json", "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

function clean(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
}

/* ---------------- arXiv ---------------- */

async function arxiv(query: string, limit: number): Promise<Paper[]> {
  const url =
    `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}` +
    `&start=0&max_results=${limit}&sortBy=relevance`;
  const res = await fetch(url, { method: "GET", headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} from arXiv`);
  const xml = await res.text();

  // arXiv returns Atom, not JSON. DOMParser is already in the webview, so this
  // needs no dependency — and an XML parser is the right tool for XML, versus
  // regexes that break on the first CDATA section.
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("arXiv returned malformed XML.");

  return [...doc.getElementsByTagName("entry")].map((e) => {
    const tag = (n: string) => clean(e.getElementsByTagName(n)[0]?.textContent);
    const published = tag("published");
    return {
      title: tag("title") ?? "Untitled",
      authors: [...e.getElementsByTagName("author")].map(
        (a) => clean(a.getElementsByTagName("name")[0]?.textContent) ?? "",
      ).filter(Boolean),
      year: published ? published.slice(0, 4) : null,
      abstract: tag("summary"),
      url: clean(e.getElementsByTagName("id")[0]?.textContent),
      venue: "arXiv",
      citations: null,
      source: "arxiv" as const,
    };
  });
}

/* ---------------- OpenAlex ---------------- */

interface OpenAlexWork {
  display_name?: string;
  publication_year?: number;
  doi?: string;
  cited_by_count?: number;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string } };
  abstract_inverted_index?: Record<string, number[]>;
}

/**
 * OpenAlex ships abstracts as an inverted index (word -> positions) rather than
 * text, for licensing reasons. Rebuilding it is the only way to get a readable
 * abstract out of the broadest free index there is.
 */
function deinvert(index: Record<string, number[]> | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) words[p] = word;
  }
  return clean(words.join(" "));
}

async function openalex(query: string, limit: number): Promise<Paper[]> {
  const url =
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}`;
  const json = await getJson<{ results?: OpenAlexWork[] }>(url);
  return (json.results ?? []).map((w) => ({
    title: clean(w.display_name) ?? "Untitled",
    authors: (w.authorships ?? [])
      .map((a) => clean(a.author?.display_name) ?? "")
      .filter(Boolean),
    year: w.publication_year ? String(w.publication_year) : null,
    abstract: deinvert(w.abstract_inverted_index),
    url: w.doi ?? null,
    venue: clean(w.primary_location?.source?.display_name),
    citations: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
    source: "openalex" as const,
  }));
}

/* ---------------- Semantic Scholar ---------------- */

interface S2Paper {
  title?: string;
  year?: number;
  abstract?: string;
  url?: string;
  venue?: string;
  citationCount?: number;
  authors?: Array<{ name?: string }>;
}

/**
 * Note: this endpoint rate-limits hard on the shared unauthenticated pool and
 * frequently answers 429. That is why the fan-out tolerates per-source failure
 * rather than aborting — a 429 here must cost the user three sources' worth of
 * results, not four. Adding a free Semantic Scholar key would lift the limit, but
 * it is not worth another BYOK step for one of four indexes.
 */
async function semanticScholar(query: string, limit: number): Promise<Paper[]> {
  const fields = "title,year,abstract,url,venue,citationCount,authors";
  const url =
    `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}` +
    `&limit=${limit}&fields=${fields}`;
  const json = await getJson<{ data?: S2Paper[] }>(url);
  return (json.data ?? []).map((p) => ({
    title: clean(p.title) ?? "Untitled",
    authors: (p.authors ?? []).map((a) => clean(a.name) ?? "").filter(Boolean),
    year: p.year ? String(p.year) : null,
    abstract: clean(p.abstract),
    url: p.url ?? null,
    venue: clean(p.venue),
    citations: typeof p.citationCount === "number" ? p.citationCount : null,
    source: "semanticscholar" as const,
  }));
}

/* ---------------- PubMed ---------------- */

async function pubmed(query: string, limit: number): Promise<Paper[]> {
  // Two calls by design: esearch returns ids, esummary turns ids into records.
  const search = await getJson<{ esearchresult?: { idlist?: string[] } }>(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json` +
      `&retmax=${limit}&term=${encodeURIComponent(query)}`,
  );
  const ids = search.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const summary = await getJson<{
    result?: Record<string, {
      title?: string;
      pubdate?: string;
      source?: string;
      authors?: Array<{ name?: string }>;
    }>;
  }>(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`,
  );

  const result = summary.result ?? {};
  return ids
    .filter((id) => result[id])
    .map((id) => {
      const r = result[id];
      return {
        title: clean(r.title) ?? "Untitled",
        authors: (r.authors ?? []).map((a) => clean(a.name) ?? "").filter(Boolean),
        year: clean(r.pubdate)?.slice(0, 4) ?? null,
        // esummary carries no abstract; fetching one per result would be a
        // request per paper. The link is enough to go deeper.
        abstract: null,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        venue: clean(r.source),
        citations: null,
        source: "pubmed" as const,
      };
    });
}

const FETCHERS: Record<Source, (q: string, n: number) => Promise<Paper[]>> = {
  arxiv,
  openalex,
  semanticscholar: semanticScholar,
  pubmed,
};

export const SOURCES: Source[] = ["arxiv", "openalex", "semanticscholar", "pubmed"];

/**
 * Search one source or all of them.
 *
 * Fanning out uses allSettled rather than all: these are four independent public
 * services, and one being rate-limited or down should degrade the result set
 * rather than fail the whole search. Which sources failed is reported back, so a
 * thin result set is never silently passed off as "not much has been written".
 */
export async function searchPapers(
  query: string,
  source: Source | "all",
  limit = 8,
): Promise<{ papers: Paper[]; failed: Array<{ source: Source; error: string }> }> {
  const chosen = source === "all" ? SOURCES : [source];
  const n = Math.max(1, Math.min(limit, 25));

  const settled = await Promise.allSettled(chosen.map((s) => FETCHERS[s](query, n)));

  const papers: Paper[] = [];
  const failed: Array<{ source: Source; error: string }> = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") papers.push(...r.value);
    else failed.push({ source: chosen[i], error: String(r.reason?.message ?? r.reason) });
  });

  // Same paper from two indexes is one paper. Title is the only key every source
  // reliably shares, so dedupe on a normalised form of it.
  const seen = new Set<string>();
  const unique = papers.filter((p) => {
    const key = p.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Citation counts are missing from two of the four sources, so a paper without
  // one sorts last rather than as though it had zero citations.
  unique.sort((a, b) => (b.citations ?? -1) - (a.citations ?? -1));
  return { papers: unique, failed };
}

/** One paper as a compact line for a tool result. */
export function formatPaper(p: Paper): string {
  const who = p.authors.length
    ? p.authors.length > 3
      ? `${p.authors.slice(0, 3).join(", ")} et al.`
      : p.authors.join(", ")
    : "Unknown authors";
  const bits = [
    `${p.title} (${p.year ?? "n.d."})`,
    `  ${who}`,
    `  ${[p.venue, p.citations !== null ? `${p.citations} citations` : null, p.source]
      .filter(Boolean)
      .join(" · ")}`,
  ];
  if (p.url) bits.push(`  ${p.url}`);
  if (p.abstract) bits.push(`  ${p.abstract.slice(0, 400)}${p.abstract.length > 400 ? "…" : ""}`);
  return bits.join("\n");
}

/**
 * Product Hunt AI products fetched via the GraphQL API.
 *
 * Strategy: fetch yesterday's top products (which have accumulated votes),
 * then filter locally for AI-related topics.
 */

import { createSourceStatus, type SourceStatus } from "./source-status.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhProduct {
  id: string;
  name: string;
  tagline: string;
  url: string; // Product Hunt URL
  website: string; // external website
  votesCount: number;
  commentsCount: number;
  createdAt: string;
  topics: string[];
}

export interface PhData {
  products: PhProduct[];
  fetchSuccess: boolean;
  status: SourceStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PH_TOP_PRODUCTS = 30;
const PH_FETCH_COUNT = 20; // PH API complexity limit caps this at ~20
const API_URL = "https://api.producthunt.com/v2/api/graphql";

/** AI-related topic slugs — products with any of these are included. */
const AI_TOPIC_SLUGS = new Set([
  "artificial-intelligence",
  "machine-learning",
  "ai",
  "chatgpt",
  "llm",
  "developer-tools",
  "open-source",
  "natural-language-processing",
  "chatbots",
  "generative-ai",
]);

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const POSTS_QUERY = `
  query GetPosts($first: Int!, $postedAfter: DateTime, $postedBefore: DateTime) {
    posts(first: $first, postedAfter: $postedAfter, postedBefore: $postedBefore, order: VOTES) {
      edges {
        node {
          id
          name
          tagline
          url
          website
          votesCount
          commentsCount
          createdAt
          topics {
            edges {
              node {
                slug
                name
              }
            }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

interface PhNode {
  id: string;
  name: string;
  tagline: string;
  url: string;
  website: string;
  votesCount: number;
  commentsCount: number;
  createdAt: string;
  topics?: { edges?: Array<{ node: { slug: string; name: string } }> };
}

interface PhResponse {
  data?: { posts?: { edges?: Array<{ node: PhNode }> } };
  errors?: Array<{ message: string }>;
}

function result(products: PhProduct[], fetchedCount: number, error?: string, skipped?: string): PhData {
  const status = createSourceStatus({
    id: "product-hunt",
    label: "Product Hunt",
    fetchedCount,
    acceptedCount: products.length,
    error,
    skipped,
  });
  return { products, fetchSuccess: status.state !== "error" && status.state !== "skipped", status };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchPhData(): Promise<PhData> {
  const token = process.env["PRODUCTHUNT_TOKEN"] ?? "";
  if (!token) {
    console.log("  [ph] PRODUCTHUNT_TOKEN not set — skipping.");
    return result([], 0, undefined, "PRODUCTHUNT_TOKEN not set");
  }

  // Fetch yesterday's products (they've had a full day to accumulate votes)
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "ai-topic-radar/1.0",
      },
      body: JSON.stringify({
        query: POSTS_QUERY,
        variables: {
          first: PH_FETCH_COUNT,
          postedAfter: twoDaysAgo.toISOString(),
          postedBefore: yesterday.toISOString(),
        },
      }),
    });

    if (!resp.ok) {
      console.error(`  [ph] HTTP ${resp.status}`);
      return result([], 0, `HTTP ${resp.status}`);
    }

    const json = (await resp.json()) as PhResponse;

    if (json.errors?.length) {
      console.error(`  [ph] API errors: ${json.errors.map((e) => e.message).join("; ")}`);
      return result([], 0, json.errors.map((e) => e.message).join("; "));
    }

    const edges = json.data?.posts?.edges;
    if (!Array.isArray(edges)) {
      console.error(`  [ph] unexpected response shape`);
      return result([], 0, "unexpected response shape");
    }

    const allProducts: PhProduct[] = [];
    for (const edge of edges) {
      const node = edge.node;
      const topicSlugs = node.topics?.edges?.map((e) => e.node.slug) ?? [];
      const topicNames = node.topics?.edges?.map((e) => e.node.name) ?? [];

      // Filter: keep only products with at least one AI-related topic
      const isAiRelated = topicSlugs.some((slug) => AI_TOPIC_SLUGS.has(slug));
      if (!isAiRelated) continue;

      allProducts.push({
        id: node.id,
        name: node.name,
        tagline: node.tagline,
        url: node.url,
        website: node.website || node.url,
        votesCount: node.votesCount,
        commentsCount: node.commentsCount,
        createdAt: node.createdAt,
        topics: topicNames,
      });
    }

    const products = allProducts.sort((a, b) => b.votesCount - a.votesCount).slice(0, PH_TOP_PRODUCTS);

    console.log(`  [ph] ${products.length} AI products (from ${edges.length} total)`);
    return result(products, edges.length);
  } catch (err) {
    console.error(`  [ph] fetch failed: ${err}`);
    return result([], 0, String(err));
  }
}

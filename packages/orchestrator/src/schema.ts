import { z } from 'zod';

// ============================================================
// Bright Data CLI Response Types
// ============================================================

export const CollectorInfoSchema = z.object({
  collector_id: z.string().startsWith('c_'),
  name: z.string(),
  status: z.enum(['ready', 'building', 'done', 'failed']),
  input_schema: z.record(z.unknown()).optional(),
  output_schema: z.record(z.unknown()).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type CollectorInfo = z.infer<typeof CollectorInfoSchema>;

export const ScrapeResultSchema = z.object({
  url: z.string(),
  // The actual data varies by collector - we accept any object
  data: z.record(z.unknown()).array().optional(),
  // Alternative: some commands return array directly
  items: z.array(z.record(z.unknown())).optional(),
  // Error info
  error: z.string().optional(),
  status: z.enum(['success', 'error', 'building']).optional(),
});

export type ScrapeResult = z.infer<typeof ScrapeResultSchema>;

export const HealResultSchema = z.object({
  status: z.enum(['awaiting_approval', 'approved', 'rejected', 'done', 'failed']),
  preview_result: z.record(z.unknown()).optional(),
  diff: z.string().optional(),
  message: z.string().optional(),
  collector_id: z.string().optional(),
});

export type HealResult = z.infer<typeof HealResultSchema>;

export const ScrapeHtmlResultSchema = z.object({
  html: z.string(),
  url: z.string(),
});

export type ScrapeHtmlResult = z.infer<typeof ScrapeHtmlResultSchema>;

// ============================================================
// Internal Domain Types
// ============================================================

export const HealthMetricsSchema = z.object({
  collectorId: z.string(),
  url: z.string(),
  timestamp: z.string(),
  matchRate: z.number().min(0).max(1),
  nullRate: z.number().min(0).max(1),
  fieldStats: z.record(z.object({
    present: z.number(),
    null: z.number(),
    type: z.string(),
  })),
  rowCount: z.number(),
  latencyMs: z.number(),
});

export type HealthMetrics = z.infer<typeof HealthMetricsSchema>;

export const CollectorConfigSchema = z.object({
  id: z.string(), // our internal ID
  collectorId: z.string(), // Bright Data collector ID or pipeline type
  name: z.string(),
  targetUrl: z.string().url(),
  description: z.string(),
  expectedFields: z.array(z.string()),
  // Optional: custom breakage thresholds
  thresholds: z.object({
    matchRate: z.number().min(0).max(1).default(0.8),
    nullRate: z.number().min(0).max(1).default(0.3),
    minRowCount: z.number().default(1),
  }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CollectorConfig = z.infer<typeof CollectorConfigSchema>;

export const HealEventSchema = z.object({
  id: z.string(),
  collectorId: z.string(),
  timestamp: z.string(),
  trigger: z.enum(['monitor', 'manual', 'scheduled']),
  prompt: z.string(),
  status: z.enum(['started', 'healing', 'verifying', 'success', 'failed']),
  diff: z.string().optional(),
  oldDomHash: z.string().optional(),
  newDomHash: z.string().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
});

export type HealEvent = z.infer<typeof HealEventSchema>;

export const MonitorEventSchema = z.object({
  id: z.string(),
  collectorId: z.string(),
  timestamp: z.string(),
  type: z.enum(['run_started', 'run_completed', 'breakage_detected', 'health_check']),
  health: HealthMetricsSchema.optional(),
  message: z.string().optional(),
});

export type MonitorEvent = z.infer<typeof MonitorEventSchema>;

export type AppEvent = MonitorEvent | HealEvent;

// ============================================================
// LLM Prompt/Response Types
// ============================================================

export const DomDiffSchema = z.object({
  changedSelectors: z.array(z.object({
    field: z.string(),
    oldSelector: z.string().optional(),
    newSelector: z.string().optional(),
    oldContext: z.string(),
    newContext: z.string(),
  })),
  addedFields: z.array(z.string()),
  removedFields: z.array(z.string()),
  summary: z.string(),
});

export type DomDiff = z.infer<typeof DomDiffSchema>;

export const HealPromptSchema = z.object({
  prompt: z.string(),
  targetField: z.string().optional(),
});

export type HealPrompt = z.infer<typeof HealPromptSchema>;

// ============================================================
// Default Collector Configurations (News Domain)
// ============================================================

// Using Bright Data pre-built pipelines for reliable data
// These don't need custom collector IDs - they're pipeline types
// For demo purposes, we use mock collector IDs (c_mock_*) so the health checks simulate data
export const PIPELINE_TYPES = {
  'github-trending': 'github_repository_file', // Extract repo data from GitHub
  'reddit-programming': 'reddit_posts',        // Extract posts from Reddit
  'youtube-tech': 'youtube_videos',            // Extract videos from YouTube
  'hacker-news': 'reuter_news',                // Reuter news (closest to tech news)
  'product-hunt': 'crunchbase_company',        // Crunchbase for product/company data
};

// Real Bright Data custom collector IDs (created via platform) — override pipelines.
// These support the full heal flow via `bdata scraper heal <c_...>`.
export const REAL_COLLECTOR_IDS: Record<string, string> = {
  'github-trending': 'c_mt44zx3pe1tu4vwfu',
  'hacker-news': 'c_mt4505zh150yngjen6',
  'product-hunt': 'c_mt450hof2ol3sohpl9',
  'youtube-tech': 'c_mt450rnd70zjnaa97',
  'reddit-programming': 'c_mt4511ve2f1ybfik7u',
};

export const DEFAULT_COLLECTORS: Omit<CollectorConfig, 'id' | 'collectorId' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'github-trending',
    targetUrl: 'https://github.com/microsoft/vscode',
    description: 'Extract GitHub repository: name, description, stars, forks, language, license',
    expectedFields: ['name', 'description', 'stars', 'forks', 'language', 'license'],
  },
  {
    name: 'reddit-programming',
    targetUrl: 'https://www.reddit.com/r/programming',
    description: 'Extract Reddit posts: title, url, score, author, comments, subreddit',
    expectedFields: ['title', 'url', 'score', 'author', 'num_comments', 'subreddit'],
  },
  {
    name: 'youtube-tech',
    targetUrl: 'https://www.youtube.com/@fireship',
    description: 'Extract YouTube videos: title, views, likes, comments, published',
    expectedFields: ['title', 'view_count', 'like_count', 'comment_count', 'published_at'],
  },
  {
    name: 'hacker-news',
    targetUrl: 'https://news.ycombinator.com',
    description: 'Extract front page posts with fields: title, url, points, author, comments, rank',
    expectedFields: ['title', 'url', 'points', 'author', 'comments', 'rank'],
  },
  {
    name: 'product-hunt',
    targetUrl: 'https://www.producthunt.com',
    description: 'Extract product launches with fields: name, tagline, votes, url, category',
    expectedFields: ['name', 'tagline', 'votes', 'url', 'category'],
  },
];
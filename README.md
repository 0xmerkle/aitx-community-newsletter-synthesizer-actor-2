# AITX Newsletter Synthesizer

An [Apify Actor](https://apify.com/actors) that filters scraped content using Claude AI, enriches events, and generates a publication-ready newsletter draft for the [AITX Community](https://aitx.beehiiv.com).

## What it does

Takes a Dataset of articles and events from the [Newsletter Digest Scraper](https://github.com/0xmerkle/aitx-community-newsletter-digest-actor-1) and:

1. **Filters articles** with Claude Sonnet 4.5 for Texas + AI relevance (25+ articles → 3-5)
2. **Filters events** with the same relevance scoring (40+ events → ~8)
3. **Enriches Lu.ma events** via the individual event API for full descriptions
4. **Summarizes** event descriptions using Claude Haiku (Lu.ma stores descriptions as structured JSON)
5. **Queries Notion** for community highlights and initiatives
6. **Generates** story summaries and "why it matters" sections
7. **Saves** a formatted draft to a Notion database

## Pipeline

This Actor is the second half of a two-Actor pipeline, triggered by a webhook when the [Digest Scraper](https://github.com/0xmerkle/aitx-community-newsletter-digest-actor-1) completes.

    Actor 1                      Actor 2 (this repo)
    ┌──────────────────┐         ┌──────────────────────┐
    │ Scrape RSS       │         │ Filter with Claude AI │
    │ Fetch Lu.ma API  │──webhook──▶│ Enrich Lu.ma events  │
    │ Call Meetup Actor │         │ Query Notion          │
    │ Normalize + push │         │ Generate draft        │
    └──────────────────┘         └──────────────────────┘

## Input

| Field | Type | Description |
|-------|------|-------------|
| `datasetId` | string | Dataset ID from Actor 1 (passed via webhook) |
| `topStoriesCount` | number | Number of top stories to include (default: 3) |

## Checkpoint system

The pipeline saves progress to Apify's Key-Value Store after each step using the `PIPELINE_STATE` key. If a run fails mid-execution (Notion timeout, API rate limit, etc.), use Apify's resurrection feature to restart — the Actor reads its checkpoint and resumes from the last completed step. Checkpoints are cleared on successful completion.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude Sonnet 4.5 and Haiku |
| `NOTION_API_KEY` | Yes | Notion integration token for reading community content and saving drafts |

Set these in the Apify Console under Actor → Settings → Environment variables.

## Output

The newsletter draft is saved to:
- **Key-Value Store**: `PIPELINE_STATE` (intermediate checkpoints)
- **Notion database**: A formatted draft page with markdown blocks ready for beehiiv

## Local development

```bash
npm install
cp .env.example .env    # Add your API keys
npm run start:dev       # Run locally with Apify CLI
npm run build           # TypeScript compile check
```

## Deployment

Connected to Apify via GitHub integration. Every push to `main` triggers an automatic build and deploy.

## Related

- **Actor 1:** [aitx-community-newsletter-digest-actor-1](https://github.com/0xmerkle/aitx-community-newsletter-digest-actor-1) — Scrapes RSS, Lu.ma, and Meetup sources
- **Blog post:** [How I built a two-Actor newsletter pipeline that saves me 3 hours every week](LINK_TO_BLOG_POST)

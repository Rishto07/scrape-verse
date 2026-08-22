<div align="center">

<img src="docs/logo.png" width="180" alt="Scrape-Verse logo"/>

# Scrape-Verse

**Autonomous Self-Healing Web Scraper Platform**

*Detect. Diagnose. Heal. Verify. — No human in the loop.*

**WeMakeDevs "Into the Scrape-Verse" Hackathon Entry** · Aug 17–23, 2026

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![Bright Data](https://img.shields.io/badge/Bright%20Data-Scraper%20APIs-0a84ff)](https://brightdata.com)
[![Groq](https://img.shields.io/badge/Groq-LLM%20Diagnosis-f55036)](https://groq.com)
[![Tests](https://img.shields.io/badge/tests-9%2F9-success)](https://vitest.dev)

</div>

---

## 🎯 The Problem

Web scrapers break **silently**. A site redesigns its layout at 2 AM, and by morning your data pipeline returns nulls — and nobody notices until downstream systems are poisoned with bad data.

## 💡 The Solution

Scrape-Verse is a platform where scrapers **fix themselves**:

```
Run collectors on a schedule → compute field-level health → detect breakage
→ fetch live DOM + diff against last known-good snapshot
→ Groq LLM writes a precise repair instruction from the structural diff
→ Bright Data heals the scraper (auto-approved) → re-run to verify recovery
→ healed page becomes the new known-good baseline
```

The entire loop closes autonomously. Humans watch the dashboard; the machines do the fixing.

---

## 🏆 Live Results (at submission time)

Real collectors running against real infrastructure via Bright Data's Scraper APIs:

| Collector | Target | Match Rate | Status |
|-----------|--------|:---:|--------|
| github-trending | `github.com/microsoft/vscode` | **100%** | 🟢 Healthy |
| product-hunt | `producthunt.com` | **89–95%** | 🟢 Healthy |
| reddit-programming | `reddit.com/r/programming` | recovering | 🩹 Healing (crawler rate-limits) |
| hacker-news | `news.ycombinator.com` | recovering | 🩹 Healing (rate-limits) |
| youtube-tech | `youtube.com/@fireship` | recovering | 🩹 Healing (bot-wall navigation) |

> Rate-limit-induced breakages are **the honest real-world condition** this platform exists to solve — the red cards you'll see in the demo are Scrape-Verse detecting exactly what it was built to fix, then attempting autonomous repair with cooldown protection.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│              SCHEDULER  (cron: */30s realtime / 15min prod)          │
└─────────────────────────────────┬───────────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (Node.js + TypeScript, port :3001)                     │
│                                                                      │
│  ┌───────────────┐   ┌────────────────┐   ┌───────────────────┐     │
│  │  MONITOR      │──▶│  DIAGNOSE      │──▶│  HEAL             │     │
│  │  • run        │   │  • fetch live  │   │  • auto-approved  │     │
│  │    collectors │   │    DOM         │   │    Bright Data    │     │
│  │  • match/null │   │  • structural  │   │    heal           │     │
│  │    thresholds │   │    diff vs     │   │  • re-run verify  │     │
│  │  • breakage   │   │    snapshot    │   │  • snapshot       │     │
│  │    detection  │   │  • Groq prompt │   │    refresh        │     │
│  └───────────────┘   └────────────────┘   └───────────────────┘     │
│          • heal cooldowns (10 min) • retry w/ backoff                │
└─────────────────────────────────┬───────────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DATA STORE (SQLite via sql.js + file snapshots)                     │
│  • collector registry (IDs, URLs, expected schemas)                  │
│  • DOM snapshots (known-good HTML per collector)                     │
│  • health history (matchRate, nullRate, fieldStats)                  │
│  • heal events (prompt, diff, old/new DOM hashes, duration)          │
└─────────────────────────────────┬───────────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  REAL-TIME DASHBOARD (React + Vite + WebSocket, port :5173)              │
│  • collector health grid • live event feed • DOM diff viewer            │
│  • schema evolution timeline • demo controls (trigger/prime/simulate)   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features

### 1. Autonomous Self-Healing Loop
1. **Monitor** — runs every collector, computes match rate / null rate / per-field presence stats
2. **Detect** — breakage when `matchRate < 80%` or `nullRate > 30%` or `rowCount < 1`
3. **Diagnose** — fetches current page HTML, parses it with a dependency-free structural analyzer, diffs element paths/selectors/attributes against the stored known-good snapshot, and identifies which expected fields moved or vanished
4. **LLM Repair Prompt** — the structured diff goes to Groq (`openai/gpt-oss-120b`), producing one precise plain-language instruction referencing the new DOM's exact tags/classes/hierarchy
5. **Heal** — `brightdata scraper heal --auto-approve` executes the repair; the orchestrator polls to completion (up to 30 min)
6. **Verify** — re-runs the collector and requires previously-broken fields to be present & non-null before declaring success
7. **Baseline Update** — the healed page is saved as the new known-good snapshot for future diffs

### 2. Production-Grade Resilience (built during the hack, battle-tested live)
| Protection | What it does |
|------------|--------------|
| **HTTP/1.1 fetch shim** | Node ≥24 negotiates HTTP/2 with Bright Data's API and valid unlocker responses die mid-stream (`NGHTTP2_PROTOCOL_ERROR`). Injected into every CLI child process via `NODE_OPTIONS --require` — fixed hours of phantom network failures. |
| **Transient-error retries** | Bounded retries with backoff on timeouts / connection resets / H2 stream errors |
| **Heal cooldowns** | Max one heal attempt per collector per 10 min — protects credits from burn-loops when breakage stems from transient crawler rate-limits rather than real layout changes |
| **Corrupt-row guards** | Malformed DB rows can never crash the API layer |
| **Per-collector error containment** | One broken target never blocks the others |

### 3. Field-Level Health Intelligence
Every run records per-field presence/null/type statistics — so you know *exactly which field* broke, not just "it broke."

### 4. Real-Time Dashboard
Glassmorphic dark UI with live WebSocket updates: health grid, event stream, side-by-side DOM diff viewer, schema evolution timeline, and one-click demo controls.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 20+**
- **Bright Data account** — free credits available; hackathon code `wemakedevs` at [brdta.com/wemakedevs](https://brdta.com/wemakedevs)
- **Groq API key** — free at [console.groq.com](https://console.groq.com)

### Install

```bash
git clone https://github.com/<you>/scrape-verse.git
cd scrape-verse
npm install

# configure
cp .env.example .env
# fill in BRIGHTDATA_API_KEY and GROQ_API_KEY
# authenticate the CLI once (stores credentials):
npx -p @brightdata/cli bdata login
```

### Run

```bash
npm run dev        # orchestrator (:3001) + dashboard (:5173)
```

Open **http://localhost:5173** — collectors register automatically, snapshots bootstrap, and the loop begins.

### Demo Mode

Set `MOCK_MODE=true` to run the identical lifecycle against simulated collectors (zero Bright Data usage). Breakages occur naturally (~25% of checks) or force one:

```powershell
Invoke-RestMethod -Method POST "http://localhost:3001/api/trigger/<collectorId>?simulate=true"
```

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIGHTDATA_API_KEY` | — | Bright Data API token (or use `bdata login`) |
| `GROQ_API_KEY` | — | Groq key for LLM diagnosis (**required**) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Any active Groq chat model |
| `PORT` | `3001` | Orchestrator HTTP/WebSocket port |
| `CRON_SCHEDULE` | `*/15 * * * *` | Monitor cadence (production) |
| `REALTIME_MODE` | `false` | `true` = monitor every 30 seconds (demo) |
| `MOCK_MODE` | `false` | `true` = simulated collectors, full lifecycle without Bright Data |

---

## 📁 Project Structure

```
scrape-verse/
├── docs/logo.png                    # brand asset
├── packages/
│   ├── orchestrator/src/
│   │   ├── index.ts                 # entry: scheduler + REST API + WebSocket bridge
│   │   ├── brightdata.ts            # CLI wrapper: run/heal/create/scrape + HTTP1 shim + retries
│   │   ├── monitor.ts               # health metrics + threshold-based breakage detection
│   │   ├── diagnose.ts              # dependency-free DOM parser + structural diff engine
│   │   ├── llm.ts                   # Groq client → heal-prompt generation
│   │   ├── heal.ts                  # verified auto-heal loop + cooldowns
│   │   ├── store.ts                 # SQLite persistence + snapshot files
│   │   ├── schema.ts                # Zod contracts + collector registry defaults
│   │   ├── events.ts               # event bus → socket.io fan-out
│   │   └── diagnose.test.ts         # vitest suite for the diff engine
│   └── dashboard/
│       ├── public/logo.png
│       └── src/…                    # React UI (health grid, event feed, diff viewer,
│                                    #  schema timeline, custom dropdown demo controls)
└── .env.example
```

---

## 🔍 Engineering Notes (what we fought to make this work)

These are real production lessons discovered while running live:

1. **HTTP/2 vs Bright Data**: valid unlocker responses streamed over HTTP/2 died with `ERR_HTTP2_STREAM_ERROR`, while error-path responses succeeded — masking the bug for hours. Fixed by forcing HTTP/1.1 inside every CLI child.
2. **CLI output shapes drift**: `scraper run` prints progress lines followed by a bare JSON array; `scrape -f html` may return a bare JSON *string*; heal output varies by version. The wrapper now tolerates all shapes.
3. **Env-var credential precedence**: a stale `BRIGHTDATA_API_KEY` env var silently overrides `bdata login` credentials — diagnosed by bisecting the CLI's own source.
4. **Rate limits ≠ breakage**: crawler throttling produces null-field rows that look identical to layout changes. Cooldowns distinguish "healable" from "wait-and-retry."

---

## 📊 Judging Criteria Coverage

| Criterion | How We Hit It |
|-----------|---------------|
| **Bright Data Scraper Studio Use** | All 5 collectors created/run/healed through Bright Data APIs & CLI; IDs surfaced in dashboard; HTML scraping for snapshots |
| **Self-Healing** | The entire product *is* the heal loop — LLM-generated prompts drive Bright Data's AI repair autonomously |
| **Technical Excellence** | Strict TypeScript, Zod contracts, vitest coverage of the diff engine, resilient CLI wrapper, verification-gated heals |
| **Impact** | Silent scraper death is a universal pain — Scrape-Verse turns it into an autonomous, auditable lifecycle |
| **Creativity** | Structural DOM-diff → natural-language repair prompt → auto-approved heal: a novel composition of Bright Data primitives + LLM reasoning |
| **Presentation** | Live glassmorphic dashboard shows breakage → healing → recovery in real time |

---

## 🛣️ Roadmap (post-hackathon)

- [ ] API authentication + restrictive CORS
- [ ] Postgres/better-sqlite3 for durable concurrent storage
- [ ] Global credit budget guard + spend circuit-breaker
- [ ] Structured logging & metrics export
- [ ] Docker Compose deployment
- [ ] Slack/email alerting on failed-heal streaks

---

## 🙏 Acknowledgements

- [Bright Data](https://brightdata.com) — Scraper APIs & self-healing infrastructure
- [Groq](https://groq.com) — blazing-fast LLM inference
- [WeMakeDevs](https://wemakedevs.org) — hosting the Into the Scrape-Verse hackathon

---

## License

MIT

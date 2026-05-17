# TenantCore — Multi-Tenant SaaS Infrastructure Platform

> **Production-grade backend engine** for B2B SaaS applications. Handles tenant isolation, JWT authentication, RBAC, real-time systems, background jobs, file management, monitoring, and more.

[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.0-green)](https://mongodb.com)
[![Redis](https://img.shields.io/badge/Redis-7.2-red)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## 🚀 One-Command Setup

```bash
# Copy environment file
cp .env.example .env

# Start the entire platform
docker-compose up -d
```

The platform will be available at:

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| API Docs (Swagger) | http://localhost:3000/api/docs |
| Admin Dashboard | http://localhost:5173 |
| Grafana | http://localhost:3001 |
| Prometheus | http://localhost:9090 |
| Jaeger Tracing | http://localhost:16686 |
| MinIO Console | http://localhost:9001 |
| Meilisearch | http://localhost:7700 |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Nginx (Port 80/443)                      │
│              techcorp.tenantcore.com → X-Tenant-Slug             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                    Express API Server (Port 3000)                 │
│                                                                   │
│   Middleware Pipeline:                                            │
│   extractTenant → validateTenant → authenticate →                 │
│   injectContext → rateLimit → quotaCheck → auditLog → tracing    │
└───────┬───────────────────┬──────────────────────────────────────┘
        │                   │
┌───────▼──────┐   ┌────────▼────────┐
│   MongoDB    │   │     Redis        │
│  Master DB   │   │  Cache + Queue   │
│ + Tenant DBs │   │  + Rate Limits   │
└──────────────┘   └─────────────────┘
        │
┌───────▼────────────────────────────────────────────────────────┐
│                Background Worker Processes                       │
│   EmailWorker | ReportWorker | CleanupWorker | Cron Jobs        │
└────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
tenantcore/
├── apps/
│   ├── api/                    # Express API server
│   │   └── src/
│   │       ├── api/v1/         # REST routes
│   │       ├── middleware/     # Auth, RBAC, rate limiting, etc.
│   │       ├── services/       # Business logic
│   │       ├── models/         # Mongoose schemas
│   │       ├── core/           # EventBus, errors, DSL
│   │       ├── realtime/       # Socket.io
│   │       ├── db/             # Connection management
│   │       └── config/         # App configuration
│   ├── workers/                # Background jobs + cron
│   └── dashboard/              # React admin dashboard
├── packages/
│   ├── queue-engine/           # Custom Redis job queue
│   └── sdk/                    # Internal JS SDK
├── infra/
│   ├── nginx/                  # Reverse proxy config
│   ├── prometheus/             # Metrics collection
│   ├── grafana/                # Dashboards
│   └── loki/                   # Log aggregation
├── docs/                       # Architecture docs
├── docker-compose.yml          # Full stack
└── docker-compose.dev.yml      # Development stack
```

---

## 🔑 Features (40 total)

### Tier 1 — Core SaaS
| # | Feature | Status |
|---|---|---|
| 1 | Tenant Workspaces (subdomain isolation) | ✅ |
| 2 | JWT Authentication (access + refresh tokens) | ✅ |
| 3 | RBAC with custom roles | ✅ |
| 4 | Tenant isolation middleware pipeline | ✅ |
| 5 | API Key system (SHA-256, scoped) | ✅ |
| 6 | Redis sliding window rate limiting | ✅ |
| 7 | Immutable audit logs | ✅ |
| 8 | Redis job queue engine | ✅ |
| 9 | File upload via pre-signed URLs (MinIO) | ✅ |
| 10 | In-app + email notifications | ✅ |

### Tier 2 — Advanced Backend
| # | Feature | Status |
|---|---|---|
| 11 | Dynamic tenant provisioning pipeline | ✅ |
| 12 | Background workers with concurrency | ✅ |
| 13 | Distributed cron with lock | ✅ |
| 14 | EventBus (event-driven architecture) | ✅ |
| 15 | WebSocket real-time system | ✅ |
| 16 | Redis caching layer (cache-aside) | ✅ |
| 17 | Meilisearch per-tenant search | ✅ |
| 18 | CSV/JSON/PDF export system | ✅ |
| 19 | Admin platform dashboard | ✅ |
| 20 | Quota engine with threshold events | ✅ |

### Tier 3 — Production Grade
| # | Feature | Status |
|---|---|---|
| 21 | Structured logging (Winston + Loki) | ✅ |
| 22 | Prometheus + Grafana metrics | ✅ |
| 23 | OpenTelemetry + Jaeger tracing | ✅ |
| 24 | Health check endpoints (liveness/readiness) | ✅ |
| 25 | Centralized config system | ✅ |
| 26 | Dead Letter Queue + retry | ✅ |
| 27 | Worker autoscaling simulation | ✅ |
| 28 | Feature flags (per tenant/plan/user) | ✅ |
| 29 | API versioning (v1/v2) | ✅ |
| 30 | Soft delete + recovery | ✅ |

### Tier 4 — Elite Engineering
| # | Feature | Status |
|---|---|---|
| 31 | Multi-DB strategy (shared/isolated/dedicated) | ✅ |
| 32 | Tenant migration engine | ✅ |
| 33 | Plugin architecture | ✅ |
| 34 | Internal SDK | ✅ |
| 35 | Permission DSL (can/cannot) | ✅ |
| 36 | Policy engine | ✅ |
| 37 | Real-time activity feed | ✅ |
| 38 | Nginx reverse proxy | ✅ |
| 39 | Full Docker Compose infrastructure | ✅ |
| 40 | Documentation | ✅ |

---

## 🔐 Authentication

```bash
# Signup + provision tenant
POST /api/v1/auth/signup
{
  "email": "alice@techcorp.com",
  "password": "SecurePass@123",
  "firstName": "Alice",
  "lastName": "Smith",
  "tenantName": "TechCorp"
}

# Login
POST /api/v1/auth/login
Authorization: X-Tenant-Slug: techcorp

# Refresh token
POST /api/v1/auth/refresh
{ "refreshToken": "..." }

# Logout (blacklists token)
POST /api/v1/auth/logout
Authorization: Bearer <access_token>
```

---

## ⚡ API Key Authentication

```bash
# Create API key
POST /api/v1/apikeys
Authorization: Bearer <jwt>
{ "name": "CI Pipeline", "scopes": ["users:read", "files:upload"] }
# → Returns rawKey (shown ONCE): tc_live_a3f2...

# Use API key
GET /api/v1/users
X-API-Key: tc_live_a3f2...
```

---

## 🌐 Tenant Subdomain Routing

```
techcorp.tenantcore.com/api/v1/users     → TechCorp's users
acme.tenantcore.com/api/v1/users         → Acme's users (isolated)
```

---

## 📊 Subscription Plans

| Feature | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| API Requests/month | 10K | 100K | 1M | Unlimited |
| Storage | 1 GB | 10 GB | 100 GB | Custom |
| Users | 3 | 10 | 100 | Custom |
| API Keys | 2 | 10 | ∞ | ∞ |
| Rate Limit/min | 100 | 500 | 2,000 | 10,000 |

---

## 🛠️ Local Development

```bash
# Prerequisites: Node.js 20+, Docker

# 1. Clone and install
git clone <repo>
cd tenantcore
cp .env.example .env
npm install

# 2. Start infrastructure only
docker-compose -f docker-compose.dev.yml up -d

# 3. Start API in watch mode
npm run dev:api

# 4. Start workers
npm run dev:workers
```

---

## 🔧 Environment Variables

See [.env.example](.env.example) for the complete reference.

Key variables:
- `MONGODB_MASTER_URI` — Master database connection string
- `REDIS_HOST` / `REDIS_PORT` — Redis connection
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — JWT signing secrets (64+ chars)
- `MINIO_*` — Object storage configuration
- `SMTP_*` — Email delivery settings

---

## 📡 API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | /api/v1/auth/signup | Create account + provision tenant |
| POST | /api/v1/auth/login | Authenticate |
| POST | /api/v1/auth/refresh | Rotate tokens |
| POST | /api/v1/auth/logout | Invalidate tokens |
| GET | /api/v1/auth/me | Current user info |
| GET | /api/v1/users | List tenant users |
| POST | /api/v1/users | Invite user |
| GET | /api/v1/roles | List roles |
| POST | /api/v1/roles | Create custom role |
| GET | /api/v1/apikeys | List API keys |
| POST | /api/v1/apikeys | Create API key |
| POST | /api/v1/files/upload-url | Get upload URL |
| POST | /api/v1/files/:id/confirm | Confirm upload |
| GET | /api/v1/search?q= | Full-text search |
| GET | /api/v1/audit | Query audit logs |
| GET | /api/v1/quota | Quota usage |
| GET | /health | Liveness check |
| GET | /readiness | Readiness check |
| GET | /metrics | Prometheus metrics |

Full interactive docs: **http://localhost:3000/api/docs**

---

*TenantCore — Built to production standards. Resume-defining. Enterprise-grade.*

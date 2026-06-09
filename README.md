# tenantcore
TenantCore is a production-grade Multi-Tenant SaaS Backend built with the MERN stack. Features 40+ capabilities across tenant isolation, JWT auth, Stripe billing, role-based access, Redis caching, WebSockets, distributed job queues, OpenTelemetry tracing, and Prometheus/Grafana observability — engineered for scale.


# TenantCore

> Production-grade multi-tenant SaaS backend — Node.js, Express, MongoDB, Redis, Docker.

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express)](https://expressjs.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb&logoColor=white)](https://mongodb.com)
[![Redis](https://img.shields.io/badge/Redis-7.x-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-blue)](#license)

---

## What is TenantCore?

TenantCore is a **40-feature multi-tenant SaaS backend** built to production standards. It covers the full infrastructure surface of a real SaaS product — tenant isolation, billing, search, observability, webhooks, and more — without cutting corners on any layer.

Built as a portfolio project to demonstrate backend engineering depth across distributed systems, security, and DevOps practices.

---

## Feature Overview

### 🏢 Core SaaS
| Feature | Details |
|---|---|
| Multi-tenancy | Per-tenant data isolation via MongoDB tenant scoping |
| Auth (JWT + OAuth 2.0) | Access/refresh token rotation, Google OAuth |
| Role-Based Access Control | Roles per tenant with granular permissions |
| Tenant Onboarding | Automated setup pipeline on registration |
| User Management | Invite, deactivate, role assignment |

### ⚙️ Advanced Backend
| Feature | Details |
|---|---|
| Redis Sliding-Window Rate Limiting | Per-tenant, per-endpoint configurable limits |
| Webhook Delivery | HMAC-SHA256 signed, retry queue with exponential backoff |
| Background Jobs | Bull/BullMQ queues with Redis |
| File Uploads | Multipart with validation and cloud storage |
| Email (Mailtrap + Resend) | Templated transactional emails |

### 🔍 Search & Billing
| Feature | Details |
|---|---|
| Per-Tenant Full-Text Search | Meilisearch with tenant-scoped indices |
| Stripe Billing | Subscriptions, webhooks, plan enforcement |
| Plan-Based Feature Gating | Middleware-level feature flags by plan tier |
| Audit Logs | Immutable event trail per tenant |

### 📊 Production Grade
| Feature | Details |
|---|---|
| OpenTelemetry | Distributed tracing across services |
| Prometheus + Grafana | Metrics collection and dashboards |
| Structured Logging | JSON logs via Winston/Pino |
| Health Checks | `/health` and `/ready` endpoints |
| Docker Compose | Full local stack in one command |
| Environment-Based Config | `.env` driven, secrets never hardcoded |

---

## Tech Stack

```
Runtime       Node.js 18+
Framework     Express.js
Database      MongoDB (Mongoose)
Cache / Queue Redis 7 + BullMQ
Search        Meilisearch
Payments      Stripe
Auth          JWT, OAuth 2.0 (Google)
Observability OpenTelemetry, Prometheus, Grafana
Containerized Docker + Docker Compose
Email         Mailtrap (dev), Resend (prod)
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- MongoDB Atlas URI (or local MongoDB)
- Redis (included in Docker Compose)
- Stripe account + CLI
- Meilisearch instance

### 1. Clone the repo

```bash
git clone https://github.com/Vikram-kumar-7/TenantCore.git
cd TenantCore
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Fill in your credentials for MongoDB, Redis, Stripe, Google OAuth, Meilisearch, and Resend/Mailtrap.

### 3. Start the stack

```bash
docker-compose up -d
```

This spins up MongoDB, Redis, Meilisearch, Prometheus, and Grafana locally.

### 4. Install dependencies and run

```bash
npm install
npm run dev
```

Server starts at `http://localhost:3000`.

---

## API Structure

```
/api/v1
  /auth          → register, login, refresh, OAuth
  /tenants       → onboarding, settings, plan info
  /users         → invite, list, update roles
  /billing       → Stripe checkout, portal, webhooks
  /search        → per-tenant Meilisearch queries
  /webhooks      → register endpoints, delivery logs
  /admin         → platform-wide ops (super-admin only)

/health          → liveness check
/ready           → readiness check
/metrics         → Prometheus scrape endpoint
```

---

## Architecture Highlights

**Multi-Tenancy Model**
Every database query is scoped by `tenantId`. Middleware injects the resolved tenant context on each request — no cross-tenant data leakage is possible by design.

**Webhook Engine**
Outgoing webhooks are signed with HMAC-SHA256 using a per-tenant secret. Failed deliveries enter a BullMQ retry queue with exponential backoff, and delivery attempts are logged for auditability.

**Rate Limiting**
Redis sliding-window algorithm. Limits are configurable per tenant and per route. Exceeding the limit returns `429` with `Retry-After` headers.

**Observability Stack**
OpenTelemetry traces every request end-to-end. Prometheus scrapes `/metrics`. Grafana dashboards visualize request throughput, error rates, queue depths, and Redis memory.

---

## Project Structure

```
TenantCore/
├── src/
│   ├── config/          # env, db, redis, stripe setup
│   ├── middleware/       # auth, tenant, ratelimit, error
│   ├── modules/
│   │   ├── auth/
│   │   ├── tenants/
│   │   ├── users/
│   │   ├── billing/
│   │   ├── webhooks/
│   │   └── search/
│   ├── jobs/            # BullMQ workers
│   ├── utils/           # logger, crypto, email
│   └── app.js
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Environment Variables

Key variables required (see `.env.example` for full list):

```env
PORT=3000
NODE_ENV=development

MONGODB_URI=
REDIS_URL=

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

MEILISEARCH_HOST=
MEILISEARCH_API_KEY=

RESEND_API_KEY=
MAILTRAP_USER=
MAILTRAP_PASS=
```

---

## Roadmap

- [ ] WebSocket real-time notifications per tenant
- [ ] GraphQL API layer
- [ ] Kubernetes manifests (Helm chart)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] SDK for webhook consumers

---

## About the Author

**Kumar Vikram Aditya** — 3rd year CS student at Shobhit University, Meerut.
Building production-grade backend systems and actively seeking backend/full-stack internships.

- GitHub: [@Vikram-kumar-7](https://github.com/Vikram-kumar-7)
- LinkedIn: [kumar-vikram-aditya](https://linkedin.com/in/kumar-vikram-aditya-225031309)
- Email: kumarvickey2006@gmail.com

---

## License

MIT © Kumar Vikram Aditya

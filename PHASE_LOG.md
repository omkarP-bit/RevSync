# DealFlow360 — Phase Version Log

Tracks completed phases, endpoints delivered, and metadata.

---

## Phase 0 — Foundations & Environment

**Status:** COMPLETED
**Date:** 2026-09-05

### What was built
- Backend: Express.js + TypeScript project with config loader, error handling middleware, structured logging (Winston), request ID tracking
- Frontend: Next.js + TypeScript app with Tailwind CSS, shared API client with pagination envelope
- Database: Docker Compose with PostgreSQL 16, node-pg-migrate for migrations
- Health endpoint: `GET /api/v1/health`

### Files created
```
docker-compose.yml
src/backend/package.json, tsconfig.json, Dockerfile
src/backend/src/index.ts, config.ts
src/backend/src/middleware/errorHandler.ts, requestLogger.ts
src/backend/src/shared/logger.ts, errors.ts
src/backend/src/database/pool.ts
src/backend/migrations/001_initial_schema.ts
src/frontend/package.json, tsconfig.json, next.config.js, Dockerfile
src/frontend/tailwind.config.ts, postcss.config.js
```

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/health | Health check |

---

## Phase 1 — Identity, RBAC & Reference Data

**Status:** COMPLETED
**Date:** 2026-09-05

### What was built
- Auth module: login, logout, refresh with JWT (access + refresh tokens)
- Role-check middleware (`authenticate`, `requireRole`) with 5 seeded roles
- Customer-scoped auth middleware for portal routes
- Customers module: full CRUD with pagination, filtering by status/tier
- Categories module: full CRUD with pagination
- Currencies module: CRUD + exchange rate management
- Database tables: `roles`, `users`, `customer_tiers`, `customers`, `categories`, `currencies`, `exchange_rates`
- Seeded data: 5 roles, 3 tiers (Bronze/Silver/Gold), 4 currencies (USD/EUR/GBP/INR)
- Frontend: Login screen, internal nav shell, admin pages (Customers, Categories, Currencies), portal shell

### Database tables created
| Table | Key columns |
|-------|------------|
| roles | id, name, description |
| users | id, email (CITEXT, UNIQUE), password_hash, first_name, last_name, role_id FK, is_active |
| customer_tiers | id, name, description, discount_ceiling_pct |
| customers | id, name, email (CITEXT, UNIQUE), company, phone, tier_id FK, status, currency_code |
| categories | id, name, description, parent_id FK (self-ref) |
| currencies | id, code (UNIQUE), name, symbol, is_active |
| exchange_rates | id, from_currency_code FK, to_currency_code FK, rate, effective_at |

### Indexes created
- `idx_users_active` (partial: WHERE is_active = true)
- `idx_customers_tier_id`
- `idx_customers_status_created_at`
- `idx_exchange_rates_lookup` (from_currency_code, to_currency_code, effective_at)

### Endpoints delivered
| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | /api/v1/health | No | — | Health check |
| POST | /api/v1/auth/login | No | — | Login, returns JWT |
| POST | /api/v1/auth/refresh | No | — | Refresh access token |
| POST | /api/v1/auth/logout | Yes | Any | Logout |
| GET | /api/v1/customers | Yes | Admin, Sales Rep, Sales Manager | List customers (paginated) |
| GET | /api/v1/customers/:id | Yes | Admin, Sales Rep, Sales Manager | Get customer by ID |
| POST | /api/v1/customers | Yes | Admin | Create customer |
| PATCH | /api/v1/customers/:id | Yes | Admin | Update customer |
| GET | /api/v1/categories | Yes | Admin, Sales Rep | List categories (paginated) |
| GET | /api/v1/categories/:id | Yes | Admin, Sales Rep | Get category by ID |
| POST | /api/v1/categories | Yes | Admin | Create category |
| PATCH | /api/v1/categories/:id | Yes | Admin | Update category |
| GET | /api/v1/currencies | Yes | Admin, Sales Rep, Finance | List currencies (paginated) |
| POST | /api/v1/currencies | Yes | Admin | Create currency |
| GET | /api/v1/currencies/exchange-rates | Yes | Admin, Finance | List exchange rates |
| POST | /api/v1/currencies/exchange-rates | Yes | Admin | Create exchange rate |

### Default sort orders (fixed, no sort param)
- Customers: `status ASC, created_at DESC`
- Categories: `name ASC`
- Currencies: `code ASC`
- Exchange rates: `effective_at DESC`

### Frontend pages
| Route | Description |
|-------|-------------|
| /login | Login screen |
| /internal | Sales Dashboard (placeholder cards) |
| /admin | Admin Console overview |
| /admin/customers | Customers list with pagination |
| /admin/categories | Categories list |
| /admin/currencies | Currencies list |
| /portal | Customer Portal (placeholder) |
| /internal/quotations | Placeholder (Phase 3) |
| /internal/approvals | Placeholder (Phase 4) |
| /internal/fulfillment | Placeholder (Phase 5) |
| /internal/subscriptions | Placeholder (Phase 8) |
| /internal/invoices | Placeholder (Phase 7) |
| /internal/deal-health | Placeholder (Phase 9) |
| /internal/reports | Placeholder (Phase 9) |

---

## Test Coverage Summary

### Test framework: Vitest
### Run command: `npm test` (in src/backend)
### Total: **82 tests across 10 test files — all passing**

| Test file | Tests | Covers |
|-----------|-------|--------|
| `errors.test.ts` | 12 | AppError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError, ValidationError |
| `config.test.ts` | 4 | loadConfig validation, defaults, missing env, short JWT_SECRET |
| `errorHandler.test.ts` | 6 | AppError handling, ZodError handling, unknown errors (500), requestId fallback |
| `auth.test.ts` | 10 | authenticate middleware (valid/invalid/missing token, expiry), requireRole (role match/reject/empty), ROLES constants |
| `authRoutes.test.ts` | 11 | POST /login (missing fields, invalid creds, wrong password, success, email lowercase), POST /refresh (missing, invalid, success), POST /logout (auth required, success) |
| `customers.test.ts` | 14 | GET / (auth, pagination, filters, role check), GET /:id (found, 404), POST / (create, validation, role), PATCH /:id (update, 404), Sales Rep permissions |
| `categories.test.ts` | 10 | GET / (auth, pagination, role), GET /:id (found, 404), POST / (create, validation, role), PATCH /:id (update, 404) |
| `currencies.test.ts` | 12 | GET / (auth, pagination, role), POST / (create, uppercase, validation, role), GET /exchange-rates (admin, finance), POST /exchange-rates (create, same-currency reject, negative rate reject) |
| `requestLogger.test.ts` | 2 | Calls next(), registers finish listener |
| `health.test.ts` | 1 | GET /health returns 200 with status ok |

### Test infrastructure
- **Mocking:** Database pool (`query`, `getPool`, `withTransaction`) mocked globally via `vitest.mock`
- **Logger:** Suppressed during tests (mocked to no-op)
- **HTTP testing:** supertest for full Express route testing
- **Auth testing:** JWT tokens generated per-test with correct role payloads
- **Error handling:** All test apps include `errorHandler` middleware for proper error response shapes

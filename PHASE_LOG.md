# RevSync — Phase Version Log

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

## Phase 2 — Product Catalog, Pricing & Multi-Currency

**Status:** COMPLETED
**Date:** 2026-09-05

### What was built
- Product Catalog module: products, product variants, and product relationships (upsell / cross-sell links)
- Product type support (`ONE_TIME` vs `RECURRING`) for subscription billing integration in Phase 7
- Pricing engine (`pricing-engine.ts`): resolves product unit price for a given `customer_tier_id` and `currency_code`
- Price lists module: Tier × Currency matrix management and unit price items configuration
- Margin Protection & Security: `products.base_cost` is automatically stripped from non-admin/non-finance responses
- Database tables: `products`, `product_variants`, `price_lists`, `price_list_items`, `product_relationships`
- Seeded data: 3 sample products (Enterprise Platform, 24/7 Cloud Support, IoT Edge Gateway), variants, and complete Tier × Currency price list entries
- Frontend Admin screens: Products List Dashboard, Product Details & Variants Manager, Price List Matrix Manager

### Database tables created
| Table | Key columns |
|-------|------------|
| products | id, sku (UNIQUE), name, description, category_id FK, product_type, base_cost, is_active |
| product_variants | id, product_id FK, sku (UNIQUE), name, attributes (JSONB) |
| price_lists | id, name, customer_tier_id FK, currency_code FK, is_active, UNIQUE(customer_tier_id, currency_code) |
| price_list_items | id, price_list_id FK, product_id FK, unit_price, UNIQUE(price_list_id, product_id) |
| product_relationships | id, product_id FK, related_product_id FK, relationship_type, UNIQUE(product_id, related_product_id, relationship_type) |

### Indexes created
- `idx_products_category_id` (category_id)
- `idx_products_active_name` (partial: WHERE is_active = true)
- `idx_product_variants_product_id` (product_id)
- `idx_price_list_items_lookup` (price_list_id, product_id)
- `idx_product_relationships_product_id` (product_id)

### Endpoints delivered
| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | /api/v1/products | Yes | Admin, Sales Rep, Sales Manager | List products (paginated) |
| GET | /api/v1/products/:id | Yes | Admin, Sales Rep, Sales Manager | Get product by ID (includes variants & pricing) |
| POST | /api/v1/products | Yes | Admin | Create product |
| PATCH | /api/v1/products/:id | Yes | Admin | Update product |
| GET | /api/v1/products/:id/variants | Yes | Admin, Sales Rep, Sales Manager | List product variants |
| POST | /api/v1/products/:id/variants | Yes | Admin | Create product variant |
| GET | /api/v1/products/:id/relationships | Yes | Admin, Sales Rep, Sales Manager | List product recommendations |
| POST | /api/v1/products/:id/relationships | Yes | Admin | Create upsell / cross-sell link |
| GET | /api/v1/pricelists | Yes | Admin, Sales Rep, Sales Manager, Finance | List price lists (paginated) |
| GET | /api/v1/pricelists/:id | Yes | Admin, Sales Rep, Sales Manager, Finance | Get price list detail & items |
| POST | /api/v1/pricelists | Yes | Admin | Create price list |
| POST | /api/v1/pricelists/:id/items | Yes | Admin | Add/update item unit price |

### Default sort orders (fixed, no sort param)
- Products: `name ASC`
- Product Variants: `name ASC`
- Price Lists: `is_active DESC, name ASC`
- Price List Items: `product name ASC`
- Product Relationships: `relationship_type ASC`

### Frontend pages
| Route | Description |
|-------|-------------|
| /admin/products | Product Dashboard & Product creation modal |
| /admin/products/:id | Product details, Variants manager, Upsell/Cross-sell linkages |
| /admin/pricelists | Tier × Currency Price Matrix list & unit price item editor |

---

## Phase 3 — Quotation Builder & Live Pricing

**Status:** COMPLETED
**Date:** 2026-09-05

### What was built
- Quotations Calculation Engine (`quotation-engine.ts`): Calculates line-by-line line subtotals, line discounts, line costs, and line margins; aggregates quote subtotal, discount total, tax total, grand total, total cost, margin amount, and margin percentage.
- Quotations module & REST endpoints: CRUD for quotes and line items with server-side live recalculations.
- Snapshot pricing: `unit_price` (from Tier × Currency price list) and `unit_cost` (from product `base_cost`) are snapshotted on line creation.
- Security & Contract: Contract stub fields (`total_overage: 0`, `risk_level: 'LOW'`) established for seamless Phase 4 integration.
- Database tables: `quotations` (including UUID `public_id`), `quotation_lines`
- Seeded data: Sample quotations (`QT-2026-0001` and `QT-2026-0002`) with multi-line items across `DRAFT` and `PENDING_APPROVAL` statuses.
- Frontend Sales Rep screens: Sales Dashboard with metric cards, Quotations List with status filters & pagination, and Live Quotation Builder & Line Editor page.

### Database tables created
| Table | Key columns |
|-------|------------|
| quotations | id, quotation_number (UNIQUE), public_id (UUID UNIQUE), customer_id FK, sales_rep_id FK, currency_code FK, status, subtotal, discount_total, tax_rate_pct, tax_total, grand_total, total_cost, margin_amount, margin_pct, total_overage, risk_level, notes |
| quotation_lines | id, quotation_id FK, product_id FK, product_variant_id FK, description, quantity, unit_price, unit_cost, applied_discount_pct, discount_amount, line_subtotal, line_total, line_cost, line_margin |

### Indexes created
- `idx_quotations_number` (quotation_number)
- `idx_quotations_public_id` (public_id)
- `idx_quotations_customer_id` (customer_id)
- `idx_quotations_sales_rep_status` (sales_rep_id, status)
- `idx_quotations_status_created` (status, created_at DESC)
- `idx_quotation_lines_quotation_id` (quotation_id)
- `idx_quotation_lines_product_id` (product_id)

### Endpoints delivered
| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | /api/v1/quotations | Yes | Admin, Sales Rep, Sales Manager, Finance | List quotations (paginated) |
| GET | /api/v1/quotations/:id | Yes | Admin, Sales Rep, Sales Manager, Finance | Get quotation by ID or public_id with lines |
| POST | /api/v1/quotations | Yes | Admin, Sales Rep, Sales Manager | Create quotation header (resolves tier & currency) |
| PATCH | /api/v1/quotations/:id | Yes | Admin, Sales Rep, Sales Manager | Update quotation header & recalculate |
| POST | /api/v1/quotations/:id/lines | Yes | Admin, Sales Rep, Sales Manager | Add line item (snapshots price/cost & recalculates) |
| PATCH | /api/v1/quotations/:id/lines/:lineId | Yes | Admin, Sales Rep, Sales Manager | Update line quantity/discount & live recalculate |
| DELETE | /api/v1/quotations/:id/lines/:lineId | Yes | Admin, Sales Rep, Sales Manager | Delete line item & live recalculate |
| POST | /api/v1/quotations/:id/recalculate | Yes | Admin, Sales Rep, Sales Manager | Force full quote recalculation |

### Default sort orders (fixed, no sort param)
- Quotations: `status ASC, created_at DESC`
- Quotation Lines: `id ASC`

### Frontend pages
| Route | Description |
|-------|-------------|
| /internal | Sales Representative Dashboard with metric cards |
| /internal/quotations | Quotations List with status filter tabs & creation modal |
| /internal/quotations/:id | Live Quotation Builder & Line-by-Line Editor |

---

## Test Coverage Summary

### Test framework: Vitest
### Run command: `npm test` (in src/backend)
### Total: **100 tests across 15 test files — all passing**

| Test file | Tests | Covers |
|-----------|-------|--------|
| `quotationEngine.test.ts` | 3 | calculateQuotation calculations, line subtotal/discount/margin, header tax/grand_total/margins |
| `quotations.test.ts` | 4 | GET /quotations (pagination, sort, status filter), POST /quotations (auto-gen quote number), GET /:id with lines |
| `pricingEngine.test.ts` | 3 | resolveUnitPrice resolution, case-insensitivity, missing match fallback |
| `products.test.ts` | 5 | GET /products (pagination, default sort), base_cost security serialization, POST /products role check |
| `pricelists.test.ts` | 3 | GET /pricelists (pagination, sort), POST /pricelists, POST /pricelists/:id/items price updates |
| `errors.test.ts` | 12 | AppError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError, ValidationError |
| `config.test.ts` | 4 | loadConfig validation, defaults, missing env, short JWT_SECRET |
| `errorHandler.test.ts` | 6 | AppError handling, ZodError handling, unknown errors (500), requestId fallback |
| `auth.test.ts` | 10 | authenticate middleware (valid/invalid/missing token, expiry), requireRole (role match/reject/empty), ROLES constants |
| `authRoutes.test.ts` | 11 | POST /login (missing fields, invalid creds, wrong password, success), POST /refresh, POST /logout |
| `customers.test.ts` | 14 | GET / (auth, pagination, filters, role check), GET /:id, POST /, PATCH /:id |
| `categories.test.ts` | 10 | GET / (auth, pagination, role), GET /:id, POST /, PATCH /:id |
| `currencies.test.ts` | 12 | GET / (auth, pagination, role), POST /, GET /exchange-rates, POST /exchange-rates |
| `requestLogger.test.ts` | 2 | Calls next(), registers finish listener |
| `health.test.ts` | 1 | GET /health returns 200 with status ok |

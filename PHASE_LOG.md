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
- Customer Tier Engine (`customer-tier-engine.ts`): deterministic, rule-based tier recommendation from commercial attributes (customer_type, expected_po_value, payment_terms, upfront_payment_pct). No AI/ML — transparent, auditable rules with explainable reasons. Most-specific active rule wins; catch-all default falls back to BRONZE.
- Tier workflow endpoints: `evaluate` (engine recommendation + reasons), `confirm` (Sales Rep/Admin accepts recommended tier), `override` (Manager/Admin only, requires reason, audit-logged, preserves the engine's recommendation in history)
- Database tables: `roles`, `users`, `customer_tiers`, `customers`, `categories`, `currencies`, `exchange_rates`; plus `customer_tier_rules` (admin-configurable engine rules) and `customer_tier_evaluations` (evaluate/confirm/override audit history)
- Commercial customer attributes: `customer_type`, `expected_po_value`, `payment_terms`, `upfront_payment_pct`
- Seeded data: 5 roles, 3 tiers (Bronze/Silver/Gold), 4 currencies (USD/EUR/GBP/INR), 3 deterministic tier rules (Enterprise→GOLD, Business mid-value→SILVER, Default→BRONZE)
- Frontend: Login screen, internal nav shell, admin pages (Customers with Evaluate/Confirm/Override modal, Categories, Currencies), portal shell

### Database tables created
| Table | Key columns |
|-------|------------|
| roles | id, name, description |
| users | id, email (CITEXT, UNIQUE), password_hash, first_name, last_name, role_id FK, is_active |
| customer_tiers | id, name, description, discount_ceiling_pct |
| customers | id, name, email (CITEXT, UNIQUE), company, phone, tier_id FK, status, currency_code, customer_type, expected_po_value, payment_terms, upfront_payment_pct |
| categories | id, name, description, parent_id FK (self-ref) |
| currencies | id, code (UNIQUE), name, symbol, is_active |
| exchange_rates | id, from_currency_code FK, to_currency_code FK, rate, effective_at |
| customer_tier_rules | id, name, target_tier, customer_type, min_expected_po_value, min_upfront_payment_pct, payment_terms[], is_active |
| customer_tier_evaluations | id, customer_id FK, status (RECOMMENDED/CONFIRMED/OVERRIDDEN), recommended_tier, resolved_tier, input_snapshot JSONB, matched_rules JSONB, action_by FK, action_at, reason |

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
| POST | /api/v1/customers/:id/tier/evaluate | Yes | Admin, Sales Rep, Sales Manager | Run Customer Tier Engine, return recommended tier + reasons |
| POST | /api/v1/customers/:id/tier/confirm | Yes | Admin, Sales Rep, Sales Manager | Accept the recommended tier |
| POST | /api/v1/customers/:id/tier/override | Yes | Admin, Sales Manager | Override tier (requires reason, audit-logged) |
| GET | /api/v1/customers/:id/tier/evaluations | Yes | Admin, Sales Manager | Tier evaluation/confirm/override history |
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
| /internal/quotations | Dual-mode Quotations Manager: **Kanban Board** (status columns, totals, quick status changer) + **List View** (status filter tabs & pagination) |
| /internal/quotations/:id | Live Quotation Builder & Line-by-Line Editor |

---

## Phase 4 — Discount Governance, Risk & Approval Workflow

**Status:** COMPLETED
**Date:** 2026-09-05

### What was built
- Discount engine (`discount-engine.ts`): computes percentage-point overage per line against the allowed discount for a customer tier × product category, and rolls it up to a quote-level `total_overage`.
- Approval engine (`approval-engine.ts`): risk-level mapping from approval-rule thresholds, ordered role-step chains, queue-style decision application (`APPROVE` / `REJECT` / `RETURN`).
- Discount Rules module: configurable max discount per customer tier × product category (admin).
- Approvals module: submit quotation for approval, multi-step decisions gated to the pending step's role, 422 guards on forbidden status transitions.
- Auto re-approval semantics: editing a PENDING_APPROVAL quotation cancels the open request and re-opens a new chain when risk stays above threshold; if an edit drops risk to LOW the quotation auto-approves.
- Append-only audit log on every state-changing action (discount edits, approval decisions, reopen/retract).
- Database tables: `discount_rules`, `approval_rules`, `approval_requests`, `approval_steps`, `audit_logs`
- Seeded rules: Gold × Software Licenses → 10% discount; MEDIUM overage ≥ 5 pts → Sales Manager; HIGH overage ≥ 8 pts → Sales Manager → Finance.
- Frontend: Approvals list + detail with role-gated decisions, admin Discount Rules & Approval Rules configuration, quotation editor workflow buttons (Submit / Revoke / Confirm), risk + overage metric cards and per-line "Allowed" discount column.

### Database tables created
| Table | Key columns |
|-------|------------|
| discount_rules | id, customer_tier_id FK, category_id FK, max_discount_pct, is_active, UNIQUE(tier_id, category_id) WHERE is_active |
| approval_rules | id, risk_level CHECK, min_total_overage, role_sequence INTEGER[], is_active |
| approval_requests | id, quotation_id FK, status CHECK, risk_level, total_overage, submitted_by FK, decided_by FK, notes |
| approval_steps | id, approval_request_id FK (CASCADE), sequence, role_id FK, status CHECK, decided_by FK |
| audit_logs | id, entity_type, entity_id, action, before JSONB, after JSONB, performed_by FK, reason |

### Indexes created
- `uq_discount_rules_tier_category_active`, `idx_discount_rules_category_id`
- `idx_approval_rules_risk_seq`
- `idx_approval_requests_quotation_id`, `idx_approval_requests_status_created` (partial PENDING_APPROVAL)
- `idx_approval_steps_request_id`
- `idx_audit_logs_entity`

### Endpoints delivered
| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET/POST/PATCH | /api/v1/discounts/rules | Yes | View: Admin, Sales Manager; Mutate: Admin | Discount policy CRUD |
| GET | /api/v1/approvals | Yes | Admin, Sales Manager, Finance | List approval requests (paginated, status filter) |
| GET | /api/v1/approvals/rules | Yes | Admin, Sales Manager | List approval rules |
| POST | /api/v1/approvals/rules | Yes | Admin | Create approval rule |
| GET | /api/v1/approvals/:id | Yes | Admin, Sales Manager, Finance | Approval request detail + steps |
| POST | /api/v1/approvals/:id/approve | Yes | Pending step role | Approve current step |
| POST | /api/v1/approvals/:id/reject | Yes | Pending step role | Reject request |
| POST | /api/v1/approvals/:id/return | Yes | Pending step role | Return to editing |
| POST | /api/v1/quotations/:id/submit | Yes | Admin, Sales Rep, Sales Manager | Submit for approval (opens chain by risk) |
| PATCH | /api/v1/quotations/:id (guards) | Yes | Admin, Sales Rep, Sales Manager | Blocked direct APPROVED/PENDING_APPROVAL/REJECTED; CONFIRMED only from APPROVED |

### Frontend pages
| Route | Description |
|-------|-------------|
| /internal/approvals | Approval list with status tabs & pagination |
| /internal/approvals/:id | Approval chain timeline + role-gated decisions + notes |
| /admin/discount-rules | Discount policy matrix editor |
| /admin/approval-rules | Approval chain configuration |

### Workflow guard rules (422)
- `CONFIRMED` only from `APPROVED` with no open approval request.
- Direct header `APPROVED` / `PENDING_APPROVAL` / `REJECTED` transitions rejected.
- Re-decision on a decided request rejected.

---

## Phase 5 — Warehouse Fulfillment & Inventory

**Status:** COMPLETED
**Date:** 2026-09-05

### What was built
- Fulfillment engine (`fulfillment-engine.ts`): deterministic multi-warehouse allocation. Per line, candidate warehouses are ranked by (base shipping cost ASC → existing shipment count ASC → warehouse id ASC) and requested quantity is consumed greedily; any shortfall becomes a backorder. Status = ALLOCATED / PARTIAL / BACKORDERED.
- Warehouses module: warehouse CRUD + per-warehouse inventory upsert (`quantity_on_hand`, `reorder_threshold`).
- Fulfillment module: create order from a CONFIRMED quotation (auto-allocate), detail with allocations, manual override with over-allocation protection (422), ship (decrements on-hand stock, atomic anti-negative guard → 409), cancel, and list with status filter + pagination.
- Database tables: `warehouses`, `inventory_items`, `fulfillment_orders` (one per quotation, UNIQUE), `fulfillment_allocations`
- Seeded data: 3 warehouses (Mumbai Main / Delhi NCR / Bengaluru South) with stock for the three seeded products.
- Frontend: Fulfillment list with status tabs + "create from quotation" flow, Fulfillment detail with allocations table and role-gated Ship / Cancel / Override actions, admin Warehouses page with inventory management.

### Database tables created
| Table | Key columns |
|-------|------------|
| warehouses | id, name, code UNIQUE, address, base_shipping_cost CHECK ≥ 0, is_active |
| inventory_items | id, product_id FK, warehouse_id FK, quantity_on_hand, reorder_threshold, UNIQUE(product_id, warehouse_id) |
| fulfillment_orders | id, quotation_id FK UNIQUE, status CHECK, shipping_cost, backordered_quantity, shipped_at, created_by FK, notes |
| fulfillment_allocations | id, fulfillment_order_id FK (CASCADE), quotation_line_id FK, product_id FK, warehouse_id FK, quantity, unit_shipping_cost |

### Indexes created
- `idx_warehouses_active_name`
- `uq_inventory_product_warehouse`, `idx_inventory_items_warehouse_id`
- `idx_fulfillment_orders_status_created`, `idx_fulfillment_orders_quotation_id`
- `idx_fulfillment_allocations_order_id`, `idx_fulfillment_allocations_warehouse_id`

### Endpoints delivered
| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | /api/v1/warehouses | Yes | Admin, Warehouse Manager, Finance | List warehouses (paginated) |
| POST | /api/v1/warehouses | Yes | Admin | Create warehouse |
| PATCH | /api/v1/warehouses/:id | Yes | Admin | Update warehouse |
| GET | /api/v1/warehouses/:id/inventory | Yes | Admin, Warehouse Manager, Finance | List on-hand stock |
| POST | /api/v1/warehouses/:id/inventory | Yes | Admin, Warehouse Manager | Upsert stock level |
| GET | /api/v1/fulfillment | Yes | Admin, Warehouse Manager, Sales Manager, Finance, Sales Rep | List fulfillment orders |
| POST | /api/v1/fulfillment | Yes | Admin, Warehouse Manager | Auto-allocate from CONFIRMED quotation |
| GET | /api/v1/fulfillment/:id | Yes | Admin, Warehouse Manager, Sales Manager, Finance, Sales Rep | Order detail + allocations |
| POST | /api/v1/fulfillment/:id/override | Yes | Admin, Warehouse Manager | Manual allocation override |
| POST | /api/v1/fulfillment/:id/ship | Yes | Admin, Warehouse Manager | Deduct inventory, mark shipped |
| POST | /api/v1/fulfillment/:id/cancel | Yes | Admin, Warehouse Manager | Cancel order |

### Frontend pages
| Route | Description |
|-------|-------------|
| /internal/fulfillment | Order list with status tabs, pagination, create-from-quotation |
| /internal/fulfillment/:id | Allocations table + Ship / Cancel / Override (role-gated) |
| /admin/warehouses | Warehouse CRUD + per-warehouse stock manager |

### Fulfillment rules
- Only `CONFIRMED` quotations can be fulfilled (422 otherwise); one order per quotation (409 on duplicate).
- Override can never allocate more than the quotation requests per product (422).
- Shipping decrements on-hand stock only when sufficient stock exists (409 otherwise); SHIPPED orders cannot be re-shipped or cancelled.

---

## Phase 6 — Negotiations

### What was built
- Shared quotation recalculation/approval machinery extracted into `src/backend/src/shared/quote-workflow.ts` (`fetchQuoteContext`, `fetchLinesWithCategories`, `fetchDiscountRules`, `fetchApprovalRules`, `recalculateAndPersistQuotation`, `createApprovalRequest`, `reopenApprovalAfterEdit`, `RecalcResult`); `quotations.routes.ts` imports these helpers.
- Internal negotiation workflow (`negotiations.routes.ts`): open a negotiation on an `APPROVED`/`NEGOTIATION` quotation (409 if one open), list/detail with requests + message thread, sales raises requests, Manager/Admin accept/reject, sales messages, close.
- **Discount acceptance reuses the exact Phase 4 engine pipeline** — applies the requested discount pct to the line, recalculates the quotation, supersedes any open approval request, and issues a fresh approval request when risk != LOW (quote → `PENDING_REAPPROVAL`) or auto-approves when risk is LOW.
- Customer portal (`negotiationsPortalRouter`, `authenticateCustomer`): list the customer's negotiations (new `GET /api/v1/portal/negotiations`), ownership-checked/sanitized detail, submit requests (DISCOUNT requires a line), post messages. Portal responses never expose `base_cost`, `margin`, `risk_level`, `total_overage`, approval notes, or other customers' data.

### Database tables (migration `007_negotiations.ts`)
- `negotiations`, `negotiation_requests`, `negotiation_messages`; status CHECK gains `PENDING_REAPPROVAL`; `DISCOUNT` request requires `quotation_line_id`; `requested_by_customer` flag.

### Endpoints
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/v1/negotiations` | Open a negotiation (sets quote NEGOTIATION; 409 if open exists; 422 unless APPROVED/NEGOTIATION) |
| GET | `/api/v1/negotiations` | List (paginated, fixed sort) |
| GET | `/api/v1/negotiations/:id` | Detail + requests + messages |
| POST | `/api/v1/negotiations/:id/requests` | Sales raises a request (captures original_value for DISCOUNT) |
| POST | `/api/v1/negotiations/:id/requests/:requestId/accept` | Manager/Admin only; DISCOUNT applies pct + recalc + auto-reapproval |
| POST | `/api/v1/negotiations/:id/requests/:requestId/reject` | Manager/Admin only |
| POST | `/api/v1/negotiations/:id/messages` | Sales message |
| POST | `/api/v1/negotiations/:id/close` | Manager/Admin only |
| GET | `/api/v1/portal/negotiations` | Customer list (own data only) |
| GET | `/api/v1/portal/negotiations/:publicId` | Customer detail (sanitized, ownership-checked) |
| POST | `/api/v1/portal/negotiations/:publicId/requests` | Customer submits request |
| POST | `/api/v1/portal/negotiations/:publicId/messages` | Customer message |

### Frontend pages
| Path | Purpose |
|------|---------|
| `/portal` | Customer "My Quotations" list with active negotiations (replaces placeholder) |
| `/portal/negotiations/[publicId]` | Customer negotiation screen: line items + discounts, request composer (DISCOUNT requires line), message thread, auto-reapproval notice, no margin/risk/base_cost display |
| `/internal/negotiations` | Sales list + "Open Negotiation" modal |
| `/internal/negotiations/[id]` | Sales thread: line table, requests with accept/reject (Manager/Admin), message reply, close; "Negotiations" added to `internal/layout.tsx` nav |

### E2E verification
- Live smoke against throwaway Postgres confirmed: portal list returns only the requesting customer's negotiations, detail GET sanitized (no sensitive fields), quote `PENDING_REAPPROVAL` + fresh HIGH approval after an accepted over-threshold discount (2 → 18%).
- Full backend suite: **220 tests across 24 files — all passing**; `tsc --noEmit` clean; frontend `next lint` clean (pre-existing warnings only).

### Post-merge reconciliation (origin `672db64`)
- Merged upstream `order_discount` support onto the stash: `shared/quote-workflow.ts` now threads `orderDiscountPct` into `calculateQuotation`/`evaluateDiscounts` and persists `order_discount_pct`/`order_discount_amount` in the header UPDATE; upfront inline copy of the workflow helpers deleted from `quotations.routes.ts` (shared module is the single source).
- Frontend quotation builder merges upstream's order-discount UI + variant/type column + dynamic upsell recommendations with the stash's Unit Cost, Margin column, and Total Cost/Margin/Tax footer rows.
- Parallel 007 migrations reconciled: `007_negotiations` (tables) + `007_order_discount` (quotations columns) both applied to live DB.

### Inventory by location (admin products)
- Added `GET /api/v1/products/inventory` (ADMIN/WAREHOUSE_MANAGER/FINANCE) returning all product × warehouse stock rows (product, sku, warehouse, location code, qty on hand, reorder threshold), defined before `/:id` so it isn't swallowed as a product id.
- Products Catalog list page (`admin/products/page.tsx`) now shows an "Inventory by Location" table: SKU, product, warehouse, location code, qty on hand, and a stock-status badge (In Stock / Low (reorder @ n) / Out of Stock).
- +3 tests (auth, role gate, data shape) → suite **223 / 24**. Backend + frontend `tsc` clean; `next lint` clean (pre-existing warning only).

---

## Test Coverage Summary

### Test framework: Vitest
### Run command: `npm test` (in src/backend)
### Total: **223 tests across 24 test files — all passing**

| Test file | Tests | Covers |
|-----------|-------|--------|
| `customerTierEngine.test.ts` | 10 | Tier engine determinism, condition matching (type/PO/upfront/payment terms), explainable reasons, specificity priority, inactive rules ignored |
| `negotiations.test.ts` | 20 | list/detail/open/conflict/validation/accept-HIGH auto-reapproval/accept-LOW/reject/roles/messages/close, portal GET+list+403+request+message |
| `customerTier.test.ts` | 9 | Evaluate/confirm/override endpoints, role gating (rep 403 on override), 404s, evaluation history |
| `quotationEngine.test.ts` | 3 | calculateQuotation calculations, line subtotal/discount/margin, header tax/grand_total/margins |
| `quotations.test.ts` | 6 | GET/POST quotations, GET /:id with lines, line add/edit/delete recalculation, approval reopen + auto-approve on risk drop |
| `discountEngine.test.ts` | 6 | overage per line, non-matching rules, cliff/ceiling, discount engine aggregations |
| `approvalEngine.test.ts` | 14 | risk mapping, steps building, applyDecision flows, queue semantics, not-actionable guards |
| `discounts.test.ts` | 8 | discount rules CRUD, pagination, role checks, conflicts |
| `approvals.test.ts` | 15 | approvals list/detail, rules admin, decision flows, role gating, guards |
| `fulfillmentEngine.test.ts` | 8 | allocation ranking/splitting/ties/backorder, stock consumption, status mapping |
| `fulfillment.test.ts` | 18 | warehouses + inventory CRUD, order create/backorder, override (+over-allocation 422, reallocation/removal), ship (+insufficient stock 409), cancel, role checks |
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

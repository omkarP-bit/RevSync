# DealFlow360

**A rule-driven, self-governing Quote-to-Cash orchestration platform for B2B sales.**

DealFlow360 manages the complete sales lifecycle — from quotation to cash — for a single company operating in multiple currencies. Every decision the system makes (discount risk, approval routing, warehouse allocation, upsell suggestions, deal health, subscription billing) is driven by **transparent, deterministic rules and mathematics**, not AI/ML. That makes every outcome explainable and auditable.

```
Quotation → Pricing → Discount Risk Evaluation → Approval → Customer Negotiation
    → Re-approval (if required) → Warehouse Fulfillment → Billing (one-time + recurring)
    → Invoice → Payment → Deal Health → Reporting
```

---

## Why DealFlow360

Most quote-to-cash tools either lock discounting/approval logic into rigid hardcoded rules, or lean on opaque ML scoring that's hard to explain to a sales manager or an auditor. DealFlow360 takes a third path: **every business rule is configuration, every outcome is a traceable calculation.**

- A discount is flagged HIGH risk because `overage = max(0, applied − allowed) = 8`, and that's shown to the user — not inferred by a model.
- An approval chain runs because a configured rule maps `HIGH risk → Sales Manager → Finance` — not because of a black-box score.
- A warehouse allocation is suggested because it minimizes shipment count against available stock — not because of a recommendation engine.

## Core Capabilities

- **Quotation builder** with live pricing, margin, and discount-risk feedback as a rep edits lines.
- **Discount governance** — configurable per customer tier × product category, with automatic overage/risk calculation.
- **Multi-step approval workflows** (e.g. Sales Manager → Finance) that trigger automatically when risk crosses a configured threshold, and re-trigger automatically if a customer's negotiation pushes the deal back over the line.
- **Customer portal** for negotiation — customers can request discount/quantity/product changes and chat directly on the quote; accepted changes recalculate risk and can auto-reopen approval.
- **Rule-based upsell/cross-sell recommendations** driven by configured product relationships, not ML.
- **Warehouse fulfillment engine** — automatic multi-warehouse allocation by stock + shipping cost + shipment count, with manual override and backorder handling.
- **Hybrid billing** — one-time invoices and recurring subscription billing schedules from the same quotation.
- **Subscription lifecycle** — plans can be changed (upgraded/downgraded/quantity-changed) **at any time**, with day-based proration. Cancelling a subscription mid-cycle converts any unused prepaid credit into a balance in the customer's own **credit wallet**, which is automatically applied to future invoices instead of being refunded through a payment gateway.
- **Deal health scoring** — configurable signal weights (stalled quote, approval delay, inventory shortage, high discount, etc.) roll up into a HEALTHY / AT_RISK / CRITICAL status per deal.
- **Full audit trail** — every state-changing action (discount override, approval decision, subscription change, wallet transaction) is logged with before/after values and a reason.
- **Admin console** — products, categories, price lists, currencies, discount rules, approval chains, warehouses, subscription plans, and product relationships are all configuration, not code.

## User Roles

| Role | Scope |
|---|---|
| Sales Representative | Build quotations, apply discounts, submit for approval, track fulfillment, talk to customers. |
| Sales Manager | Review/approve/reject/return quotations, configure discount & approval policy, monitor deal health. |
| Finance | Second-level approval, invoicing, payment reconciliation, credit notes, wallet/billing reconciliation. |
| Warehouse Manager | Inventory, fulfillment allocation, manual overrides, backorders. |
| Admin | Products, pricing, currencies, discount/approval rules, warehouses, subscription plans, system configuration. |
| Customer (portal) | View and negotiate quotations, view invoices, subscriptions, and wallet balance. |

## Tech Stack

- **Frontend:** React + TypeScript
- **Backend:** TypeScript (Node.js)
- **Database:** PostgreSQL
- **Dev environment:** Docker Compose (Postgres + backend + frontend, single-command spin-up)
- **API:** REST/JSON under `/api/v1`, offset-paginated list endpoints with fixed default sort order (no arbitrary `sort` query params — see [`database.md`](./database.md) for the indexing rationale)

## Project Structure

```
src/
├── modules/
│   ├── auth/           customers/        products/       pricing/
│   ├── quotations/     discounts/        approvals/      fulfillment/
│   ├── subscriptions/  billing/          wallet/         negotiations/
│   ├── deal-health/    reporting/
│
├── engines/
│   ├── discount-engine.ts       approval-engine.ts
│   ├── recommendation-engine.ts fulfillment-engine.ts
│   ├── proration-engine.ts      credit-settlement-engine.ts
│   └── deal-health-engine.ts
│
├── middleware/  database/  validation/  shared/

/internal   → dashboard, quotations, approvals, fulfillment, subscriptions, invoices, reports, admin
/portal     → login, quotations (customer-facing negotiation view)
```

## Getting Started

```bash
git clone <repo-url>
cd dealflow360
docker compose up
```

This starts PostgreSQL, the backend API, and the React frontend together. On first run, apply migrations and seed reference data (customer tiers, currencies, discount rules, approval rules) before creating your first quotation.

## Documentation

- [`database.md`](./database.md) — full schema: every table's columns, primary/foreign keys, constraints, and the indexing strategy behind each list screen and business engine.

## MVP Scope

**P0:** Auth & RBAC · Customers/Products/Categories/Price Lists/Currencies · Quotations & Lines · Discount Rules, Risk Calculation, Approval Workflow, Audit Logs · Warehouse/Inventory/Fulfillment/Manual Override/Backorder · Customer Portal Negotiation with Auto-Reapproval · Invoices · Payments.

**P1:** Subscriptions (any-time plan changes, cancellation-to-wallet credit) · Billing Schedules · Proration · Credit Notes · Product Recommendations · Deal Health · Discount Anomalies · Reporting.

**Future:** Multi-company support · Advanced logistics optimization · External ERP integrations · Live payment gateway · Advanced tax engine.

## Design Principle

> DealFlow360 is not "an AI that manages sales." It is a **deterministic business-rule engine** that automatically coordinates pricing, approval, negotiation, fulfillment, and billing across the quote-to-cash lifecycle — including a durable customer credit wallet for subscription cancellations.

That's what keeps the system explainable to a sales manager, auditable by Finance, and straightforward to demo end-to-end.
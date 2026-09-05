import "dotenv/config";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const BASE = "http://127.0.0.1:3999/api/v1";
const SECRET = process.env.JWT_SECRET!;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function api(base: string, token: string | null, method: string, path: string, body?: unknown, params?: Record<string, unknown>) {
  const url = new URL(base + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const A = {
    post: (p: string, b: unknown, params?: Record<string, unknown>) => api(BASE, null, "POST", "/auth/login", { email: "admin@revsync.com", password: "Password123!" }).then(() => api(BASE, null, "POST", p, b, params)),
  };

  const adminLogin = await api(BASE, null, "POST", "/auth/login", { email: "admin@revsync.com", password: "Password123!" });
  const admin = adminLogin.data.access_token;
  const Ax = (token: string) => ({
    get: (p: string, params?: Record<string, unknown>) => api(BASE, token, "GET", p, undefined, params),
    post: (p: string, b?: unknown) => api(BASE, token, "POST", p, b ?? {}),
  });
  const A2 = Ax(admin);

  // Create a category + product (fresh DB has none)
  const cat = await A2.post("/categories", { name: "Software" });
  const categoryId = cat.data.id;
  const sku = `SW-SMOKE-${Date.now()}`;
  const prod = await A2.post("/products", { sku, name: "Smoke License", category_id: categoryId, product_type: "ONE_TIME", base_cost: 400 });
  const product = prod.data;
  console.log("product:", product.name, "category:", product.category_id, "price:", product.list_price);

  const cust = await A2.post("/customers", {
    name: "Negotiation Test Co",
    email: `nego${Date.now()}@testco.com`,
    phone: "+911234567890",
    currency_code: "INR",
    address: "1 Test St, Mumbai",
    customer_type: "ENTERPRISE",
    tier_id: 1,
    expected_po_value: 2500000,
    payment_terms: "NET_30",
    upfront_payment_pct: 50,
  });
  const customerId = cust.data.id;
  console.log("customer created:", customerId);

  const ev = await A2.post(`/customers/${customerId}/tier/evaluate`);
  console.log("tier evaluate:", ev.data.recommended_tier, "|", ev.data.reason);
  await A2.post(`/customers/${customerId}/tier/confirm`);

  await pool.query(
    `INSERT INTO discount_rules (customer_tier_id, category_id, max_discount_pct, is_active)
     VALUES (3, $1, 10, true) ON CONFLICT DO NOTHING`,
    [product.category_id]
  );
  await pool.query(
    `INSERT INTO approval_rules (risk_level, min_total_overage, role_sequence, is_active) VALUES
       ('MEDIUM', 5, ARRAY[2], true),
       ('HIGH', 8, ARRAY[2,3], true) ON CONFLICT DO NOTHING`
  );
  console.log("rules seeded for tier 3 / category", product.category_id);

  const quoteRes = await A2.post("/quotations", { customer_id: customerId, tax_rate_pct: 10 });
  const quotationId = quoteRes.data.id;
  const lineRes = await A2.post(`/quotations/${quotationId}/lines`, { product_id: product.id, quantity: 5, applied_discount_pct: 2 });
  const lineId = lineRes.data.lines.at(-1).id;
  console.log("quote:", quotationId, "line:", lineId, "risk:", lineRes.data.risk_level);

  const submit = await A2.post(`/quotations/${quotationId}/submit`, { notes: "smoke" });
  console.log("submit status:", submit.data.status, "risk:", submit.data.risk_level);
  if (submit.data.status !== "APPROVED") throw new Error("expected APPROVED on submit");

  const negRes = await A2.post("/negotiations", { quotation_id: quotationId });
  const negotiationId = negRes.data.id;
  console.log("negotiation opened:", negotiationId, "|", negRes.data.negotiation_status);

  const publicId = negRes.data.public_id;
  const customerToken = jwt.sign({ customerId, email: "nego@testco.com" }, SECRET, { expiresIn: "1h" });
  const C = Ax(customerToken);
  const portal = await C.get(`/portal/negotiations/${publicId}`);
  console.log("portal lines:", portal.data.lines.length, "current_total:", portal.data.current_total);
  if (JSON.stringify(portal.data).match(/base_cost|margin|risk_level|total_overage/i)) {
    throw new Error("portal leaked internal fields");
  }

  const reqRes = await C.post(`/portal/negotiations/${publicId}/requests`, {
    request_type: "DISCOUNT",
    quotation_line_id: lineId,
    requested_value: "18",
    message: "Please grant 18%",
  });
  console.log("portal request:", reqRes.data.id, reqRes.data.status);

  const managerLogin = await api(BASE, null, "POST", "/auth/login", { email: "manager@revsync.com", password: "Password123!" });
  const M = Ax(managerLogin.data.access_token);
  const accept = await M.post(`/negotiations/${negotiationId}/requests/${reqRes.data.id}/accept`, { notes: "ok per policy" });
  console.log("after accept -> quotation:", accept.data.quotation_status, "negotiation:", accept.data.negotiation_status);
  for (const r of accept.data.requests) {
    console.log("  request:", r.request_type, r.status, "original:", r.original_value, "->", r.requested_value);
  }
  if (accept.data.quotation_status !== "PENDING_APPROVAL") {
    throw new Error("expected PENDING_APPROVAL after high-risk accept, got " + accept.data.quotation_status);
  }

  const lineRow = await pool.query(`SELECT applied_discount_pct FROM quotation_lines WHERE id = $1`, [lineId]);
  console.log("db line discount now:", lineRow.rows[0].applied_discount_pct);
  const appr = await pool.query(
    `SELECT ar.id, ar.risk_level, ar.total_overage, COUNT(s.id) AS steps
     FROM approval_requests ar LEFT JOIN approval_steps s ON s.approval_request_id = ar.id
     WHERE ar.quotation_id = $1 GROUP BY ar.id ORDER BY ar.id DESC LIMIT 1`,
    [quotationId]
  );
  console.log("latest approval:", appr.rows[0]);
  if (appr.rows[0].risk_level !== "HIGH") throw new Error("expected HIGH risk approval");

  console.log("\nSMOKE OK");
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err.stack);
  process.exit(1);
}).finally(() => pool.end());
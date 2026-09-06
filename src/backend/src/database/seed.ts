import "dotenv/config";
import bcrypt from "bcryptjs";
import { query, withTransaction } from "./pool.js";
import { calculateQuotation, InputLine } from "../engines/quotation-engine.js";
import { addBillingPeriod } from "../engines/subscription-cycle-engine.js";

interface ProductRef {
  id: number;
  base_cost: number;
  name: string;
}

const pad = (n: number) => String(n).padStart(4, "0");

async function nextSeries(table: string, column: string): Promise<number> {
  const res = await query(
    `SELECT COALESCE(MAX((regexp_match(${column}, '-([0-9]+)$'))[1]::int), 0) AS max_n FROM ${table}`
  );
  return Number(res.rows[0].max_n) + 1;
}

async function getUnitPrice(client: any, customerId: number, productId: number): Promise<number> {
  const res = await client.query(
    `SELECT pli.unit_price
       FROM price_list_items pli
       JOIN price_lists pl ON pli.price_list_id = pl.id
      WHERE pl.customer_tier_id = (SELECT tier_id FROM customers WHERE id = $1)
        AND pl.currency_code = (SELECT currency_code FROM customers WHERE id = $1)
        AND pli.product_id = $2`,
    [customerId, productId]
  );
  if (res.rows.length > 0) return Number(res.rows[0].unit_price);
  const prod = await client.query(`SELECT base_cost FROM products WHERE id = $1`, [productId]);
  return Number(prod.rows[0].base_cost) * 1.5;
}

async function seedMore() {
  console.log("=========================================");
  console.log("   REVSYNC SUPPLEMENTAL DATA SEEDER       ");
  console.log("   (adds on top of existing data)         ");
  console.log("=========================================");

  await withTransaction(async (client) => {
    // ---- Reference data ------------------------------------------------
    const roles = (await client.query(`SELECT id, name FROM roles`)).rows;
    const roleId = (name: string) => roles.find((r) => r.name === name)!.id;
    const managerRoleId = roleId("Sales Manager");
    const financeRoleId = roleId("Finance");

    const users = (await client.query(`SELECT id, email FROM users`)).rows;
    const userId = (email: string) => users.find((u) => u.email === email)!.id;
    const salesRepId = userId("sales@revsync.com");
    const managerUserId = userId("manager@revsync.com");
    const financeUserId = userId("finance@revsync.com");

    const tiers = (await client.query(`SELECT id, name, discount_ceiling_pct FROM customer_tiers`)).rows;
    const tierId = (name: string) => tiers.find((t) => t.name === name)!.id;

    const products = (await client.query(`SELECT id, sku, name, base_cost FROM products`)).rows;
    const productRef: Record<string, ProductRef> = Object.fromEntries(
      products.map((p) => [p.sku, { id: p.id, base_cost: Number(p.base_cost), name: p.name }])
    );
    const variants = (await client.query(`SELECT id, sku FROM product_variants`)).rows;
    const variantRef: Record<string, number> = Object.fromEntries(
      variants.map((v) => [v.sku, v.id])
    );

    const warehouses = (await client.query(`SELECT id, code FROM warehouses ORDER BY id`)).rows;

    const nextQuoteNo = await nextSeries("quotations", "quotation_number");
    const nextInvoiceNo = await nextSeries("invoices", "invoice_number");
    const nextCnNo = await nextSeries("credit_notes", "credit_note_number");

    let qSeq = nextQuoteNo;
    let invSeq = nextInvoiceNo;
    let cnSeq = nextCnNo;

    // ---- 1. Customers --------------------------------------------------
    const customersToAdd = [
      { name: "Northwind Retail Group", email: "purchase@northwindretail.com", company: "Northwind Retail", phone: "+1 206 555 0142", tier: "Bronze", currency: "USD", type: "BUSINESS", po: 320000, terms: "NET_15", upfront: 0, creditLimit: 50000 },
      { name: "Blue Ocean Logistics", email: "supply@blueoceanlog.com", company: "Blue Ocean Logistics", phone: "+1 305 555 0139", tier: "Silver", currency: "USD", type: "BUSINESS", po: 880000, terms: "NET_30", upfront: 20, creditLimit: 150000 },
      { name: "Quantum Grid Energy", email: "procurement@quantumgrid.io", company: "Quantum Grid", phone: "+1 713 555 0177", tier: "Gold", currency: "USD", type: "ENTERPRISE", po: 4200000, terms: "NET_60", upfront: 30, creditLimit: 750000 },
      { name: "Meridian Bank Corp", email: "it.sourcing@meridian.bank", company: "Meridian Bank", phone: "+1 212 555 0121", tier: "Gold", currency: "USD", type: "ENTERPRISE", po: 6100000, terms: "NET_60", upfront: 40, creditLimit: 1200000 },
      { name: "Polaris Aviation Ltd", email: "ops@polarisaviation.co.uk", company: "Polaris Aviation", phone: "+44 20 7946 0831", tier: "Silver", currency: "GBP", type: "BUSINESS", po: 760000, terms: "NET_30", upfront: 25, creditLimit: 180000 },
      { name: "Vega E-Commerce GmbH", email: "tech@vega-ecommerce.de", company: "Vega E-Commerce", phone: "+49 89 2180 7733", tier: "Silver", currency: "EUR", type: "BUSINESS", po: 540000, terms: "NET_30", upfront: 10, creditLimit: 120000 },
      { name: "Helios Pharma AG", email: "pharma@helios.ch", company: "Helios Pharma", phone: "+41 44 555 0198", tier: "Gold", currency: "EUR", type: "ENTERPRISE", po: 3800000, terms: "NET_30", upfront: 50, creditLimit: 900000 },
      { name: "Sahara Foods Co", email: "buy@saharafoods.in", company: "Sahara Foods", phone: "+91 11 4652 3300", tier: "Bronze", currency: "INR", type: "BUSINESS", po: 180000, terms: "ADVANCE", upfront: 100, creditLimit: 100000 },
      { name: "Deccan Auto Works", email: "vendor@deccanauto.in", company: "Deccan Auto", phone: "+91 20 2426 8811", tier: "Bronze", currency: "INR", type: "BUSINESS", po: 95000, terms: "COD", upfront: 0, creditLimit: 40000 },
      { name: "Pacific Freight LLC", email: "fleet@pacificfreight.com", company: "Pacific Freight", phone: "+1 415 555 0160", tier: "Silver", currency: "USD", type: "BUSINESS", po: 690000, terms: "NET_30", upfront: 15, creditLimit: 160000 },
      { name: "Aurora Health Systems", email: "digital@aurorahealth.org", company: "Aurora Health", phone: "+1 646 555 0155", tier: "Gold", currency: "USD", type: "ENTERPRISE", po: 2700000, terms: "NET_30", upfront: 35, creditLimit: 600000 },
      { name: "Kite Retail Chain", email: "stores@kiteretail.in", company: "Kite Retail", phone: "+91 80 4211 9090", tier: "Silver", currency: "INR", type: "BUSINESS", po: 520000, terms: "NET_15", upfront: 10, creditLimit: 95000 },
    ];

    const customerId: Record<string, number> = {};
    for (const c of customersToAdd) {
      const t = tierId(c.tier);
      const res = await client.query(
        `INSERT INTO customers
          (name, email, company, phone, tier_id, status, currency_code, customer_type,
           expected_po_value, payment_terms, upfront_payment_pct, billing_address, shipping_address,
           credit_limit, calculated_tier_id)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11,$12,$13,$5) RETURNING id`,
        [
          c.name, c.email, c.company, c.phone, t, c.currency, c.type, c.po, c.terms, c.upfront,
          `88 ${c.company} Blvd, Suite 400`, `C/O ${c.company}, 12 Harbour Street`,
          c.creditLimit,
        ]
      );
      const cid = Number(res.rows[0].id);
      customerId[c.name] = cid;

      await client.query(
        `INSERT INTO customer_tier_evaluations
          (customer_id, status, recommended_tier, resolved_tier, input_snapshot, matched_rules, action_by, reason)
         VALUES ($1,'CONFIRMED',$2,$2,$3,$4,$5,$6)`,
        [
          cid, c.tier.toUpperCase(),
          JSON.stringify({ customer_type: c.type, expected_po_value: c.po, upfront_payment_pct: c.upfront, payment_terms: c.terms }),
          JSON.stringify([{ rule_id: 1, rule_name: "Reference determination", target_tier: c.tier.toUpperCase() }]),
          managerUserId, `Bulk demo load — tier confirmed by policy`,
        ]
      );
      console.log(`  ✓ Customer: ${c.name} [${c.tier} / ${c.currency}]`);
    }

    // Existing customers reused by scenarios
    const existingCustomers = (await client.query(`SELECT id, name FROM customers WHERE name IN ('Acme Corp','Titan Industries')`)).rows;
    customerId["Acme Corp"] = existingCustomers.find((c) => c.name === "Acme Corp")!.id;
    customerId["Titan Industries"] = existingCustomers.find((c) => c.name === "Titan Industries")!.id;

    // ---- 2. Quotations --------------------------------------------------
    type LineDef = { sku: string; vSku?: string; qty: number; discPct: number };
    type QuoteDef = {
      cust: string; status: string; notes: string; orderDisc: number; risk?: string; overage?: number;
      lines: LineDef[];
    };

    const quoteDefs: QuoteDef[] = [
      // CONFIRMED -> fulfillment (+ some invoiced below)
      { cust: "Acme Corp", status: "CONFIRMED", orderDisc: 4, risk: "LOW", overage: 0, notes: "Q3 capacity expansion — confirmed at negotiated terms.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 4, discPct: 6 }, { sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 2, discPct: 3 }] },
      { cust: "Titan Industries", status: "CONFIRMED", orderDisc: 0, risk: "LOW", overage: 0, notes: "Additional cloud capacity roll-out.", lines: [{ sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 3, discPct: 0 }] },
      { cust: "Northwind Retail Group", status: "CONFIRMED", orderDisc: 2, risk: "LOW", overage: 0, notes: "POS + gateway refresh for 8 stores.", lines: [{ sku: "HW-GATEWAY-001", vSku: "HW-GATEWAY-001-VAR1", qty: 12, discPct: 4 }, { sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 1, discPct: 2 }] },
      { cust: "Blue Ocean Logistics", status: "CONFIRMED", orderDisc: 3, risk: "MEDIUM", overage: 2, notes: "Global fleet tracking rollout phase 1.", lines: [{ sku: "HW-GATEWAY-001", vSku: "HW-GATEWAY-001-VAR1", qty: 25, discPct: 8 }, { sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 1, discPct: 5 }] },
      { cust: "Quantum Grid Energy", status: "CONFIRMED", orderDisc: 5, risk: "LOW", overage: 0, notes: "Enterprise ERP suite for energy trading desks.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 8, discPct: 8 }, { sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 3, discPct: 4 }] },
      // APPROVED
      { cust: "Meridian Bank Corp", status: "APPROVED", orderDisc: 2, risk: "LOW", overage: 0, notes: "Core platform licensing for digital banking unit.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 6, discPct: 6 }] },
      { cust: "Polaris Aviation Ltd", status: "APPROVED", orderDisc: 1, risk: "MEDIUM", overage: 1, notes: "Maintenance support + gateway hardware.", lines: [{ sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 4, discPct: 9 }, { sku: "HW-GATEWAY-001", vSku: "HW-GATEWAY-001-VAR1", qty: 10, discPct: 6 }] },
      { cust: "Helios Pharma AG", status: "APPROVED", orderDisc: 3, risk: "LOW", overage: 0, notes: "Regulated-environment platform instance.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 3, discPct: 10 }] },
      // PENDING_APPROVAL
      { cust: "Vega E-Commerce GmbH", status: "PENDING_APPROVAL", orderDisc: 6, risk: "HIGH", overage: 11, notes: "Aggressive Q4 acquisition pricing requested.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 2, discPct: 22 }, { sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 1, discPct: 15 }] },
      { cust: "Sahara Foods Co", status: "PENDING_APPROVAL", orderDisc: 4, risk: "MEDIUM", overage: 6, notes: "Co-op chain deployment, discount over ceiling.", lines: [{ sku: "HW-GATEWAY-001", vSku: "HW-GATEWAY-001-VAR1", qty: 40, discPct: 10 }] },
      { cust: "Titan Industries", status: "PENDING_APPROVAL", orderDisc: 2, risk: "LOW", overage: 3, notes: "Renewal package; awaiting finance sign-off.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 2, discPct: 12 }] },
      { cust: "Pacific Freight LLC", status: "PENDING_APPROVAL", orderDisc: 5, risk: "HIGH", overage: 13, notes: "Fleet-wide hardware refresh at deep discount.", lines: [{ sku: "HW-GATEWAY-001", vSku: "HW-GATEWAY-001-VAR1", qty: 60, discPct: 18 }, { sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 2, discPct: 12 }] },
      // REJECTED
      { cust: "Kite Retail Chain", status: "REJECTED", orderDisc: 8, risk: "HIGH", overage: 18, notes: "Requested 30% off — rejected, margin non-viable.", lines: [{ sku: "HW-GATEWAY-001", vSku: "HW-GATEWAY-001-VAR1", qty: 30, discPct: 30 }] },
      { cust: "Deccan Auto Works", status: "REJECTED", orderDisc: 6, risk: "MEDIUM", overage: 9, notes: "Prototype deal rejected by management.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 1, discPct: 18 }] },
      // NEGOTIATION
      { cust: "Aurora Health Systems", status: "NEGOTIATION", orderDisc: 3, risk: "MEDIUM", overage: 2, notes: "Customer counter-offered on premium support.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 4, discPct: 12 }, { sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 2, discPct: 8 }] },
      { cust: "Helios Pharma AG", status: "NEGOTIATION", orderDisc: 2, risk: "LOW", overage: 0, notes: "Negotiating delivery timeline for gateway units.", lines: [{ sku: "HW-GATEWAY-001", vSku: "HW-GATEWAY-001-VAR1", qty: 15, discPct: 5 }] },
      { cust: "Blue Ocean Logistics", status: "NEGOTIATION", orderDisc: 4, risk: "MEDIUM", overage: 4, notes: "Second round — payment terms under discussion.", lines: [{ sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 5, discPct: 10 }] },
      // DRAFT
      { cust: "Meridian Bank Corp", status: "DRAFT", orderDisc: 0, risk: "LOW", overage: 0, notes: "Q1 draft — business continuity add-on.", lines: [{ sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 2, discPct: 4 }] },
      { cust: "Polaris Aviation Ltd", status: "DRAFT", orderDisc: 0, risk: "LOW", overage: 0, notes: "Uplift draft for additional hangars.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 2, discPct: 0 }] },
      { cust: "Aurora Health Systems", status: "DRAFT", orderDisc: 1, risk: "LOW", overage: 0, notes: "Scoping new regional offices.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 3, discPct: 5 }, { sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 1, discPct: 2 }] },
      { cust: "Vega E-Commerce GmbH", status: "DRAFT", orderDisc: 2, risk: "LOW", overage: 0, notes: "Spring campaign capacity planning.", lines: [{ sku: "HW-GATEWAY-001", vSku: "HW-GATEWAY-001-VAR1", qty: 20, discPct: 6 }] },
      { cust: "Sahara Foods Co", status: "DRAFT", orderDisc: 0, risk: "LOW", overage: 0, notes: "Initial quotes for new warehouses.", lines: [{ sku: "CS-SUPP-001", vSku: "CS-SUPP-001-VAR1", qty: 2, discPct: 2 }] },
      // CANCELLED
      { cust: "Deccan Auto Works", status: "CANCELLED", orderDisc: 3, risk: "LOW", overage: 0, notes: "Customer put purchase on hold.", lines: [{ sku: "HW-GATEWAY-001", vSku: "HW-GATEWAY-001-VAR1", qty: 8, discPct: 5 }] },
      { cust: "Pacific Freight LLC", status: "CANCELLED", orderDisc: 2, risk: "LOW", overage: 0, notes: "Superseded by revised fleet proposal.", lines: [{ sku: "SW-ENT-001", vSku: "SW-ENT-001-VAR1", qty: 1, discPct: 7 }] },
    ];

    const savedQuotes: {
      id: number;
      cust: string;
      status: string;
      currency: string;
      grand: number;
      subtotal: number;
      discount: number;
      tax: number;
      lines: { id: number; productId: number; qty: number; unitPrice: number; discPct: number; lineSubtotal: number; lineTotal: number; lineCost: number; lineMargin: number; sku: string; name: string }[];
      overage: number;
      risk: string;
    }[] = [];

    const lineIdsByQuote: Record<string, number[]> = {};

    for (const qd of quoteDefs) {
      const custId = customerId[qd.cust];
      const cRes = await client.query(`SELECT currency_code FROM customers WHERE id = $1`, [custId]);
      const currency = cRes.rows[0].currency_code;
      const qNumber = `QT-2026-${pad(qSeq++)}`;

      const inputLines: InputLine[] = [];
      const lineVariantIds: (number | null)[] = [];
      for (const l of qd.lines) {
        const prod = productRef[l.sku];
        const unitPrice = await getUnitPrice(client, custId, prod.id);
        const vId = l.vSku ? variantRef[l.vSku] ?? null : null;
        inputLines.push({
          product_id: prod.id,
          product_variant_id: vId,
          description: prod.name,
          quantity: l.qty,
          unit_price: unitPrice,
          unit_cost: prod.base_cost,
          applied_discount_pct: l.discPct,
        });
        lineVariantIds.push(vId);
      }

      // Discount overage relative to the customer tier's ceiling.
      const tierRes = await client.query(
        `SELECT ct.discount_ceiling_pct FROM customers c JOIN customer_tiers ct ON ct.id = c.tier_id WHERE c.id = $1`,
        [custId]
      );
      const ceiling = Number(tierRes.rows[0].discount_ceiling_pct);
      const appliedDisc = Math.max(0, ...inputLines.map((l) => l.applied_discount_pct));
      const overage = qd.overage ?? Math.max(0, Math.round((appliedDisc - ceiling) * 10) / 10);

      const calc = calculateQuotation(inputLines, 10.0, qd.orderDisc);
      const risk = qd.risk ?? (overage >= 10 ? "HIGH" : overage >= 5 ? "MEDIUM" : "LOW");

      const qRes = await client.query(
        `INSERT INTO quotations
          (quotation_number, customer_id, sales_rep_id, currency_code, status,
           subtotal, discount_total, order_discount_pct, order_discount_amount, tax_rate_pct, tax_total,
           grand_total, total_cost, margin_amount, margin_pct, total_overage, risk_level, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [
          qNumber, custId, salesRepId, currency, qd.status,
          calc.subtotal, calc.discount_total, calc.order_discount_pct, calc.order_discount_amount,
          calc.tax_rate_pct, calc.tax_total, calc.grand_total, calc.total_cost, calc.margin_amount,
          calc.margin_pct, overage, risk, qd.notes,
        ]
      );
      const qId = Number(qRes.rows[0].id);

      const lineIds: number[] = [];
      const savedLines: any[] = [];
      for (let idx = 0; idx < calc.lines.length; idx++) {
        const l = calc.lines[idx];
        const ln = await client.query(
          `INSERT INTO quotation_lines
            (quotation_id, product_id, product_variant_id, description, quantity, unit_price, unit_cost,
             applied_discount_pct, discount_amount, line_subtotal, line_total, line_cost, line_margin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [qId, l.product_id, l.product_variant_id ?? null, l.description, l.quantity, l.unit_price,
           l.unit_cost, l.applied_discount_pct, l.discount_amount, l.line_subtotal, l.line_total,
           l.line_cost, l.line_margin]
        );
        const llId = Number(ln.rows[0].id);
        lineIds.push(llId);
        savedLines.push({
          id: llId, productId: l.product_id, qty: l.quantity, unitPrice: l.unit_price,
          discPct: l.applied_discount_pct, lineSubtotal: l.line_subtotal, lineTotal: l.line_total,
          lineCost: l.line_cost, lineMargin: l.line_margin,
          sku: qd.lines[idx].sku, name: productRef[qd.lines[idx].sku].name,
        });
      }
      lineIdsByQuote[qNumber] = lineIds;
      savedQuotes.push({
        id: qId, cust: qd.cust, status: qd.status, currency, grand: Number(calc.grand_total),
        subtotal: Number(calc.subtotal), discount: Number(calc.discount_total), tax: Number(calc.tax_total),
        lines: savedLines, overage, risk,
      });
      console.log(`  ✓ Quote ${qNumber} [${qd.status}] ${qd.cust} — ${Number(calc.grand_total).toFixed(2)} ${currency}`);
    }

    const numOf = (status: string) => savedQuotes.filter((q) => q.status === status);

    // ---- 3. Approvals --------------------------------------------------
    for (const q of savedQuotes.filter((x) => ["PENDING_APPROVAL", "APPROVED", "REJECTED"].includes(x.status))) {
      const reqStatus = q.status === "PENDING_APPROVAL" ? "PENDING_APPROVAL" : q.status;
      const appRes = await client.query(
        `INSERT INTO approval_requests (quotation_id, status, risk_level, total_overage, submitted_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [q.id, reqStatus, q.status === "APPROVED" ? "LOW" : q.status === "REJECTED" ? "HIGH" : "MEDIUM", q.overage, salesRepId, "Bulk demo approval"]
      );
      const reqId = Number(appRes.rows[0].id);

      if (q.status === "PENDING_APPROVAL") {
        await client.query(
          `INSERT INTO approval_steps (approval_request_id, sequence, role_id, status)
           VALUES ($1,1,$2,'PENDING'), ($1,2,$3,'PENDING')`,
          [reqId, managerRoleId, financeRoleId]
        );
      } else if (q.status === "APPROVED") {
        await client.query(
          `INSERT INTO approval_steps (approval_request_id, sequence, role_id, status, decided_by, decided_at, notes)
           VALUES ($1,1,$2,'APPROVED',$3,NOW(),'Within ceiling — approved.')`,
          [reqId, managerRoleId, managerUserId]
        );
        await client.query(`UPDATE approval_requests SET decided_by=$1, decided_at=NOW() WHERE id=$2`, [managerUserId, reqId]);
      } else {
        await client.query(
          `INSERT INTO approval_steps (approval_request_id, sequence, role_id, status, decided_by, decided_at, notes)
           VALUES ($1,1,$2,'REJECTED',$3,NOW(),'Margin not viable.')`,
          [reqId, managerRoleId, managerUserId]
        );
        await client.query(`UPDATE approval_requests SET decided_by=$1, decided_at=NOW() WHERE id=$2`, [managerUserId, reqId]);
      }
    }
    console.log(`  ✓ Approval requests created for ${numOf("PENDING_APPROVAL").length + numOf("APPROVED").length + numOf("REJECTED").length} quotations`);

    // ---- 4. Negotiations -----------------------------------------------
    const negotiationQuoteNames = ["Aurora Health Systems", "Helios Pharma AG", "Blue Ocean Logistics"];
    for (const name of negotiationQuoteNames) {
      const q = savedQuotes.find((x) => x.cust === name && x.status === "NEGOTIATION")!;
      const negRes = await client.query(
        `INSERT INTO negotiations (quotation_id, status) VALUES ($1,'OPEN') RETURNING id`,
        [q.id]
      );
      const negId = Number(negRes.rows[0].id);
      const firstLine = q.lines[0];

      await client.query(
        `INSERT INTO negotiation_messages (negotiation_id, sender_type, body, created_at)
         VALUES ($1,'CUSTOMER', $2, NOW() - INTERVAL '4 days'),
                ($1,'SALES',   $3, NOW() - INTERVAL '3 days'),
                ($1,'CUSTOMER', $4, NOW() - INTERVAL '1 day')`,
        [negId,
         "We reviewed the proposal — can you improve the pricing on the main line?",
         "Happy to work with you. We can revisit the discount and see what is available.",
         "Please revise the terms as discussed."]
      );

      // DISCOUNT request requires quotation_line_id
      await client.query(
        `INSERT INTO negotiation_requests
          (negotiation_id, quotation_line_id, request_type, status, original_value, requested_value,
           requested_by_customer, resolved_at)
         VALUES ($1,$2,'DISCOUNT','PENDING','10','15',true,NULL)`,
        [negId, firstLine.id]
      );
      if (q.lines[1]) {
        await client.query(
          `INSERT INTO negotiation_requests
            (negotiation_id, quotation_line_id, request_type, status, original_value, requested_value,
             requested_by_customer, resolved_at)
           VALUES ($1,$2,'TERMS','PENDING','NET_30','NET_60',true,NULL)`,
          [negId, null]
        );
      }
      console.log(`  ✓ Negotiation channel opened — ${name}`);
    }

    // ---- 5. Fulfillment -------------------------------------------------
    const confirmed = numOf("CONFIRMED");
    const foStatuses: { status: string; backordered: number; ship: boolean; allocFactor: number }[] = [
      { status: "SHIPPED", backordered: 0, ship: true, allocFactor: 1 },
      { status: "ALLOCATED", backordered: 0, ship: false, allocFactor: 1 },
      { status: "PARTIAL", backordered: 4, ship: false, allocFactor: 0.7 },
      { status: "ALLOCATED", backordered: 0, ship: false, allocFactor: 1 },
      { status: "BACKORDERED", backordered: 10, ship: false, allocFactor: 0.4 },
    ];

    const newFoIds: number[] = [];
    const newQuoteToFo: Record<number, number> = {};

    for (let i = 0; i < confirmed.length; i++) {
      const q = confirmed[i];
      const w = warehouses[i % warehouses.length];
      const fo = foStatuses[i % foStatuses.length];
      const shippedAt = fo.ship ? "NOW() - INTERVAL '2 days'" : "NULL";

      const foRes = await client.query(
        `INSERT INTO fulfillment_orders
          (quotation_id, status, shipping_cost, backordered_quantity, shipped_at, created_by, notes)
         VALUES ($1,$2,$3,$4,${shippedAt},$5,$6) RETURNING id`,
        [q.id, fo.status, 15.0, fo.backordered, salesRepId, `Bulk demo — ${fo.status.toLowerCase()}`]
      );
      const foId = Number(foRes.rows[0].id);
      newFoIds.push(foId);
      newQuoteToFo[q.id] = foId;

      for (const l of q.lines) {
        const allocQty = Math.max(0, Math.round(l.qty * fo.allocFactor) || l.qty);
        await client.query(
          `INSERT INTO fulfillment_allocations
            (fulfillment_order_id, quotation_line_id, product_id, warehouse_id, quantity, unit_shipping_cost)
           VALUES ($1,$2,$3,$4,$5,4.0)`,
          [foId, l.id, l.productId, w.id, allocQty]
        );
      }
      console.log(`  ✓ Fulfillment FO-${pad(foId)} [${fo.status}] for ${q.cust}`);
    }

    // ---- 6. Invoices ----------------------------------------------------
    const invoicedQuotes = confirmed.slice(0, 5); // 5 one-time invoices

    const invoiceData: {
      q: any;
      status: string;
      payments: { ref: string; amount: number; method: string; daysAgo: number; notes: string }[];
    }[] = [
      { q: invoicedQuotes[0], status: "PAID", payments: [{ ref: `TXN-${pad(invSeq * 10 + 1)}`, amount: invoicedQuotes[0].grand / 2, method: "BANK_TRANSFER", daysAgo: 18, notes: "Advance 50%" }, { ref: `TXN-${pad(invSeq * 10 + 2)}`, amount: invoicedQuotes[0].grand / 2, method: "CREDIT_WALLET", daysAgo: 3, notes: "Wallet offset" }] },
      { q: invoicedQuotes[1], status: "PARTIALLY_PAID", payments: [{ ref: `TXN-${pad(invSeq * 10 + 3)}`, amount: invoicedQuotes[1].grand * 0.4, method: "CARD", daysAgo: 6, notes: "Partial card payment" }] },
      { q: invoicedQuotes[2], status: "ISSUED", payments: [] },
      { q: invoicedQuotes[3], status: "ISSUED", payments: [] },
      { q: invoicedQuotes[4], status: "PAID", payments: [{ ref: `TXN-${pad(invSeq * 10 + 4)}`, amount: invoicedQuotes[4].grand, method: "BANK_TRANSFER", daysAgo: 10, notes: "Full settlement" }] },
    ];

    const savedInvoiceIdByQuote: Record<number, number> = {};

    for (const inv of invoiceData) {
      const q = inv.q;
      const cust = customerId[q.cust];
      const invNum = `INV-2026-${pad(invSeq++)}`;
      const invRes = await client.query(
        `INSERT INTO invoices
          (invoice_number, quotation_id, customer_id, currency_code, status,
           issue_date, due_date, subtotal, discount_total, order_discount_pct, order_discount_amount,
           tax_rate_pct, tax_total, grand_total, total_paid, notes)
         VALUES ($1,$2,$3,$4,$5,NOW() - INTERVAL '24 days', NOW() + INTERVAL '6 days',
                 $6,$7,0,0,$8,$9,$10,0,$11) RETURNING id`,
        [invNum, q.id, cust, q.currency, inv.status, q.subtotal, q.discount, 10.0, q.tax, q.grand, `Invoiced from ${q.id}`]
      );
      const invId = Number(invRes.rows[0].id);
      savedInvoiceIdByQuote[q.id] = invId;

      for (const l of q.lines) {
        await client.query(
          `INSERT INTO invoice_lines
            (invoice_id, quotation_line_id, product_id, product_name, sku, description, quantity,
             unit_price, applied_discount_pct, discount_amount, line_subtotal, line_total,
             unit_cost, line_cost, line_margin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [invId, l.id, l.productId, l.name, l.sku, l.name, l.qty,
           l.unitPrice, l.discPct, 0, l.lineSubtotal, l.lineTotal,
           0, 0, l.lineMargin]
        );
      }

      let paid = 0;
      for (const p of inv.payments) {
        await client.query(
          `INSERT INTO invoice_payments
            (invoice_id, reference, amount_paid, payment_date, payment_method, received_by, notes)
           VALUES ($1,$2,$3, NOW() - INTERVAL '${p.daysAgo} days', $4, $5, $6)`,
          [invId, p.ref, p.amount, p.method, financeUserId, p.notes]
        );
        paid += p.amount;
      }
      if (paid > 0) {
        await client.query(`UPDATE invoices SET total_paid = $1 WHERE id = $2`, [paid, invId]);
      }
      console.log(`  ✓ Invoice ${invNum} [${inv.status}] ${q.cust} — ${q.grand.toFixed(2)} ${q.currency}`);
    }

    // ---- 7. Subscriptions ----------------------------------------------
    const subDefs = [
      { cust: "Acme Corp", plan: 2, productSku: "SW-ENT-001", qty: 3, status: "ACTIVE", months: 4 },
      { cust: "Titan Industries", plan: 1, productSku: "CS-SUPP-001", qty: 2, status: "ACTIVE", months: 6 },
      { cust: "Northwind Retail Group", plan: 2, productSku: "SW-ENT-001", qty: 1, status: "ACTIVE", months: 2 },
      { cust: "Blue Ocean Logistics", plan: 1, productSku: "CS-SUPP-001", qty: 4, status: "PAUSED", months: 3 },
      { cust: "Quantum Grid Energy", plan: 2, productSku: "SW-ENT-001", qty: 5, status: "ACTIVE", months: 7 },
      { cust: "Meridian Bank Corp", plan: 2, productSku: "SW-ENT-001", qty: 2, status: "CANCELLED", months: 9 },
      { cust: "Aurora Health Systems", plan: 1, productSku: "CS-SUPP-001", qty: 3, status: "ACTIVE", months: 1 },
      { cust: "Kite Retail Chain", plan: 2, productSku: "SW-ENT-001", qty: 1, status: "EXPIRED", months: 12 },
    ];

    const planPrices: Record<number, number> = {};
    const plans = (await client.query(`SELECT id, price, billing_cycle FROM subscription_plans`)).rows;
    for (const pl of plans) {
      planPrices[pl.id] = Number(pl.price);
    }

    const savedSubscriptions: { id: number; cust: string; planId: number; qty: number; productId: number }[] = [];

    for (const sd of subDefs) {
      const custId = customerId[sd.cust];
      const periodStart = new Date();
      const periodEnd = addBillingPeriod(periodStart, "MONTHLY");
      const nextBilling = new Date(periodEnd);
      const endDate =
        sd.status === "CANCELLED" || sd.status === "EXPIRED"
          ? new Date(periodStart.getTime() + sd.months * 30 * 86400000)
          : null;

      const subRes = await client.query(
        `INSERT INTO subscriptions
          (customer_id, product_id, subscription_plan_id, status, quantity, unit_price, currency,
           start_date, end_date, current_period_start, current_period_end, next_billing_date)
         VALUES ($1,$2,$3,$4,$5,$6,'USD',NOW(),$7,NOW(),$8,$9) RETURNING id`,
        [custId, productRef[sd.productSku].id, sd.plan, sd.status, sd.qty, planPrices[sd.plan],
         endDate, periodEnd.toISOString(), nextBilling.toISOString()]
      );
      const subId = Number(subRes.rows[0].id);
      savedSubscriptions.push({ id: subId, cust: sd.cust, planId: sd.plan, qty: sd.qty, productId: productRef[sd.productSku].id });

      // Billing schedules for the next 2 periods
      const schedStatuses: string[] =
        sd.status === "ACTIVE"
          ? ["GENERATED", "UPCOMING"]
          : sd.status === "PAUSED"
            ? ["UPCOMING", "UPCOMING"]
            : ["CANCELLED", "CANCELLED"];
      for (let s = 0; s < 2; s++) {
        const offsetStart = new Date();
        offsetStart.setMonth(offsetStart.getMonth() + s);
        const bStart = addBillingPeriod(offsetStart, "MONTHLY");
        const bEnd = addBillingPeriod(bStart, "MONTHLY");
        await client.query(
          `INSERT INTO billing_schedules
            (subscription_id, billing_date, period_start, period_end, amount, status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [subId, bStart.toISOString(), bStart.toISOString(), bEnd.toISOString(), planPrices[sd.plan] * sd.qty, schedStatuses[s]]
        );
      }
      console.log(`  ✓ Subscription SUB-${pad(subId)} [${sd.status}] ${sd.cust}`);
    }

    // Subscription changes (proration history)
    const acmeSub = savedSubscriptions.find((s) => s.cust === "Acme Corp")!;
    const titanSub = savedSubscriptions.find((s) => s.cust === "Titan Industries")!;
    await client.query(
      `INSERT INTO subscription_changes
        (subscription_id, change_type, old_quantity, new_quantity, effective_date,
         old_period_value, new_period_value, remaining_days, period_days, proration_amount)
       VALUES ($1,'QUANTITY_INCREASE',2,3,NOW() - INTERVAL '10 days',3600,5400,20,30,1200.00),
              ($2,'QUANTITY_INCREASE',1,2,NOW() - INTERVAL '5 days',600,1200,25,30,500.00)`,
      [acmeSub.id, titanSub.id]
    );

    // ---- 8. Credit Wallets + transactions -------------------------------
    const walletSources: { cust: string; balance: number; txs: { type: string; amount: number; desc: string; refType?: string | null; refId?: number }[] }[] = [
      { cust: "Acme Corp", balance: 0, txs: [{ type: "INVOICE_OFFSET", amount: -1950, desc: "Applied to INV", refType: "invoice" }] },
      { cust: "Meridian Bank Corp", balance: 3600, txs: [{ type: "CANCELLATION_CREDIT", amount: 3600, desc: "Unused prepaid from cancelled subscription" }, { type: "MANUAL_ADJUSTMENT", amount: 400, desc: "Goodwill credit", refType: null }] },
      { cust: "Quantum Grid Energy", balance: 0, txs: [] },
      { cust: "Aurora Health Systems", balance: 2400, txs: [{ type: "CANCELLATION_CREDIT", amount: 2400, desc: "Unused prepaid credit" }] },
      { cust: "Kite Retail Chain", balance: 0, txs: [] },
    ];

    const existingWallets = new Set(
      (await client.query(`SELECT customer_id FROM customer_credit_wallets`)).rows.map((r) => Number(r.customer_id))
    );

    for (const ws of walletSources) {
      const custId = customerId[ws.cust];
      if (existingWallets.has(custId)) {
        console.log(`  ✓ Wallet for ${ws.cust} — already exists, skipped`);
        continue;
      }
      existingWallets.add(custId);
      const walletRes = await client.query(
        `INSERT INTO customer_credit_wallets (customer_id, balance, currency)
         VALUES ($1,$2,'USD') RETURNING id`,
        [custId, ws.balance]
      );
      const walletId = Number(walletRes.rows[0].id);
      for (const t of ws.txs) {
        await client.query(
          `INSERT INTO credit_transactions
            (wallet_id, type, amount, reference_type, reference_id, description)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [walletId, t.type, t.amount, t.refType ?? null, t.refId ?? null, t.desc]
        );
      }
      console.log(`  ✓ Wallet for ${ws.cust} — balance ${ws.balance}`);
    }

    // ---- 9. Deal health snapshots ----------------------------------------
    const snapshotTargets = savedQuotes.filter((q) =>
      ["DRAFT", "PENDING_APPROVAL", "APPROVED", "NEGOTIATION"].includes(q.status)
    );
    const healthByStatus: Record<string, { status: string; score: number; signals: any[] }> = {
      DRAFT: { status: "HEALTHY", score: 92, signals: [{ key: "STALLED_QUOTE", severity: 0.05, enabled: true }] },
      PENDING_APPROVAL: { status: "AT_RISK", score: 55, signals: [{ key: "APPROVAL_DELAY", severity: 0.6, enabled: true }, { key: "HIGH_DISCOUNT_RISK", severity: 0.4, enabled: true }] },
      APPROVED: { status: "HEALTHY", score: 78, signals: [{ key: "STALLED_QUOTE", severity: 0.2, enabled: true }] },
      NEGOTIATION: { status: "AT_RISK", score: 45, signals: [{ key: "NEGOTIATION_STALL", severity: 0.55, enabled: true }, { key: "HIGH_DISCOUNT_RISK", severity: 0.3, enabled: true }] },
    };

    for (const q of snapshotTargets) {
      const custId = customerId[q.cust];
      const h = healthByStatus[q.status];
      await client.query(
        `INSERT INTO deal_health_snapshots
          (quotation_id, customer_id, sales_rep_id, status, score, signals, computed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [q.id, custId, salesRepId, h.status, h.score, JSON.stringify(h.signals), managerUserId]
      );
    }
    console.log(`  ✓ ${snapshotTargets.length} deal-health snapshots for open deals`);

    // ---- 10. Credit notes ------------------------------------------------
    for (const q of [confirmed[2], confirmed[3]]) {
      const invId = savedInvoiceIdByQuote[q.id];
      const cnNum = `CN-2026-${pad(cnSeq++)}`;
      await client.query(
        `INSERT INTO credit_notes
          (credit_note_number, invoice_id, customer_id, currency_code, amount, reason, status)
         VALUES ($1,$2,$3,$4,$5,$6,'ISSUED')`,
        [cnNum, invId, customerId[q.cust], q.currency, Math.round(q.grand * 0.05 * 100) / 100, "Volume rebate adjustment"]
      );
    }
    console.log("  ✓ Credit notes issued for volume rebates");

    console.log("\n=========================================");
    console.log("   SUPPLEMENTAL SEED COMPLETE            ");
    console.log(`   Quotes added:   ${savedQuotes.length}`);
    console.log(`   Orders added:   ${newFoIds.length}`);
    console.log("=========================================");
  });
}

async function seed() {
  console.log("=========================================");
  console.log("       REVSYNC DATABASE SEEDER           ");
  console.log("=========================================");
  console.log("Wiping all existing database tables...");

  // 1. Clean Reset - Truncate all tables in cascade mode
  await query(`
    TRUNCATE TABLE 
      deal_health_snapshots,
      deal_health_signal_config,
      credit_transactions,
      customer_credit_wallets,
      billing_schedules,
      subscription_changes,
      subscriptions,
      subscription_plans,
      credit_notes,
      invoice_payments,
      invoice_lines,
      invoices,
      fulfillment_allocations,
      fulfillment_orders,
      inventory_items,
      negotiation_requests,
      negotiation_messages,
      negotiations,
      approval_steps,
      approval_requests,
      customer_tier_evaluations,
      audit_logs,
      quotation_lines,
      quotations,
      price_list_items,
      price_lists,
      product_relationships,
      product_variants,
      products,
      categories,
      customers,
      customer_tier_rules,
      discount_rules,
      approval_rules,
      warehouses,
      users,
      customer_tiers,
      roles,
      currencies,
      exchange_rates
    RESTART IDENTITY CASCADE;
  `);

  console.log("✓ Database wiped clean.");

  // 2. Roles
  console.log("\n[1/12] Seeding Roles & Users...");
  const roles = [
    { name: "Sales Representative", description: "Build quotations, apply discounts, track fulfillment" },
    { name: "Sales Manager", description: "Review/approve/reject quotations, configure policy" },
    { name: "Finance", description: "Invoicing, payment reconciliation, credit notes" },
    { name: "Warehouse Manager", description: "Inventory, fulfillment allocation, backorders" },
    { name: "Admin", description: "System configuration, products, pricing, currencies" },
  ];

  const roleMap = new Map<string, number>();
  for (const r of roles) {
    const res = await query(
      `INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id, name`,
      [r.name, r.description]
    );
    roleMap.set(r.name, Number(res.rows[0].id));
  }

  // Password Hash for 'Password123!'
  const passwordHash = await bcrypt.hash("Password123!", 10);

  const usersToSeed = [
    { email: "admin@revsync.com", first_name: "System", last_name: "Admin", role_name: "Admin" },
    { email: "admin.user@revsync.com", first_name: "Admin", last_name: "User", role_name: "Admin" },
    { email: "manager@revsync.com", first_name: "Sarah", last_name: "Manager", role_name: "Sales Manager" },
    { email: "sales@revsync.com", first_name: "Alex", last_name: "Salesrep", role_name: "Sales Representative" },
    { email: "finance@revsync.com", first_name: "Fiona", last_name: "Finance", role_name: "Finance" },
    { email: "warehouse@revsync.com", first_name: "Will", last_name: "Warehouse", role_name: "Warehouse Manager" },
  ];

  const userMap = new Map<string, number>();
  for (const u of usersToSeed) {
    const roleId = roleMap.get(u.role_name)!;
    const res = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [u.email, passwordHash, u.first_name, u.last_name, roleId]
    );
    userMap.set(u.email, Number(res.rows[0].id));
    console.log(`  ✓ Seeded User: ${u.email} (${u.role_name})`);
  }

  // 3. Currencies & Exchange Rates
  console.log("\n[2/12] Seeding Currencies & Rates...");
  const currencies = [
    { code: "USD", name: "US Dollar", symbol: "$" },
    { code: "EUR", name: "Euro", symbol: "€" },
    { code: "GBP", name: "British Pound", symbol: "£" },
    { code: "INR", name: "Indian Rupee", symbol: "₹" },
  ];

  for (const c of currencies) {
    await query(
      `INSERT INTO currencies (code, name, symbol, is_active) VALUES ($1, $2, $3, true)`,
      [c.code, c.name, c.symbol]
    );
  }

  const exchangeRates = [
    { from: "USD", to: "USD", rate: 1.0 },
    { from: "USD", to: "EUR", rate: 0.92 },
    { from: "USD", to: "GBP", rate: 0.79 },
    { from: "USD", to: "INR", rate: 83.50 },
    { from: "EUR", to: "USD", rate: 1.087 },
    { from: "GBP", to: "USD", rate: 1.265 },
    { from: "INR", to: "USD", rate: 0.012 },
  ];

  for (const er of exchangeRates) {
    await query(
      `INSERT INTO exchange_rates (from_currency_code, to_currency_code, rate) VALUES ($1, $2, $3)`,
      [er.from, er.to, er.rate]
    );
  }
  console.log("  ✓ Seeded Currencies & Exchange Rates");

  // 4. Customer Tiers
  console.log("\n[3/12] Seeding Customer Tiers...");
  const tiers = [
    { name: "Bronze", description: "Entry-level customer tier", discount_ceiling_pct: 5.00 },
    { name: "Silver", description: "Mid-level corporate customer tier", discount_ceiling_pct: 10.00 },
    { name: "Gold", description: "Enterprise strategic partner tier", discount_ceiling_pct: 15.00 },
  ];

  const tierMap = new Map<string, number>();
  for (const t of tiers) {
    const res = await query(
      `INSERT INTO customer_tiers (name, description, discount_ceiling_pct) VALUES ($1, $2, $3) RETURNING id`,
      [t.name, t.description, t.discount_ceiling_pct]
    );
    tierMap.set(t.name, Number(res.rows[0].id));
    console.log(`  ✓ Tier ${t.name} (Max Discount: ${t.discount_ceiling_pct}%)`);
  }

  // 5. Categories
  console.log("\n[4/12] Seeding Product Categories...");
  const categories = [
    { name: "Enterprise Software", description: "Core enterprise ERP, CRM, and AI modules" },
    { name: "Cloud & Operations", description: "Dedicated cloud hosting & SLA support packages" },
    { name: "Hardware & Devices", description: "Industrial IoT edge gateways & retail POS terminals" },
    { name: "Professional Services", description: "On-site implementation, integration & training" },
  ];

  const categoryMap = new Map<string, number>();
  for (const cat of categories) {
    const res = await query(
      `INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING id`,
      [cat.name, cat.description]
    );
    categoryMap.set(cat.name, Number(res.rows[0].id));
  }

  // 5b. Subscription Plans
  console.log("\nSeeding Subscription Plans...");
  await query(`
    INSERT INTO subscription_plans (name, description, price, currency, billing_cycle, proration_method, credit_allowance, credit_unit_value, is_active)
    VALUES
      ('Standard Operations Support Plan', 'Monthly operations support plan', 300.00, 'USD', 'MONTHLY', 'DAILY', 0, 0, true),
      ('Enterprise Cloud Suite Plan', 'Monthly enterprise cloud suite subscription', 1200.00, 'USD', 'MONTHLY', 'DAILY', 0, 0, true);
  `);

  // 6. Products & Variants
  console.log("\n[5/12] Seeding Catalog Products & Variants...");
  const productsToSeed = [
    {
      sku: "SW-ENT-001",
      name: "RevSync Enterprise Software Platform",
      description: "Complete Enterprise Software Suite",
      category: "Enterprise Software",
      product_type: "RECURRING",
      base_cost: 1000.00,
      variants: [
        { sku: "SW-ENT-001-VAR1", name: "Enterprise Software License", attributes: { edition: "Enterprise" } },
      ],
    },
    {
      sku: "CS-SUPP-001",
      name: "24/7 Priority Operations Support",
      description: "Dedicated technical account manager and priority 15-min SLA",
      category: "Cloud & Operations",
      product_type: "RECURRING",
      base_cost: 350.00,
      variants: [
        { sku: "CS-SUPP-001-VAR1", name: "Priority Support (Standard SLA)", attributes: { sla: "Priority" } },
        { sku: "CS-SUPP-001-8X5", name: "Operations Support (Business Hours 8x5)", attributes: { sla: "4 Hours" } },
        { sku: "CS-SUPP-001-24X7", name: "Operations Support (Dedicated 24/7 SLA)", attributes: { sla: "15 Mins Priority" } },
      ],
    },
    {
      sku: "HW-GATEWAY-001",
      name: "IoT Edge Industrial Gateway",
      description: "Ruggedized hardware gateway for real-time edge processing",
      category: "Hardware & Devices",
      product_type: "ONE_TIME",
      base_cost: 280.00,
      variants: [
        { sku: "HW-GATEWAY-001-VAR1", name: "IoT Edge Gateway Unit", attributes: { type: "Gateway" } },
        { sku: "HW-GATEWAY-001-4G", name: "IoT Gateway Pro (Wi-Fi + 4G LTE)", attributes: { connectivity: "4G LTE" } },
        { sku: "HW-GATEWAY-001-5G", name: "IoT Gateway Pro (5G Dual SIM + Satellite)", attributes: { connectivity: "5G + Satellite" } },
      ],
    },
    {
      sku: "SW-ERP-001",
      name: "RevSync Core ERP Suite",
      description: "Complete Quote-to-Cash & Enterprise Resource Planning Platform",
      category: "Enterprise Software",
      product_type: "RECURRING",
      base_cost: 1200.00,
      variants: [
        { sku: "SW-ERP-001-STD", name: "RevSync ERP (10-50 User Pack)", attributes: { users: "10-50", edition: "Standard" } },
        { sku: "SW-ERP-001-ENT", name: "RevSync ERP (50-250 User Pack)", attributes: { users: "50-250", edition: "Enterprise" } },
        { sku: "SW-ERP-001-ULT", name: "RevSync ERP (Unlimited Scale)", attributes: { users: "Unlimited", edition: "Ultimate" } },
      ],
    },
    {
      sku: "SW-AI-002",
      name: "RevSync AI Analytics Engine",
      description: "Predictive revenue forecasting and automated margin optimization",
      category: "Enterprise Software",
      product_type: "RECURRING",
      base_cost: 450.00,
      variants: [
        { sku: "SW-AI-002-BASIC", name: "AI Analytics (Basic Insights)", attributes: { tier: "Basic" } },
        { sku: "SW-AI-002-ADV", name: "AI Analytics (Predictive Enterprise)", attributes: { tier: "Advanced" } },
      ],
    },
    {
      sku: "SW-CRM-003",
      name: "CRM & Data Sync Gateway",
      description: "Bi-directional real-time sync with Salesforce, HubSpot & Dynamics",
      category: "Enterprise Software",
      product_type: "ONE_TIME",
      base_cost: 750.00,
      variants: [
        { sku: "SW-CRM-003-STD", name: "CRM Sync Gateway (Standard Connectors)", attributes: { connectors: ["Salesforce", "HubSpot"] } },
      ],
    },
    {
      sku: "CS-HOST-002",
      name: "Dedicated Cloud Infrastructure Cluster",
      description: "Single-tenant isolated cloud compute & encrypted storage instance",
      category: "Cloud & Operations",
      product_type: "RECURRING",
      base_cost: 600.00,
      variants: [
        { sku: "CS-HOST-002-16G", name: "Dedicated Cluster (16GB RAM / 8 vCPU)", attributes: { specs: "16GB/8vCPU" } },
        { sku: "CS-HOST-002-64G", name: "Dedicated Cluster (64GB RAM / 32 vCPU)", attributes: { specs: "64GB/32vCPU" } },
      ],
    },
    {
      sku: "HW-GW-001",
      name: "IoT Edge Industrial Gateway Legacy",
      description: "Legacy hardware gateway for edge processing",
      category: "Hardware & Devices",
      product_type: "ONE_TIME",
      base_cost: 280.00,
      variants: [
        { sku: "HW-GW-001-4G", name: "IoT Gateway Pro Legacy (4G LTE)", attributes: { connectivity: "4G LTE" } },
        { sku: "HW-GW-001-5G", name: "IoT Gateway Pro Legacy (5G)", attributes: { connectivity: "5G" } },
      ],
    },
    {
      sku: "HW-POS-002",
      name: "Secure POS Retail Terminal",
      description: "EMV & NFC compliant smart payment hardware terminal",
      category: "Hardware & Devices",
      product_type: "ONE_TIME",
      base_cost: 160.00,
      variants: [
        { sku: "HW-POS-002-ETH", name: "POS Terminal (Desktop Countertop)", attributes: { type: "Countertop" } },
        { sku: "HW-POS-002-MOB", name: "POS Terminal (Wireless Mobile Handheld)", attributes: { type: "Mobile Wireless" } },
      ],
    },
    {
      sku: "PS-IMP-001",
      name: "Enterprise Implementation & Training",
      description: "Dedicated onboarding team, architecture setup, and staff training",
      category: "Professional Services",
      product_type: "ONE_TIME",
      base_cost: 2200.00,
      variants: [
        { sku: "PS-IMP-001-REM", name: "Remote Setup & Administrator Training", attributes: { delivery: "Remote" } },
        { sku: "PS-IMP-001-ONS", name: "On-site Deployment & Executive Workshop", attributes: { delivery: "On-Site" } },
      ],
    },
  ];

  const productMap = new Map<string, number>();
  const variantMap = new Map<string, number>();

  for (const p of productsToSeed) {
    const categoryId = categoryMap.get(p.category)!;
    const prodRes = await query(
      `INSERT INTO products (sku, name, description, category_id, product_type, base_cost, is_active, track_inventory)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING id`,
      [p.sku, p.name, p.description, categoryId, p.product_type, p.base_cost, p.category === "Hardware & Devices"]
    );
    const prodId = Number(prodRes.rows[0].id);
    productMap.set(p.sku, prodId);

    console.log(`  ✓ Product: ${p.name} [${p.sku}]`);

    for (const v of p.variants) {
      const varRes = await query(
        `INSERT INTO product_variants (product_id, sku, name, attributes)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [prodId, v.sku, v.name, JSON.stringify(v.attributes)]
      );
      variantMap.set(v.sku, Number(varRes.rows[0].id));
      console.log(`    ↳ Variant: ${v.name} [${v.sku}]`);
    }
  }

  // 7. Product Relationships (Upsell / Cross-Sell)
  console.log("\n[6/12] Seeding Product Recommendations...");
  const relationships = [
    { from: "SW-ERP-001", to: "SW-AI-002", type: "UPSELL" },
    { from: "SW-ERP-001", to: "CS-SUPP-001", type: "CROSS_SELL" },
    { from: "SW-ERP-001", to: "PS-IMP-001", type: "CROSS_SELL" },
    { from: "HW-GATEWAY-001", to: "CS-SUPP-001", type: "CROSS_SELL" },
    { from: "HW-POS-002", to: "SW-CRM-003", type: "CROSS_SELL" },
  ];

  for (const rel of relationships) {
    const prodId = productMap.get(rel.from);
    const relId = productMap.get(rel.to);
    if (prodId && relId) {
      await query(
        `INSERT INTO product_relationships (product_id, related_product_id, relationship_type)
         VALUES ($1, $2, $3)`,
        [prodId, relId, rel.type]
      );
      console.log(`  ✓ ${rel.type}: ${rel.from} -> ${rel.to}`);
    }
  }

  // 8. Price Lists & Items Matrix (3 Tiers x 4 Currencies = 12 Price Lists)
  console.log("\n[7/12] Seeding Multi-Currency Price Lists & Items...");
  const currencyRates: Record<string, number> = { USD: 1.0, EUR: 0.92, GBP: 0.79, INR: 83.50 };
  const tierMultipliers: Record<string, number> = {
    Bronze: 1.65, // Base retail markup
    Silver: 1.50, // Mid tier partner
    Gold: 1.35,   // Preferred enterprise rate
  };

  for (const [tierName, tierId] of tierMap.entries()) {
    const multiplier = tierMultipliers[tierName] || 1.5;
    for (const curr of currencies) {
      const rate = currencyRates[curr.code] || 1.0;
      const plName = `${tierName} Tier - ${curr.code} Price List`;

      const plRes = await query(
        `INSERT INTO price_lists (name, customer_tier_id, currency_code, is_active)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [plName, tierId, curr.code]
      );
      const priceListId = Number(plRes.rows[0].id);

      for (const p of productsToSeed) {
        const prodId = productMap.get(p.sku)!;
        // Calculated Unit Price = base_cost * tier_multiplier * exchange_rate
        const unitPrice = Math.round(p.base_cost * multiplier * rate * 100) / 100;

        await query(
          `INSERT INTO price_list_items (price_list_id, product_id, unit_price)
           VALUES ($1, $2, $3)`,
          [priceListId, prodId, unitPrice]
        );
      }
    }
    console.log(`  ✓ Generated Price Lists for ${tierName} Tier (4 Currencies)`);
  }

  // 9. Discount & Approval Rules
  console.log("\n[8/12] Seeding Commercial Policy & Approval Rules...");
  const softwareCatId = categoryMap.get("Enterprise Software")!;
  const hardwareCatId = categoryMap.get("Hardware & Devices")!;
  const cloudCatId = categoryMap.get("Cloud & Operations")!;

  const goldId = tierMap.get("Gold")!;
  const silverId = tierMap.get("Silver")!;
  const bronzeId = tierMap.get("Bronze")!;

  const discountRules = [
    { tier_id: goldId, category_id: softwareCatId, max_discount: 15.00 },
    { tier_id: goldId, category_id: hardwareCatId, max_discount: 12.00 },
    { tier_id: silverId, category_id: softwareCatId, max_discount: 10.00 },
    { tier_id: silverId, category_id: cloudCatId, max_discount: 10.00 },
    { tier_id: bronzeId, category_id: softwareCatId, max_discount: 5.00 },
  ];

  for (const dr of discountRules) {
    await query(
      `INSERT INTO discount_rules (customer_tier_id, category_id, max_discount_pct, is_active)
       VALUES ($1, $2, $3, true)`,
      [dr.tier_id, dr.category_id, dr.max_discount]
    );
  }

  const managerRoleId = roleMap.get("Sales Manager")!;
  const financeRoleId = roleMap.get("Finance")!;

  const approvalRules = [
    { risk_level: "LOW", min_overage: 0.0, sequence: [managerRoleId] },
    { risk_level: "MEDIUM", min_overage: 5.0, sequence: [managerRoleId] },
    { risk_level: "HIGH", min_overage: 10.0, sequence: [managerRoleId, financeRoleId] },
  ];

  for (const ar of approvalRules) {
    await query(
      `INSERT INTO approval_rules (risk_level, min_total_overage, role_sequence, is_active)
       VALUES ($1, $2, $3, true)`,
      [ar.risk_level, ar.min_overage, ar.sequence]
    );
  }
  console.log("  ✓ Discount & Approval Risk Rules configured.");

  // 10. Customer Tier Rules & Base Customers
  console.log("\n[9/12] Seeding Customers & Evaluation Rules...");
  await query(`
    INSERT INTO customer_tier_rules
      (name, target_tier, customer_type, min_expected_po_value, min_upfront_payment_pct, payment_terms)
    VALUES
      ('Enterprise high-value advance', 'GOLD', 'ENTERPRISE', 2000000, 50, '{}'),
      ('Business mid-value', 'SILVER', 'BUSINESS', 500000, NULL, '{}'),
      ('Default', 'BRONZE', NULL, NULL, NULL, '{}');
  `);

  const customersToSeed = [
    { name: "Acme Corp", email: "purchasing@acme.com", company: "Acme Corp", phone: "+1 555 0192", tier: "Bronze", currency: "USD", type: "BUSINESS", po: 1000000, terms: "NET_30", upfront: 0 },
    { name: "Titan Industries", email: "supply@titan.com", company: "Titan Industries", phone: "+1 312 555 0199", tier: "Gold", currency: "USD", type: "ENTERPRISE", po: 3000000, terms: "NET_30", upfront: 50 },
    { name: "Aether Logistics GmbH", email: "procurement@aetherlogistics.de", company: "Aether Logistics", phone: "+49 30 90182", tier: "Silver", currency: "EUR", type: "BUSINESS", po: 650000, terms: "NET_30", upfront: 20 },
    { name: "Apex Digital UK Ltd", email: "ops@apexdigital.co.uk", company: "Apex Digital", phone: "+44 20 7946 0912", tier: "Silver", currency: "GBP", type: "BUSINESS", po: 450000, terms: "NET_15", upfront: 0 },
    { name: "Bharat Tech Innovations", email: "info@bharattech.in", company: "Bharat Tech", phone: "+91 22 2493 8811", tier: "Bronze", currency: "INR", type: "BUSINESS", po: 1500000, terms: "ADVANCE", upfront: 100 },
    { name: "CyberDyne Systems Inc", email: "enterprise@cyberdyne.com", company: "CyberDyne Systems", phone: "+1 415 555 0188", tier: "Gold", currency: "USD", type: "ENTERPRISE", po: 5000000, terms: "NET_60", upfront: 30 },
    { name: "Starlight Media Group", email: "billing@starlightmedia.com", company: "Starlight Media", phone: "+1 212 555 0143", tier: "Gold", currency: "USD", type: "ENTERPRISE", po: 2100000, terms: "NET_30", upfront: 40 },
    { name: "Nordic Nexus Solutions", email: "contact@nordicnexus.se", company: "Nordic Nexus", phone: "+46 8 123 4567", tier: "Silver", currency: "EUR", type: "BUSINESS", po: 800000, terms: "NET_30", upfront: 15 },
    { name: "Vanguard Retail Holdings", email: "inventory@vanguardretail.com", company: "Vanguard Retail", phone: "+1 800 555 0111", tier: "Bronze", currency: "USD", type: "BUSINESS", po: 250000, terms: "NET_15", upfront: 0 },
    { name: "Zenith BioTech Labs", email: "vendor@zenithbiotech.com", company: "Zenith BioTech", phone: "+1 617 555 0166", tier: "Silver", currency: "USD", type: "BUSINESS", po: 950000, terms: "NET_30", upfront: 25 },
  ];

  const customerMap = new Map<string, number>();
  for (const cust of customersToSeed) {
    const tierId = tierMap.get(cust.tier)!;
    const res = await query(
      `INSERT INTO customers 
        (name, email, company, phone, tier_id, status, currency_code, customer_type, expected_po_value, payment_terms, upfront_payment_pct, calculated_tier_id)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7, $8, $9, $10, $5) RETURNING id`,
      [cust.name, cust.email, cust.company, cust.phone, tierId, cust.currency, cust.type, cust.po, cust.terms, cust.upfront]
    );
    const custId = Number(res.rows[0].id);
    customerMap.set(cust.name, custId);
    console.log(`  ✓ Customer: ${cust.name} (${cust.company}) [${cust.tier} - ${cust.currency}]`);
  }

  // 11. Warehouses & Inventory
  console.log("\n[10/12] Seeding Warehouses & Stock Levels...");
  const warehouses = [
    { name: "Mumbai Central Logistics", code: "MUM-01", address: "1 BKC, Bandra Kurla Complex, Mumbai", base_shipping_cost: 5.00 },
    { name: "Delhi NCR Distribution Depot", code: "DEL-01", address: "Okhla Industrial Estate, New Delhi", base_shipping_cost: 8.00 },
    { name: "Bengaluru South Tech Depot", code: "BLR-01", address: "Electronic City, Bengaluru", base_shipping_cost: 7.00 },
    { name: "New York East Fulfillment", code: "US-EAST-01", address: "100 Logistics Way, Newark, NJ", base_shipping_cost: 12.00 },
  ];

  const warehouseMap = new Map<string, number>();
  for (const wh of warehouses) {
    const res = await query(
      `INSERT INTO warehouses (name, code, address, base_shipping_cost, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [wh.name, wh.code, wh.address, wh.base_shipping_cost]
    );
    warehouseMap.set(wh.code, Number(res.rows[0].id));
    console.log(`  ✓ Warehouse: ${wh.name} [${wh.code}]`);
  }

  // Add ample stock for hardware & software items
  for (const prodId of productMap.values()) {
    for (const whId of warehouseMap.values()) {
      await query(
        `INSERT INTO inventory_items (product_id, warehouse_id, quantity_on_hand, reorder_threshold)
         VALUES ($1, $2, $3, 5)`,
        [prodId, whId, 150]
      );
    }
  }
  console.log("  ✓ Stock Levels set to 150 units per warehouse across all products.");

  // 12. Seed Supplemental Dataset
  console.log("\n[11/12] Seeding Supplemental Dataset...");
  await seedMore();

  console.log("\n=========================================");
  console.log("   REVSYNC DATABASE SEEDING COMPLETE!    ");
  console.log("=========================================");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed with error:", err);
  process.exit(1);
});

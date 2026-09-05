import "dotenv/config";
import bcrypt from "bcryptjs";
import { query } from "./pool.js";
import { calculateQuotation, InputLine } from "../engines/quotation-engine.js";

async function seed() {
  console.log("=========================================");
  console.log("       REVSYNC DATABASE SEEDER           ");
  console.log("=========================================");
  console.log("Wiping all existing database tables...");

  // 1. Clean Reset - Truncate all tables in cascade mode
  await query(`
    TRUNCATE TABLE 
      fulfillment_allocations,
      fulfillment_orders,
      inventory_items,
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

  // 6. Products & Variants
  console.log("\n[5/12] Seeding Catalog Products & Variants...");
  const productsToSeed = [
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
      sku: "CS-SUPP-001",
      name: "24/7 Priority Operations Support",
      description: "Dedicated technical account manager and priority 15-min SLA",
      category: "Cloud & Operations",
      product_type: "RECURRING",
      base_cost: 350.00,
      variants: [
        { sku: "CS-SUPP-001-8X5", name: "Operations Support (Business Hours 8x5)", attributes: { sla: "4 Hours" } },
        { sku: "CS-SUPP-001-24X7", name: "Operations Support (Dedicated 24/7 SLA)", attributes: { sla: "15 Mins Priority" } },
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
      name: "IoT Edge Industrial Gateway",
      description: "Ruggedized hardware gateway for real-time edge processing",
      category: "Hardware & Devices",
      product_type: "ONE_TIME",
      base_cost: 280.00,
      variants: [
        { sku: "HW-GW-001-4G", name: "IoT Gateway Pro (Wi-Fi + 4G LTE)", attributes: { connectivity: "4G LTE" } },
        { sku: "HW-GW-001-5G", name: "IoT Gateway Pro (5G Dual SIM + Satellite)", attributes: { connectivity: "5G + Satellite" } },
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
      `INSERT INTO products (sku, name, description, category_id, product_type, base_cost, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
      [p.sku, p.name, p.description, categoryId, p.product_type, p.base_cost]
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
    { from: "HW-GW-001", to: "CS-SUPP-001", type: "CROSS_SELL" },
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

  // 10. Customer Tier Rules & Customers
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
    { name: "Acme Global Enterprises", email: "purchasing@acmeglobal.com", company: "Acme Global", phone: "+1 555 0192", tier: "Gold", currency: "USD", type: "ENTERPRISE", po: 2500000, terms: "NET_30", upfront: 50 },
    { name: "Aether Logistics GmbH", email: "procurement@aetherlogistics.de", company: "Aether Logistics", phone: "+49 30 90182", tier: "Silver", currency: "EUR", type: "BUSINESS", po: 650000, terms: "NET_30", upfront: 20 },
    { name: "Apex Digital UK Ltd", email: "ops@apexdigital.co.uk", company: "Apex Digital", phone: "+44 20 7946 0912", tier: "Silver", currency: "GBP", type: "BUSINESS", po: 450000, terms: "NET_15", upfront: 0 },
    { name: "Bharat Tech Innovations", email: "info@bharattech.in", company: "Bharat Tech", phone: "+91 22 2493 8811", tier: "Bronze", currency: "INR", type: "BUSINESS", po: 1500000, terms: "ADVANCE", upfront: 100 },
    { name: "CyberDyne Systems Inc", email: "enterprise@cyberdyne.com", company: "CyberDyne Systems", phone: "+1 415 555 0188", tier: "Gold", currency: "USD", type: "ENTERPRISE", po: 5000000, terms: "NET_60", upfront: 30 },
    { name: "Starlight Media Group", email: "billing@starlightmedia.com", company: "Starlight Media", phone: "+1 212 555 0143", tier: "Gold", currency: "USD", type: "ENTERPRISE", po: 2100000, terms: "NET_30", upfront: 40 },
    { name: "Nordic Nexus Solutions", email: "contact@nordicnexus.se", company: "Nordic Nexus", phone: "+46 8 123 4567", tier: "Silver", currency: "EUR", type: "BUSINESS", po: 800000, terms: "NET_30", upfront: 15 },
    { name: "Titanium Heavy Industries", email: "supply@titaniumheavy.com", company: "Titanium Heavy", phone: "+1 312 555 0199", tier: "Gold", currency: "USD", type: "ENTERPRISE", po: 3500000, terms: "NET_30", upfront: 50 },
    { name: "Vanguard Retail Holdings", email: "inventory@vanguardretail.com", company: "Vanguard Retail", phone: "+1 800 555 0111", tier: "Bronze", currency: "USD", type: "BUSINESS", po: 250000, terms: "NET_15", upfront: 0 },
    { name: "Zenith BioTech Labs", email: "vendor@zenithbiotech.com", company: "Zenith BioTech", phone: "+1 617 555 0166", tier: "Silver", currency: "USD", type: "BUSINESS", po: 950000, terms: "NET_30", upfront: 25 },
  ];

  const customerMap = new Map<string, number>();
  for (const cust of customersToSeed) {
    const tierId = tierMap.get(cust.tier)!;
    const res = await query(
      `INSERT INTO customers 
        (name, email, company, phone, tier_id, status, currency_code, customer_type, expected_po_value, payment_terms, upfront_payment_pct)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7, $8, $9, $10) RETURNING id`,
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

  // 12. Realistic Sample Quotations & Workflow History
  console.log("\n[11/12] Seeding Realistic Sample Quotations...");

  const salesRepId = userMap.get("sales@revsync.com")!;
  const managerUserId = userMap.get("manager@revsync.com")!;
  const financeUserId = userMap.get("finance@revsync.com")!;

  // Helper to get unit price from database for product & customer currency/tier
  async function getUnitPrice(prodId: number, custId: number): Promise<number> {
    const custRes = await query(`SELECT tier_id, currency_code FROM customers WHERE id = $1`, [custId]);
    const { tier_id, currency_code } = custRes.rows[0];

    const priceRes = await query(
      `SELECT pli.unit_price 
       FROM price_list_items pli
       JOIN price_lists pl ON pli.price_list_id = pl.id
       WHERE pl.customer_tier_id = $1 AND pl.currency_code = $2 AND pli.product_id = $3`,
      [tier_id, currency_code, prodId]
    );

    if (priceRes.rows.length > 0) {
      return Number(priceRes.rows[0].unit_price);
    }
    const prodRes = await query(`SELECT base_cost FROM products WHERE id = $1`, [prodId]);
    return Number(prodRes.rows[0].base_cost) * 1.5;
  }

  // Sample Quotation Scenarios
  const scenarios = [
    {
      qNum: "QT-2026-001",
      custName: "Acme Global Enterprises",
      status: "DRAFT",
      notes: "Initial Q3 proposal for Acme Global ERP & 24/7 Support.",
      orderDiscountPct: 5.0,
      lines: [
        { sku: "SW-ERP-001", vSku: "SW-ERP-001-ENT", qty: 3, discPct: 2.0 },
        { sku: "CS-SUPP-001", vSku: "CS-SUPP-001-24X7", qty: 1, discPct: 0.0 },
        { sku: "PS-IMP-001", vSku: "PS-IMP-001-ONS", qty: 1, discPct: 0.0 },
      ],
    },
    {
      qNum: "QT-2026-002",
      custName: "CyberDyne Systems Inc",
      status: "PENDING_APPROVAL",
      notes: "Custom enterprise pricing request submitted to management for review.",
      orderDiscountPct: 8.0,
      riskLevel: "HIGH",
      overage: 12.5,
      lines: [
        { sku: "SW-ERP-001", vSku: "SW-ERP-001-ULT", qty: 5, discPct: 22.0 },
        { sku: "SW-AI-002", vSku: "SW-AI-002-ADV", qty: 2, discPct: 18.0 },
      ],
    },
    {
      qNum: "QT-2026-003",
      custName: "Aether Logistics GmbH",
      status: "APPROVED",
      notes: "Discount approved by Sarah Manager.",
      orderDiscountPct: 0.0,
      riskLevel: "MEDIUM",
      overage: 5.0,
      lines: [
        { sku: "SW-ERP-001", vSku: "SW-ERP-001-ENT", qty: 2, discPct: 12.0 },
        { sku: "CS-HOST-002", vSku: "CS-HOST-002-64G", qty: 1, discPct: 5.0 },
      ],
    },
    {
      qNum: "QT-2026-004",
      custName: "Apex Digital UK Ltd",
      status: "CONFIRMED",
      notes: "Order confirmed & inventory allocated for IoT expansion.",
      orderDiscountPct: 0.0,
      riskLevel: "LOW",
      overage: 0.0,
      lines: [
        { sku: "HW-GW-001", vSku: "HW-GW-001-5G", qty: 10, discPct: 0.0 },
        { sku: "HW-POS-002", vSku: "HW-POS-002-MOB", qty: 15, discPct: 0.0 },
      ],
    },
    {
      qNum: "QT-2026-005",
      custName: "Vanguard Retail Holdings",
      status: "REJECTED",
      notes: "Requested 35% discount rejected due to non-viable margins.",
      orderDiscountPct: 10.0,
      riskLevel: "HIGH",
      overage: 25.0,
      lines: [
        { sku: "HW-POS-002", vSku: "HW-POS-002-ETH", qty: 50, discPct: 35.0 },
      ],
    },
  ];

  for (const s of scenarios) {
    const custId = customerMap.get(s.custName)!;
    const custRes = await query(`SELECT currency_code FROM customers WHERE id = $1`, [custId]);
    const currencyCode = custRes.rows[0].currency_code;

    // Build input lines with unit prices & costs
    const inputLines: InputLine[] = [];
    const lineVariantIds: (number | null)[] = [];

    for (const l of s.lines) {
      const prodId = productMap.get(l.sku)!;
      const vId = l.vSku ? variantMap.get(l.vSku) || null : null;
      const unitPrice = await getUnitPrice(prodId, custId);
      const prodRes = await query(`SELECT base_cost, name FROM products WHERE id = $1`, [prodId]);
      const unitCost = Number(prodRes.rows[0].base_cost);

      inputLines.push({
        product_id: prodId,
        product_variant_id: vId,
        description: `${prodRes.rows[0].name}`,
        quantity: l.qty,
        unit_price: unitPrice,
        unit_cost: unitCost,
        applied_discount_pct: l.discPct,
      });
      lineVariantIds.push(vId);
    }

    const calc = calculateQuotation(inputLines, 10.00, s.orderDiscountPct);

    // Insert Quotation
    const qRes = await query(
      `INSERT INTO quotations 
        (quotation_number, customer_id, sales_rep_id, currency_code, status, 
         subtotal, discount_total, order_discount_pct, order_discount_amount, tax_rate_pct, tax_total, 
         grand_total, total_cost, margin_amount, margin_pct, total_overage, risk_level, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING id`,
      [
        s.qNum,
        custId,
        salesRepId,
        currencyCode,
        s.status,
        calc.subtotal,
        calc.discount_total,
        calc.order_discount_pct,
        calc.order_discount_amount,
        calc.tax_rate_pct,
        calc.tax_total,
        calc.grand_total,
        calc.total_cost,
        calc.margin_amount,
        calc.margin_pct,
        s.overage || 0,
        s.riskLevel || "LOW",
        s.notes,
      ]
    );

    const qId = Number(qRes.rows[0].id);

    // Insert Quotation Lines
    const seededLineIds: number[] = [];
    for (let idx = 0; idx < calc.lines.length; idx++) {
      const l = calc.lines[idx];
      const lineRes = await query(
        `INSERT INTO quotation_lines
          (quotation_id, product_id, product_variant_id, description, quantity, unit_price, unit_cost, 
           applied_discount_pct, discount_amount, line_subtotal, line_total, line_cost, line_margin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          qId,
          l.product_id,
          l.product_variant_id || null,
          l.description || null,
          l.quantity,
          l.unit_price,
          l.unit_cost,
          l.applied_discount_pct,
          l.discount_amount,
          l.line_subtotal,
          l.line_total,
          l.line_cost,
          l.line_margin,
        ]
      );
      seededLineIds.push(Number(lineRes.rows[0].id));
    }

    // Workflows for specific states
    if (s.status === "PENDING_APPROVAL" || s.status === "APPROVED" || s.status === "REJECTED") {
      const reqStatus = s.status === "PENDING_APPROVAL" ? "PENDING_APPROVAL" : s.status;
      const appReq = await query(
        `INSERT INTO approval_requests (quotation_id, status, risk_level, total_overage, submitted_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [qId, reqStatus, s.riskLevel || "HIGH", s.overage || 10.0, salesRepId, s.notes]
      );
      const reqId = Number(appReq.rows[0].id);

      if (s.status === "PENDING_APPROVAL") {
        await query(
          `INSERT INTO approval_steps (approval_request_id, sequence, role_id, status)
           VALUES ($1, 1, $2, 'PENDING'), ($1, 2, $3, 'PENDING')`,
          [reqId, managerRoleId, financeRoleId]
        );
      } else if (s.status === "APPROVED") {
        await query(
          `INSERT INTO approval_steps (approval_request_id, sequence, role_id, status, decided_by, decided_at, notes)
           VALUES ($1, 1, $2, 'APPROVED', $3, NOW(), 'Approved within target margin tolerance.')`,
          [reqId, managerRoleId, managerUserId]
        );
        await query(
          `UPDATE approval_requests SET decided_by = $1, decided_at = NOW() WHERE id = $2`,
          [managerUserId, reqId]
        );
      } else if (s.status === "REJECTED") {
        await query(
          `INSERT INTO approval_steps (approval_request_id, sequence, role_id, status, decided_by, decided_at, notes)
           VALUES ($1, 1, $2, 'REJECTED', $3, NOW(), 'Margin too low. Discount rejected.')`,
          [reqId, managerRoleId, managerUserId]
        );
        await query(
          `UPDATE approval_requests SET decided_by = $1, decided_at = NOW() WHERE id = $2`,
          [managerUserId, reqId]
        );
      }
    } else if (s.status === "CONFIRMED") {
      // Create Fulfillment Order & Allocations
      const foRes = await query(
        `INSERT INTO fulfillment_orders (quotation_id, status, shipping_cost, backordered_quantity, created_by, notes)
         VALUES ($1, 'ALLOCATED', 20.00, 0, $2, 'Automatically allocated on order confirmation') RETURNING id`,
        [qId, salesRepId]
      );
      const foId = Number(foRes.rows[0].id);

      const whId = warehouseMap.get("US-EAST-01")!;
      for (let i = 0; i < calc.lines.length; i++) {
        const l = calc.lines[i];
        const lineId = seededLineIds[i];
        await query(
          `INSERT INTO fulfillment_allocations (fulfillment_order_id, quotation_line_id, product_id, warehouse_id, quantity, unit_shipping_cost)
           VALUES ($1, $2, $3, $4, $5, 2.00)`,
          [foId, lineId, l.product_id, whId, l.quantity]
        );
      }
    }

    console.log(`  ✓ Seeded Quote ${s.qNum} (${s.custName}) - Status: ${s.status}`);
  }

  console.log("\n=========================================");
  console.log("   REVSYNC DATABASE SEEDING COMPLETE!    ");
  console.log("=========================================");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed with error:", err);
  process.exit(1);
});

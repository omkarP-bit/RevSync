import { describe, it, expect, beforeAll } from "vitest";
import { addBillingPeriod, calculatePeriodDays, calculateRemainingDays } from "../engines/subscription-cycle-engine.js";
import { calculateProration, calculateUnusedPrepaidValue } from "../engines/proration-engine.js";
import { addCreditToWallet, applyWalletToInvoice, getOrCreateWallet } from "../engines/wallet-engine.js";
import { query, withTransaction } from "../database/pool.js";

describe("Subscription Engine & Proration Unit Tests", () => {
  it("should correctly add billing period for MONTHLY, QUARTERLY, and YEARLY", () => {
    const start = new Date("2026-01-01T00:00:00Z");

    const monthly = addBillingPeriod(start, "MONTHLY");
    expect(monthly.getMonth()).toBe(1); // Feb

    const quarterly = addBillingPeriod(start, "QUARTERLY");
    expect(quarterly.getMonth()).toBe(3); // April

    const yearly = addBillingPeriod(start, "YEARLY");
    expect(yearly.getFullYear()).toBe(2027);
  });

  it("should calculate correct period days and remaining days", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-31T00:00:00Z");
    const mid = new Date("2026-01-16T00:00:00Z");

    const periodDays = calculatePeriodDays(start, end);
    expect(periodDays).toBe(30);

    const remainingDays = calculateRemainingDays(mid, end);
    expect(remainingDays).toBe(15);
  });

  it("should calculate daily rate proration for upgrade and downgrade", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-31T00:00:00Z");
    const effective = new Date("2026-01-16T00:00:00Z"); // 50% through

    // Upgrade from $100/mo to $200/mo at 50%
    const upgrade = calculateProration({
      oldUnitPrice: 100,
      newUnitPrice: 200,
      oldQuantity: 1,
      newQuantity: 1,
      periodStart: start,
      periodEnd: end,
      effectiveDate: effective,
    });

    expect(upgrade.oldPeriodValue).toBe(100);
    expect(upgrade.newPeriodValue).toBe(200);
    expect(upgrade.periodDays).toBe(30);
    expect(upgrade.remainingDays).toBe(15);
    expect(upgrade.remainingFraction).toBe(0.5);
    expect(upgrade.prorationAmount).toBe(50); // Customer owes $50

    // Downgrade from $200/mo to $100/mo at 50%
    const downgrade = calculateProration({
      oldUnitPrice: 200,
      newUnitPrice: 100,
      oldQuantity: 1,
      newQuantity: 1,
      periodStart: start,
      periodEnd: end,
      effectiveDate: effective,
    });

    expect(downgrade.prorationAmount).toBe(-50); // Customer credited $50
  });

  it("should calculate correct proration for quantity changes", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-31T00:00:00Z");
    const effective = new Date("2026-01-16T00:00:00Z"); // 50%

    // 5 seats -> 10 seats at $20/seat
    const qtyIncrease = calculateProration({
      oldUnitPrice: 20,
      newUnitPrice: 20,
      oldQuantity: 5,
      newQuantity: 10,
      periodStart: start,
      periodEnd: end,
      effectiveDate: effective,
    });

    expect(qtyIncrease.oldPeriodValue).toBe(100);
    expect(qtyIncrease.newPeriodValue).toBe(200);
    expect(qtyIncrease.prorationAmount).toBe(50);
  });

  it("should calculate unused prepaid value on cancellation", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-31T00:00:00Z");
    const effective = new Date("2026-01-16T00:00:00Z"); // 50% remaining

    const unused = calculateUnusedPrepaidValue(100, 2, start, end, effective);
    // 200 total value, 50% remaining = 100 unused value
    expect(unused.unusedValue).toBe(100);
  });
});

describe("Customer Credit Wallet Integration Tests", () => {
  it("should add credit to customer wallet and prevent negative balance", async () => {
    await withTransaction(async (client) => {
      // Create test customer
      const custRes = await client.query(
        `INSERT INTO customers (name, email, company, status, currency_code, customer_type)
         VALUES ('Wallet Test Cust', 'wallet.test@test.com', 'Test Corp', 'ACTIVE', 'USD', 'ENTERPRISE')
         RETURNING id`
      );
      const customerId = Number(custRes.rows[0].id);

      // Initialize wallet
      const wallet = await getOrCreateWallet(client, customerId, "USD");
      expect(wallet.balance).toBe(0);

      // Add $150 cancellation credit
      const creditRes = await addCreditToWallet(client, {
        customerId,
        amount: 150,
        currencyCode: "USD",
        type: "CANCELLATION_CREDIT",
        description: "Test cancellation credit",
      });

      expect(creditRes.wallet.balance).toBe(150);

      // Apply wallet offset to $100 invoice
      const offset1 = await applyWalletToInvoice(client, {
        customerId,
        invoiceAmount: 100,
        invoiceId: 9991,
        currencyCode: "USD",
      });

      expect(offset1).toBe(100);

      const walletAfter1 = await getOrCreateWallet(client, customerId, "USD");
      expect(walletAfter1.balance).toBe(50);

      // Apply wallet offset to $80 invoice (partially covered)
      const offset2 = await applyWalletToInvoice(client, {
        customerId,
        invoiceAmount: 80,
        invoiceId: 9992,
        currencyCode: "USD",
      });

      expect(offset2).toBe(50); // Only $50 available

      const walletAfter2 = await getOrCreateWallet(client, customerId, "USD");
      expect(walletAfter2.balance).toBe(0); // Wallet empty, not negative!
    });
  });
});

import { PoolClient } from "pg";
import { query, withTransaction } from "../database/pool.js";
import { addBillingPeriod } from "./subscription-cycle-engine.js";
import { calculateProration, calculateUnusedPrepaidValue } from "./proration-engine.js";
import { addCreditToWallet, applyWalletToInvoice } from "./wallet-engine.js";
import { writeAuditLog } from "../shared/audit.js";

async function generateInvoiceNumber(client: PoolClient): Promise<string> {
  const countResult = await client.query(`SELECT COUNT(*) FROM invoices`);
  const nextSeq = parseInt(countResult.rows[0].count) + 1;
  return `INV-${new Date().getFullYear()}-${String(nextSeq).padStart(4, "0")}`;
}

/**
 * Creates subscriptions and initial billing schedules for all RECURRING lines of a confirmed quotation.
 * Operation is transactional and idempotent.
 */
export async function createSubscriptionsForQuotation(
  client: PoolClient,
  quotationId: number,
  userId: number | null
): Promise<number[]> {
  // Idempotency check: If subscriptions already exist for this quote, return them.
  const existing = await client.query(
    `SELECT id FROM subscriptions WHERE quotation_id = $1`,
    [quotationId]
  );
  if (existing.rows.length > 0) {
    return existing.rows.map((r: any) => Number(r.id));
  }

  const quoteRes = await client.query(
    `SELECT q.id, q.customer_id, q.currency_code, q.status, c.payment_terms
     FROM quotations q
     JOIN customers c ON q.customer_id = c.id
     WHERE q.id = $1`,
    [quotationId]
  );
  if (quoteRes.rows.length === 0) {
    throw new Error(`Quotation ${quotationId} not found`);
  }
  const quote = quoteRes.rows[0];

  // Fetch RECURRING lines
  const linesRes = await client.query(
    `SELECT ql.id, ql.product_id, ql.quantity, ql.unit_price, ql.line_total, ql.unit_cost,
            p.name AS product_name, p.sku
     FROM quotation_lines ql
     JOIN products p ON ql.product_id = p.id
     WHERE ql.quotation_id = $1 AND p.product_type = 'RECURRING'
     ORDER BY ql.id ASC`,
    [quotationId]
  );

  const createdSubscriptionIds: number[] = [];

  for (const line of linesRes.rows) {
    // Find or create a matching subscription plan
    let planId: number | null = null;
    const planRes = await client.query(
      `SELECT id, billing_cycle FROM subscription_plans
       WHERE name = $1 OR (price = $2 AND currency = $3)
       LIMIT 1`,
      [line.product_name, line.unit_price, quote.currency_code]
    );

    let billingCycle: "MONTHLY" | "QUARTERLY" | "YEARLY" = "MONTHLY";

    if (planRes.rows.length > 0) {
      planId = Number(planRes.rows[0].id);
      billingCycle = planRes.rows[0].billing_cycle;
    } else {
      // Auto-create plan for recurring catalog product
      const newPlanRes = await client.query(
        `INSERT INTO subscription_plans (name, description, price, currency, billing_cycle, proration_method)
         VALUES ($1, $2, $3, $4, 'MONTHLY', 'DAILY')
         RETURNING id, billing_cycle`,
        [line.product_name, `Plan for ${line.product_name}`, line.unit_price, quote.currency_code]
      );
      planId = Number(newPlanRes.rows[0].id);
      billingCycle = "MONTHLY";
    }

    const startDate = new Date();
    const periodEnd = addBillingPeriod(startDate, billingCycle);
    const nextBillingDate = periodEnd;

    // Create Subscription
    const subRes = await client.query(
      `INSERT INTO subscriptions
         (customer_id, quotation_id, quotation_line_id, subscription_plan_id, product_id,
          status, quantity, unit_price, currency, start_date, current_period_start,
          current_period_end, next_billing_date)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        Number(quote.customer_id),
        quotationId,
        Number(line.id),
        planId,
        Number(line.product_id),
        Number(line.quantity),
        Number(line.unit_price),
        quote.currency_code,
        startDate,
        startDate,
        periodEnd,
        nextBillingDate,
      ]
    );
    const subId = Number(subRes.rows[0].id);
    createdSubscriptionIds.push(subId);

    // Create Initial Billing Schedule
    await client.query(
      `INSERT INTO billing_schedules
         (subscription_id, billing_date, period_start, period_end, amount, status)
       VALUES ($1, $2, $3, $4, $5, 'UPCOMING')`,
      [subId, nextBillingDate, startDate, periodEnd, Number(line.line_total)]
    );

    await writeAuditLog({
      entityType: "subscriptions",
      entityId: subId,
      action: "SUBSCRIPTION_CREATED",
      before: null,
      after: { quotation_id: quotationId, product_id: line.product_id, quantity: line.quantity },
      performedBy: userId ?? undefined,
      reason: "Generated automatically from confirmed quotation",
    });
  }

  return createdSubscriptionIds;
}

/**
 * Runs the recurring billing job to process due billing schedules, generate recurring invoices, apply wallet credits, and advance periods.
 */
export async function runRecurringBillingJob(optionalClient?: PoolClient): Promise<{
  processedSchedules: number;
  generatedInvoices: number[];
}> {
  const runner = async (fn: (client: PoolClient) => Promise<any>) => {
    if (optionalClient) return fn(optionalClient);
    return withTransaction(fn);
  };

  return runner(async (client) => {
    // Find all UPCOMING schedules due on or before NOW()
    const dueRes = await client.query(
      `SELECT bs.id, bs.subscription_id, bs.billing_date, bs.period_start, bs.period_end, bs.amount,
              s.customer_id, s.product_id, s.subscription_plan_id, s.quantity, s.unit_price, s.currency,
              s.quotation_id, p.name AS product_name, p.sku, sp.billing_cycle
       FROM billing_schedules bs
       JOIN subscriptions s ON bs.subscription_id = s.id
       JOIN products p ON s.product_id = p.id
       LEFT JOIN subscription_plans sp ON s.subscription_plan_id = sp.id
       WHERE bs.status = 'UPCOMING' AND bs.billing_date <= NOW() AND bs.invoice_id IS NULL
       ORDER BY bs.billing_date ASC`
    );

    const generatedInvoices: number[] = [];

    for (const schedule of dueRes.rows) {
      const scheduleId = Number(schedule.id);
      const subId = Number(schedule.subscription_id);
      const customerId = Number(schedule.customer_id);
      const amount = Number(schedule.amount);
      const currency = schedule.currency;
      const cycle: "MONTHLY" | "QUARTERLY" | "YEARLY" = schedule.billing_cycle || "MONTHLY";

      const dueDate = new Date(Date.now() + 30 * 86400000);
      const invoiceNumber = await generateInvoiceNumber(client);

      // Create recurring invoice record
      const invRes = await client.query(
        `INSERT INTO invoices
           (invoice_number, quotation_id, subscription_id, customer_id, currency_code,
            invoice_type, status, due_date, subtotal, discount_total, tax_rate_pct, tax_total,
            grand_total, wallet_offset_amount, total_paid, notes)
         VALUES ($1, $2, $3, $4, $5, 'RECURRING', 'ISSUED', $6, $7, 0, 0, 0, $7, 0, 0, $8)
         RETURNING id`,
        [
          invoiceNumber,
          schedule.quotation_id ? Number(schedule.quotation_id) : null,
          subId,
          customerId,
          currency,
          dueDate,
          amount,
          `Recurring billing for period ${new Date(schedule.period_start).toISOString().split("T")[0]} to ${new Date(schedule.period_end).toISOString().split("T")[0]}`,
        ]
      );
      const invoiceId = Number(invRes.rows[0].id);

      // Apply customer credit wallet offset if available
      const offsetAmount = await applyWalletToInvoice(client, {
        customerId,
        invoiceAmount: amount,
        invoiceId,
        currencyCode: currency,
      });

      let invStatus = "ISSUED";
      if (offsetAmount >= amount) {
        invStatus = "PAID";
      } else if (offsetAmount > 0) {
        invStatus = "PARTIALLY_PAID";
      }

      await client.query(
        `UPDATE invoices
         SET wallet_offset_amount = $1, total_paid = $1, status = $2
         WHERE id = $3`,
        [offsetAmount, invStatus, invoiceId]
      );

      // Insert invoice line
      await client.query(
        `INSERT INTO invoice_lines
           (invoice_id, subscription_id, subscription_plan_id, product_id, product_name, sku,
            quantity, unit_price, applied_discount_pct, discount_amount, line_subtotal,
            line_total, unit_cost, line_cost, line_margin, billing_period_start, billing_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, $9, 0, 0, $9, $10, $11)`,
        [
          invoiceId,
          subId,
          schedule.subscription_plan_id ? Number(schedule.subscription_plan_id) : null,
          Number(schedule.product_id),
          schedule.product_name,
          schedule.sku,
          Number(schedule.quantity),
          Number(schedule.unit_price),
          amount,
          schedule.period_start,
          schedule.period_end,
        ]
      );

      // Update current schedule to GENERATED / PAID and link invoice_id
      const schedStatus = invStatus === "PAID" ? "PAID" : "GENERATED";
      await client.query(
        `UPDATE billing_schedules
         SET status = $1, invoice_id = $2, updated_at = NOW()
         WHERE id = $3`,
        [schedStatus, invoiceId, scheduleId]
      );

      // Advance subscription billing period
      const newPeriodStart = new Date(schedule.period_end);
      const newPeriodEnd = addBillingPeriod(newPeriodStart, cycle);
      const newNextBilling = newPeriodEnd;

      await client.query(
        `UPDATE subscriptions
         SET current_period_start = $1, current_period_end = $2, next_billing_date = $3, updated_at = NOW()
         WHERE id = $4`,
        [newPeriodStart, newPeriodEnd, newNextBilling, subId]
      );

      // Insert next UPCOMING billing schedule
      await client.query(
        `INSERT INTO billing_schedules
           (subscription_id, billing_date, period_start, period_end, amount, status)
         VALUES ($1, $2, $3, $4, $5, 'UPCOMING')`,
        [subId, newNextBilling, newPeriodStart, newPeriodEnd, amount]
      );

      generatedInvoices.push(invoiceId);
    }

    return {
      processedSchedules: dueRes.rows.length,
      generatedInvoices,
    };
  });
}

/**
 * Modifies a subscription plan or quantity with daily pro-rata calculations.
 */
export async function changeSubscription(
  client: PoolClient,
  params: {
    subscriptionId: number;
    newPlanId?: number;
    newQuantity?: number;
    userId: number;
  }
): Promise<{
  subscriptionId: number;
  changeType: string;
  prorationAmount: number;
  walletCredit?: number;
  prorationInvoiceId?: number;
}> {
  const subRes = await client.query(
    `SELECT s.id, s.customer_id, s.quotation_id, s.subscription_plan_id, s.quantity, s.unit_price, s.currency,
            s.status, s.current_period_start, s.current_period_end, s.next_billing_date,
            sp.name AS plan_name, sp.price AS plan_price
     FROM subscriptions s
     LEFT JOIN subscription_plans sp ON s.subscription_plan_id = sp.id
     WHERE s.id = $1`,
    [params.subscriptionId]
  );
  if (subRes.rows.length === 0) {
    throw new Error(`Subscription ${params.subscriptionId} not found`);
  }
  const sub = subRes.rows[0];
  if (sub.status !== "ACTIVE" && sub.status !== "PAUSED") {
    throw new Error(`Cannot modify subscription in ${sub.status} state`);
  }

  const oldPlanId = sub.subscription_plan_id ? Number(sub.subscription_plan_id) : null;
  let newPlanId = oldPlanId;
  let oldUnitPrice = Number(sub.unit_price);
  let newUnitPrice = oldUnitPrice;

  if (params.newPlanId && params.newPlanId !== oldPlanId) {
    const newPlanRes = await client.query(`SELECT id, price FROM subscription_plans WHERE id = $1`, [params.newPlanId]);
    if (newPlanRes.rows.length === 0) {
      throw new Error(`Target subscription plan ${params.newPlanId} not found`);
    }
    newPlanId = Number(newPlanRes.rows[0].id);
    newUnitPrice = Number(newPlanRes.rows[0].price);
  }

  const oldQuantity = Number(sub.quantity);
  const newQuantity = params.newQuantity !== undefined ? params.newQuantity : oldQuantity;

  if (newQuantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  // Determine Change Type
  let changeType = "QUANTITY_INCREASE";
  if (newUnitPrice > oldUnitPrice) {
    changeType = "PLAN_UPGRADE";
  } else if (newUnitPrice < oldUnitPrice) {
    changeType = "PLAN_DOWNGRADE";
  } else if (newQuantity > oldQuantity) {
    changeType = "QUANTITY_INCREASE";
  } else if (newQuantity < oldQuantity) {
    changeType = "QUANTITY_DECREASE";
  }

  // Compute Daily Proration
  const proration = calculateProration({
    oldUnitPrice,
    newUnitPrice,
    oldQuantity,
    newQuantity,
    periodStart: sub.current_period_start,
    periodEnd: sub.current_period_end,
  });

  // Update Subscription record
  await client.query(
    `UPDATE subscriptions
     SET subscription_plan_id = $1, quantity = $2, unit_price = $3, updated_at = NOW()
     WHERE id = $4`,
    [newPlanId, newQuantity, newUnitPrice, params.subscriptionId]
  );

  // Update upcoming billing schedule amount
  const newScheduleAmount = Number((newUnitPrice * newQuantity).toFixed(4));
  await client.query(
    `UPDATE billing_schedules
     SET amount = $1, updated_at = NOW()
     WHERE subscription_id = $2 AND status = 'UPCOMING'`,
    [newScheduleAmount, params.subscriptionId]
  );

  // Record SubscriptionChange
  await client.query(
    `INSERT INTO subscription_changes
       (subscription_id, change_type, old_plan_id, new_plan_id, old_quantity, new_quantity,
        effective_date, old_period_value, new_period_value, remaining_days, period_days, proration_amount)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11)`,
    [
      params.subscriptionId,
      changeType,
      oldPlanId,
      newPlanId,
      oldQuantity,
      newQuantity,
      proration.oldPeriodValue,
      proration.newPeriodValue,
      proration.remainingDays,
      proration.periodDays,
      proration.prorationAmount,
    ]
  );

  let prorationInvoiceId: number | undefined;
  let walletCredit: number | undefined;

  if (proration.prorationAmount > 0) {
    // Additional amount owed -> Generate PRORATION invoice
    const invoiceNumber = await generateInvoiceNumber(client);
    const dueDate = new Date(Date.now() + 15 * 86400000);
    const invRes = await client.query(
      `INSERT INTO invoices
         (invoice_number, quotation_id, subscription_id, customer_id, currency_code, invoice_type, status,
          due_date, subtotal, discount_total, tax_rate_pct, tax_total, grand_total, total_paid, notes)
       VALUES ($1, $2, $3, $4, $5, 'PRORATION', 'ISSUED', $6, $7, 0, 0, 0, $7, 0, $8)
       RETURNING id`,
      [
        invoiceNumber,
        sub.quotation_id ? Number(sub.quotation_id) : null,
        params.subscriptionId,
        Number(sub.customer_id),
        sub.currency,
        dueDate,
        proration.prorationAmount,
        `Proration charge for ${changeType}`,
      ]
    );
    prorationInvoiceId = Number(invRes.rows[0].id);

    // Apply wallet credit if available
    const offset = await applyWalletToInvoice(client, {
      customerId: Number(sub.customer_id),
      invoiceAmount: proration.prorationAmount,
      invoiceId: prorationInvoiceId,
      currencyCode: sub.currency,
    });
    if (offset > 0) {
      const invStatus = offset >= proration.prorationAmount ? "PAID" : "PARTIALLY_PAID";
      await client.query(
        `UPDATE invoices SET wallet_offset_amount = $1, total_paid = $1, status = $2 WHERE id = $3`,
        [offset, invStatus, prorationInvoiceId]
      );
    }
  } else if (proration.prorationAmount < 0) {
    // Overpaid difference -> Credit to Customer Credit Wallet
    walletCredit = Math.abs(proration.prorationAmount);
    await addCreditToWallet(client, {
      customerId: Number(sub.customer_id),
      amount: walletCredit,
      currencyCode: sub.currency,
      type: "CANCELLATION_CREDIT",
      referenceType: "SUBSCRIPTION",
      referenceId: params.subscriptionId,
      description: `Prorated credit refund for ${changeType}`,
    });
  }

  await writeAuditLog({
    entityType: "subscriptions",
    entityId: params.subscriptionId,
    action: changeType,
    before: { plan_id: oldPlanId, quantity: oldQuantity, unit_price: oldUnitPrice },
    after: { plan_id: newPlanId, quantity: newQuantity, unit_price: newUnitPrice, proration: proration.prorationAmount },
    performedBy: params.userId,
    reason: `Subscription modification (${changeType})`,
  });

  return {
    subscriptionId: params.subscriptionId,
    changeType,
    prorationAmount: proration.prorationAmount,
    walletCredit,
    prorationInvoiceId,
  };
}

/**
 * Cancels a subscription mid-cycle, calculates unused prepaid credit, credits customer wallet, and cancels future schedules.
 */
export async function cancelSubscription(
  client: PoolClient,
  params: {
    subscriptionId: number;
    reason?: string;
    userId: number;
  }
): Promise<{
  subscriptionId: number;
  unusedValue: number;
  walletCreditId?: number;
}> {
  const subRes = await client.query(
    `SELECT id, customer_id, subscription_plan_id, quantity, unit_price, currency, status,
            current_period_start, current_period_end
     FROM subscriptions
     WHERE id = $1`,
    [params.subscriptionId]
  );
  if (subRes.rows.length === 0) {
    throw new Error(`Subscription ${params.subscriptionId} not found`);
  }
  const sub = subRes.rows[0];
  if (sub.status === "CANCELLED") {
    throw new Error("Subscription is already cancelled");
  }

  // Calculate unused prepaid value
  const { periodDays, remainingDays, unusedValue } = calculateUnusedPrepaidValue(
    Number(sub.unit_price),
    Number(sub.quantity),
    sub.current_period_start,
    sub.current_period_end
  );

  // Update subscription status to CANCELLED
  await client.query(
    `UPDATE subscriptions
     SET status = 'CANCELLED', end_date = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [params.subscriptionId]
  );

  // Cancel upcoming billing schedules
  await client.query(
    `UPDATE billing_schedules
     SET status = 'CANCELLED', updated_at = NOW()
     WHERE subscription_id = $1 AND status = 'UPCOMING'`,
    [params.subscriptionId]
  );

  // Record SubscriptionChange
  await client.query(
    `INSERT INTO subscription_changes
       (subscription_id, change_type, old_plan_id, new_plan_id, old_quantity, new_quantity,
        effective_date, old_period_value, new_period_value, remaining_days, period_days, proration_amount)
     VALUES ($1, 'CANCELLATION', $2, $2, $3, 0, NOW(), $4, 0, $5, $6, $7)`,
    [
      params.subscriptionId,
      sub.subscription_plan_id ? Number(sub.subscription_plan_id) : null,
      Number(sub.quantity),
      Number((sub.unit_price * sub.quantity).toFixed(4)),
      remainingDays,
      periodDays,
      -unusedValue,
    ]
  );

  let walletCreditId: number | undefined;

  if (unusedValue > 0) {
    const walletRes = await addCreditToWallet(client, {
      customerId: Number(sub.customer_id),
      amount: unusedValue,
      currencyCode: sub.currency,
      type: "CANCELLATION_CREDIT",
      referenceType: "SUBSCRIPTION",
      referenceId: params.subscriptionId,
      description: `Unused prepaid balance credit for cancelled subscription #${params.subscriptionId}${params.reason ? ` (${params.reason})` : ""}`,
    });
    walletCreditId = walletRes.transactionId;
  }

  await writeAuditLog({
    entityType: "subscriptions",
    entityId: params.subscriptionId,
    action: "CANCELLED",
    before: { status: sub.status },
    after: { status: "CANCELLED", unused_value: unusedValue },
    performedBy: params.userId,
    reason: params.reason || "Subscription cancelled by user",
  });

  return {
    subscriptionId: params.subscriptionId,
    unusedValue,
    walletCreditId,
  };
}

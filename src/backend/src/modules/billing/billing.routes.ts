import { Router, Request, Response, NextFunction } from "express";
import { query, withTransaction } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { authenticateCustomer } from "../../middleware/customerAuth.js";
import { ConflictError, NotFoundError, UnprocessableEntityError, ValidationError } from "../../shared/errors.js";
import { calculateQuotation } from "../../engines/quotation-engine.js";
import { applyWalletToInvoice, getOrCreateWallet } from "../../engines/wallet-engine.js";
import { z } from "zod";

export const invoicesRouter = Router();
invoicesRouter.use(authenticate);

export const creditNotesRouter = Router();
creditNotesRouter.use(authenticate);

export const invoicesPortalRouter = Router();
invoicesPortalRouter.use(authenticateCustomer);

const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "CHECK", "CREDIT_WALLET", "OTHER"] as const;
const INVOICE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;

const generateInvoiceSchema = z.object({
  quotation_id: z.coerce.number().int().positive(),
  notes: z.string().max(2000).optional().nullable(),
});

const paymentSchema = z.object({
  reference: z.string().min(1).max(120),
  amount_paid: z.coerce.number().positive(),
  payment_date: z.string().datetime().optional().nullable(),
  payment_method: z.enum(PAYMENT_METHODS).default("BANK_TRANSFER"),
  notes: z.string().max(2000).optional().nullable(),
});

const creditNoteSchema = z.object({
  invoice_id: z.coerce.number().int().positive().optional().nullable(),
  customer_id: z.coerce.number().int().positive(),
  currency_code: z.string().length(3).optional(),
  amount: z.coerce.number().positive(),
  reason: z.string().min(1).max(2000),
});

const PAYMENT_TERM_DAYS: Record<string, number> = {
  NET_15: 15,
  NET_30: 30,
  NET_60: 60,
  ADVANCE: 0,
  COD: 0,
};

async function generateInvoiceNumber(client?: any): Promise<string> {
  const countResult = client
    ? await client.query(`SELECT COUNT(*) FROM invoices`)
    : await query(`SELECT COUNT(*) FROM invoices`);
  const nextSeq = parseInt(countResult.rows[0].count) + 1;
  return `INV-${new Date().getFullYear()}-${String(nextSeq).padStart(4, "0")}`;
}

async function generateCreditNoteNumber(client?: any): Promise<string> {
  const countResult = client
    ? await client.query(`SELECT COUNT(*) FROM credit_notes`)
    : await query(`SELECT COUNT(*) FROM credit_notes`);
  const nextSeq = parseInt(countResult.rows[0].count) + 1;
  return `CN-${new Date().getFullYear()}-${String(nextSeq).padStart(4, "0")}`;
}

async function loadInvoice(id: string | number): Promise<any> {
  const result = await query(
    `SELECT i.id, i.invoice_number, i.public_id, i.quotation_id, i.customer_id,
            i.currency_code, i.status, i.issue_date, i.due_date,
            i.subtotal, i.discount_total, i.order_discount_pct, i.order_discount_amount,
            i.tax_rate_pct, i.tax_total, i.grand_total, i.total_paid, i.notes,
            i.created_at, i.updated_at,
            c.name AS customer_name, q.quotation_number, u.email AS sales_rep_email
     FROM invoices i
     JOIN customers c ON i.customer_id = c.id
     JOIN quotations q ON i.quotation_id = q.id
     LEFT JOIN users u ON q.sales_rep_id = u.id
     WHERE i.id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError("Invoice", id);
  }

  const invoice = result.rows[0];
  const linesResult = await query(
    `SELECT il.id, il.quotation_line_id, il.product_id, il.product_name, il.sku,
            il.description, il.quantity, il.unit_price, il.applied_discount_pct,
            il.discount_amount, il.line_subtotal, il.line_total,
            il.unit_cost, il.line_cost, il.line_margin, il.created_at
     FROM invoice_lines il
     WHERE il.invoice_id = $1
     ORDER BY il.id ASC`,
    [invoice.id]
  );
  const paymentsResult = await query(
    `SELECT ip.id, ip.reference, ip.amount_paid, ip.payment_date, ip.payment_method,
            ip.notes, ip.created_at
     FROM invoice_payments ip
     WHERE ip.invoice_id = $1
     ORDER BY ip.payment_date ASC, ip.id ASC`,
    [invoice.id]
  );
  const creditNotesResult = await query(
    `SELECT cn.id, cn.credit_note_number, cn.amount, cn.reason, cn.status, cn.created_at
     FROM credit_notes cn
     WHERE cn.invoice_id = $1
     ORDER BY cn.created_at ASC`,
    [invoice.id]
  );

  return {
    id: Number(invoice.id),
    invoice_number: invoice.invoice_number,
    public_id: invoice.public_id,
    quotation_id: Number(invoice.quotation_id),
    customer_id: Number(invoice.customer_id),
    customer_name: invoice.customer_name,
    quotation_number: invoice.quotation_number,
    sales_rep_email: invoice.sales_rep_email,
    currency_code: invoice.currency_code,
    status: invoice.status,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    subtotal: Number(invoice.subtotal),
    discount_total: Number(invoice.discount_total),
    order_discount_pct: Number(invoice.order_discount_pct),
    order_discount_amount: Number(invoice.order_discount_amount),
    tax_rate_pct: Number(invoice.tax_rate_pct),
    tax_total: Number(invoice.tax_total),
    grand_total: Number(invoice.grand_total),
    total_paid: Number(invoice.total_paid),
    notes: invoice.notes,
    created_at: invoice.created_at,
    updated_at: invoice.updated_at,
    lines: linesResult.rows.map((row: any) => ({
      id: Number(row.id),
      quotation_line_id: Number(row.quotation_line_id),
      product_id: Number(row.product_id),
      product_name: row.product_name,
      sku: row.sku,
      description: row.description,
      quantity: Number(row.quantity),
      unit_price: Number(row.unit_price),
      applied_discount_pct: Number(row.applied_discount_pct),
      discount_amount: Number(row.discount_amount),
      line_subtotal: Number(row.line_subtotal),
      line_total: Number(row.line_total),
    })),
    payments: paymentsResult.rows.map((row: any) => ({
      id: Number(row.id),
      reference: row.reference,
      amount_paid: Number(row.amount_paid),
      payment_date: row.payment_date,
      payment_method: row.payment_method,
      notes: row.notes,
    })),
    credit_notes: creditNotesResult.rows.map((row: any) => ({
      id: Number(row.id),
      credit_note_number: row.credit_note_number,
      amount: Number(row.amount),
      reason: row.reason,
      status: row.status,
      created_at: row.created_at,
    })),
  };
}

// GET /api/v1/invoices (paginated)
invoicesRouter.get("/", requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER, ROLES.SALES_REP), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.status) {
      const status = (req.query.status as string).toUpperCase().replace(" ", "_");
      if (!(INVOICE_STATUSES as readonly string[]).includes(status)) {
        throw new ValidationError("Invalid invoice status");
      }
      where.push(`i.status = $${paramIdx++}`);
      params.push(status);
    }
    if (req.query.customer_id) {
      where.push(`i.customer_id = $${paramIdx++}`);
      params.push(parseInt(req.query.customer_id as string));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(
      `SELECT COUNT(*) FROM invoices i ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT i.id, i.invoice_number, i.public_id, i.customer_id, i.status,
              i.issue_date, i.due_date, i.grand_total, i.total_paid, i.created_at,
              c.name AS customer_name, q.quotation_number
       FROM invoices i
       JOIN customers c ON i.customer_id = c.id
       JOIN quotations q ON i.quotation_id = q.id
       ${whereClause}
       ORDER BY i.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows.map((row: any) => ({
        id: Number(row.id),
        invoice_number: row.invoice_number,
        public_id: row.public_id,
        customer_id: Number(row.customer_id),
        customer_name: row.customer_name,
        quotation_number: row.quotation_number,
        status: row.status,
        issue_date: row.issue_date,
        due_date: row.due_date,
        grand_total: Number(row.grand_total),
        total_paid: Number(row.total_paid),
        balance_due: Number(Number(row.grand_total - row.total_paid).toFixed(4)),
        created_at: row.created_at,
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/invoices/billable-quotations — confirmed quotes not yet invoiced
invoicesRouter.get("/billable-quotations", requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      `SELECT q.id, q.quotation_number, q.currency_code, q.grand_total, q.created_at,
              c.name AS customer_name
       FROM quotations q
       JOIN customers c ON q.customer_id = c.id
       WHERE q.status = 'CONFIRMED'
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.quotation_id = q.id)
       ORDER BY q.created_at ASC`
    );
    res.json({
      data: result.rows.map((row: any) => ({
        id: Number(row.id),
        quotation_number: row.quotation_number,
        currency_code: row.currency_code,
        grand_total: Number(row.grand_total),
        customer_name: row.customer_name,
        created_at: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/invoices — generate an invoice from a CONFIRMED quotation (all lines)
invoicesRouter.post("/", requireRole(ROLES.ADMIN, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const data = generateInvoiceSchema.parse(req.body);

    const quoteResult = await query(
      `SELECT q.id, q.quotation_number, q.customer_id, q.currency_code, q.tax_rate_pct,
              q.order_discount_pct, q.status, c.payment_terms
       FROM quotations q
       JOIN customers c ON q.customer_id = c.id
       WHERE q.id = $1`,
      [data.quotation_id]
    );
    if (quoteResult.rows.length === 0) {
      throw new NotFoundError("Quotation", data.quotation_id);
    }
    const quote = quoteResult.rows[0];
    if (quote.status !== "CONFIRMED") {
      throw new UnprocessableEntityError("Only CONFIRMED quotations can be invoiced");
    }

    const existing = await query(`SELECT id FROM invoices WHERE quotation_id = $1`, [data.quotation_id]);
    if (existing.rows.length > 0) {
      throw new ConflictError("An invoice already exists for this quotation");
    }

    const linesResult = await query(
      `SELECT ql.id, ql.product_id, ql.description, ql.quantity, ql.unit_price, ql.unit_cost,
              ql.applied_discount_pct, p.name AS product_name, p.sku, p.product_type
       FROM quotation_lines ql
       JOIN products p ON ql.product_id = p.id
       WHERE ql.quotation_id = $1
       ORDER BY ql.id ASC`,
      [data.quotation_id]
    );
    const quoteLines = linesResult.rows;
    if (quoteLines.length === 0) {
      throw new UnprocessableEntityError("Quotation has no lines to invoice");
    }

    const calc = calculateQuotation(
      quoteLines.map((row: any) => ({
        product_id: Number(row.product_id),
        quantity: Number(row.quantity),
        unit_price: Number(row.unit_price),
        unit_cost: Number(row.unit_cost),
        applied_discount_pct: Number(row.applied_discount_pct),
      })),
      Number(quote.tax_rate_pct),
      Number(quote.order_discount_pct || 0)
    );

    const days = PAYMENT_TERM_DAYS[quote.payment_terms] ?? 30;
    const dueDate = new Date(Date.now() + days * 86400000).toISOString();

    const invoice = await withTransaction(async (client) => {
      const invoiceNumber = await generateInvoiceNumber(client);
      const insertResult = await client.query(
        `INSERT INTO invoices
           (invoice_number, quotation_id, customer_id, currency_code, status,
            due_date, subtotal, discount_total, order_discount_pct, order_discount_amount,
            tax_rate_pct, tax_total, grand_total, total_paid, notes)
         VALUES ($1, $2, $3, $4, 'ISSUED', $5, $6, $7, $8, $9, $10, $11, $12, 0, $13)
         RETURNING id`,
        [
          invoiceNumber,
          data.quotation_id,
          Number(quote.customer_id),
          quote.currency_code,
          dueDate,
          calc.subtotal,
          calc.discount_total,
          calc.order_discount_pct,
          calc.order_discount_amount,
          calc.tax_rate_pct,
          calc.tax_total,
          calc.grand_total,
          data.notes ?? null,
        ]
      );
      const invoiceId = insertResult.rows[0].id;

      for (const line of quoteLines) {
        const calcLine = calc.lines.find((l) => Number(l.product_id) === Number(line.product_id));
        await client.query(
          `INSERT INTO invoice_lines
             (invoice_id, quotation_line_id, product_id, product_name, sku, description,
              quantity, unit_price, applied_discount_pct, discount_amount,
              line_subtotal, line_total, unit_cost, line_cost, line_margin)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            invoiceId,
            Number(line.id),
            Number(line.product_id),
            line.product_name,
            line.sku,
            line.description,
            Number(line.quantity),
            Number(line.unit_price),
            Number(line.applied_discount_pct),
            calcLine?.discount_amount ?? 0,
            calcLine?.line_subtotal ?? 0,
            calcLine?.line_total ?? 0,
            Number(line.unit_cost),
            Number(line.unit_cost) * Number(line.quantity),
            calcLine?.line_margin ?? 0,
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, before, after, performed_by, reason)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          "invoices",
          String(invoiceId),
          "INVOICE_CREATED",
          JSON.stringify(null),
          JSON.stringify({
            invoice_number: invoiceNumber,
            quotation_id: Number(data.quotation_id),
            grand_total: Number(calc.grand_total),
            line_count: quoteLines.length,
          }),
          userId,
          "Generated from confirmed quotation",
        ]
      );

      return invoiceId;
    });

    res.status(201).json({ data: await loadInvoice(invoice) });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/invoices/:id
invoicesRouter.get("/:id", requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER, ROLES.SALES_REP), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await loadInvoice(req.params.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/invoices/:id/payments — idempotent by reference
invoicesRouter.post("/:id/payments", requireRole(ROLES.ADMIN, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const data = paymentSchema.parse(req.body);

    const invoiceResult = await query(
      `SELECT id, customer_id, currency_code, grand_total, total_paid, status FROM invoices WHERE id = $1`,
      [id]
    );
    if (invoiceResult.rows.length === 0) {
      throw new NotFoundError("Invoice", id);
    }
    const invoice = invoiceResult.rows[0];
    if (invoice.status === "CANCELLED") {
      throw new UnprocessableEntityError("Cannot record a payment on a cancelled invoice");
    }

    // Idempotency: existing reference for this same invoice returns the existing payment.
    const existingPayment = await query(
      `SELECT id FROM invoice_payments WHERE reference = $1`,
      [data.reference]
    );
    if (existingPayment.rows.length > 0) {
      const dupResult = await query(
        `SELECT invoice_id FROM invoice_payments WHERE reference = $1`,
        [data.reference]
      );
      if (Number(dupResult.rows[0].invoice_id) === Number(invoice.id)) {
        res.json({ data: { id: Number(existingPayment.rows[0].id), reference: data.reference, idempotent_replay: true } });
        return;
      }
      throw new ConflictError("Payment reference already used on a different invoice");
    }

    if (data.payment_method === "CREDIT_WALLET") {
      const walletApplied = await withTransaction(async (client) => {
        return applyWalletToInvoice(client, {
          customerId: Number(invoice.customer_id),
          invoiceAmount: data.amount_paid,
          invoiceId: Number(invoice.id),
          currencyCode: invoice.currency_code,
        });
      });
      if (walletApplied <= 0) {
        throw new UnprocessableEntityError("Customer credit wallet balance is 0 or insufficient");
      }
      data.amount_paid = walletApplied;
    }

    const newTotalPaid = Number((Number(invoice.total_paid) + Number(data.amount_paid)).toFixed(4));
    const newStatus =
      newTotalPaid >= Number(invoice.grand_total) - 0.005 ? "PAID" : "PARTIALLY_PAID";

    const paymentId = await withTransaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO invoice_payments
           (invoice_id, reference, amount_paid, payment_date, payment_method, received_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          Number(invoice.id),
          data.reference,
          data.amount_paid,
          data.payment_date ?? new Date().toISOString(),
          data.payment_method,
          userId,
          data.notes ?? null,
        ]
      );
      const pid = insertResult.rows[0].id;

      await client.query(
        `UPDATE invoices SET total_paid = $1, status = $2, updated_at = NOW() WHERE id = $3`,
        [newTotalPaid, newStatus, Number(invoice.id)]
      );

      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, before, after, performed_by, reason)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          "invoice_payments",
          String(pid),
          "PAYMENT_RECORDED",
          JSON.stringify({ total_paid: Number(invoice.total_paid), status: invoice.status }),
          JSON.stringify({ reference: data.reference, amount: data.amount_paid, total_paid: newTotalPaid, status: newStatus }),
          userId,
          "Payment applied to invoice",
        ]
      );

      return pid;
    });

    res.status(201).json({ data: await loadInvoice(String(invoice.id)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/invoices/:id/cancel
invoicesRouter.post("/:id/cancel", requireRole(ROLES.ADMIN, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;

    const invoiceResult = await query(
      `SELECT id, status, total_paid, grand_total FROM invoices WHERE id = $1`,
      [id]
    );
    if (invoiceResult.rows.length === 0) {
      throw new NotFoundError("Invoice", id);
    }
    const invoice = invoiceResult.rows[0];
    if (invoice.status === "CANCELLED") {
      throw new UnprocessableEntityError("Invoice is already cancelled");
    }
    if (invoice.status === "PAID") {
      throw new UnprocessableEntityError("A paid invoice cannot be cancelled");
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE invoices SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
        [Number(invoice.id)]
      );
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, before, after, performed_by, reason)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          "invoices",
          String(invoice.id),
          "INVOICE_CANCELLED",
          JSON.stringify({ status: invoice.status }),
          JSON.stringify({ status: "CANCELLED" }),
          userId,
          "Invoice cancelled",
        ]
      );
    });

    res.json({ data: await loadInvoice(id) });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/credit-notes (paginated)
creditNotesRouter.get("/", requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const countResult = await query(`SELECT COUNT(*) FROM credit_notes`);
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT cn.id, cn.credit_note_number, cn.public_id, cn.invoice_id, cn.customer_id,
              cn.currency_code, cn.amount, cn.reason, cn.status, cn.created_at,
              c.name AS customer_name, i.invoice_number
       FROM credit_notes cn
       JOIN customers c ON cn.customer_id = c.id
       LEFT JOIN invoices i ON cn.invoice_id = i.id
       ORDER BY cn.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      data: result.rows.map((row: any) => ({
        id: Number(row.id),
        credit_note_number: row.credit_note_number,
        public_id: row.public_id,
        invoice_id: row.invoice_id ? Number(row.invoice_id) : null,
        invoice_number: row.invoice_number ?? null,
        customer_id: Number(row.customer_id),
        customer_name: row.customer_name,
        currency_code: row.currency_code,
        amount: Number(row.amount),
        reason: row.reason,
        status: row.status,
        created_at: row.created_at,
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/credit-notes
creditNotesRouter.post("/", requireRole(ROLES.ADMIN, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const data = creditNoteSchema.parse(req.body);

    const customerResult = await query(`SELECT currency_code FROM customers WHERE id = $1`, [data.customer_id]);
    if (customerResult.rows.length === 0) {
      throw new NotFoundError("Customer", data.customer_id);
    }

    let invoice = null;
    if (data.invoice_id) {
      const invoiceResult = await query(
        `SELECT id, customer_id, currency_code, status, total_paid, grand_total FROM invoices WHERE id = $1`,
        [data.invoice_id]
      );
      if (invoiceResult.rows.length === 0) {
        throw new NotFoundError("Invoice", data.invoice_id);
      }
      invoice = invoiceResult.rows[0];
      if (invoice.status === "CANCELLED") {
        throw new UnprocessableEntityError("Cannot issue a credit note against a cancelled invoice");
      }
      if (Number(invoice.customer_id) !== Number(data.customer_id)) {
        throw new UnprocessableEntityError("Credit note customer must match the invoice customer");
      }
    }

    const creditNote = await withTransaction(async (client) => {
      const number = await generateCreditNoteNumber(client);
      const insertResult = await client.query(
        `INSERT INTO credit_notes
           (credit_note_number, invoice_id, customer_id, currency_code, amount, reason, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ISSUED')
         RETURNING id`,
        [
          number,
          data.invoice_id ?? null,
          data.customer_id,
          data.currency_code ?? invoice?.currency_code ?? customerResult.rows[0].currency_code,
          data.amount,
          data.reason,
        ]
      );
      const cnId = insertResult.rows[0].id;

      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, before, after, performed_by, reason)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          "credit_notes",
          String(cnId),
          "CREDIT_NOTE_ISSUED",
          JSON.stringify(null),
          JSON.stringify({
            credit_note_number: number,
            invoice_id: data.invoice_id ?? null,
            amount: data.amount,
            reason: data.reason,
          }),
          userId,
          "Credit note issued",
        ]
      );

      return cnId;
    });

    res.status(201).json({ data: await loadInvoiceDetailOrCreditNote(creditNote) });
  } catch (err) {
    next(err);
  }
});

async function loadInvoiceDetailOrCreditNote(id: number): Promise<any> {
  const result = await query(
    `SELECT cn.id, cn.credit_note_number, cn.public_id, cn.invoice_id, cn.customer_id,
            cn.currency_code, cn.amount, cn.reason, cn.status, cn.created_at,
            c.name AS customer_name, i.invoice_number
     FROM credit_notes cn
     JOIN customers c ON cn.customer_id = c.id
     LEFT JOIN invoices i ON cn.invoice_id = i.id
     WHERE cn.id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Credit note", id);
  return {
    id: Number(row.id),
    credit_note_number: row.credit_note_number,
    public_id: row.public_id,
    invoice_id: row.invoice_id ? Number(row.invoice_id) : null,
    invoice_number: row.invoice_number ?? null,
    customer_id: Number(row.customer_id),
    customer_name: row.customer_name,
    currency_code: row.currency_code,
    amount: Number(row.amount),
    reason: row.reason,
    status: row.status,
    created_at: row.created_at,
  };
}

// ---- Customer portal invoices ----

// GET /api/v1/portal/invoices — customer's own invoices (sanitized)
invoicesPortalRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const result = await query(
      `SELECT i.id, i.invoice_number, i.public_id, i.customer_id, i.currency_code, i.status,
              i.issue_date, i.due_date, i.grand_total, i.total_paid, i.created_at,
              q.quotation_number
       FROM invoices i
       JOIN quotations q ON i.quotation_id = q.id
       WHERE i.customer_id = $1
       ORDER BY i.created_at DESC
       LIMIT 500`,
      [customerId]
    );
    res.json({
      data: result.rows.map((row: any) => ({
        invoice_number: row.invoice_number,
        public_id: row.public_id,
        quotation_number: row.quotation_number,
        currency_code: row.currency_code,
        status: row.status,
        issue_date: row.issue_date,
        due_date: row.due_date,
        grand_total: Number(row.grand_total),
        total_paid: Number(row.total_paid),
        balance_due: Number(Number(row.grand_total - row.total_paid).toFixed(4)),
        created_at: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/portal/invoices/:publicId — owned + sanitized
invoicesPortalRouter.get("/:publicId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const { publicId } = req.params;
    const result = await query(
      `SELECT i.id, i.invoice_number, i.quotation_id, i.customer_id, i.currency_code, i.status,
              i.issue_date, i.due_date, i.grand_total, i.total_paid,
              q.quotation_number
       FROM invoices i
       JOIN quotations q ON i.quotation_id = q.id
       WHERE i.public_id::text = $1`,
      [publicId]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError("Invoice", publicId);
    }
    const invoice = result.rows[0];
    if (Number(invoice.customer_id) !== Number(customerId)) {
      throw new NotFoundError("Invoice", publicId);
    }

    const linesResult = await query(
      `SELECT il.product_name, il.sku, il.description, il.quantity, il.unit_price,
              il.applied_discount_pct, il.discount_amount, il.line_total
       FROM invoice_lines il
       WHERE il.invoice_id = $1
       ORDER BY il.id ASC`,
      [invoice.id]
    );
    const paymentsResult = await query(
      `SELECT ip.reference, ip.amount_paid, ip.payment_method, ip.payment_date
       FROM invoice_payments ip
       WHERE ip.invoice_id = $1
       ORDER BY ip.payment_date ASC`,
      [invoice.id]
    );

    res.json({
      data: {
        invoice_number: invoice.invoice_number,
        quotation_number: invoice.quotation_number,
        currency_code: invoice.currency_code,
        status: invoice.status,
        issue_date: invoice.issue_date,
        due_date: invoice.due_date,
        grand_total: Number(invoice.grand_total),
        total_paid: Number(invoice.total_paid),
        balance_due: Number(Number(invoice.grand_total - invoice.total_paid).toFixed(4)),
        lines: linesResult.rows.map((row: any) => ({
          product_name: row.product_name,
          sku: row.sku,
          description: row.description,
          quantity: Number(row.quantity),
          unit_price: Number(row.unit_price),
          applied_discount_pct: Number(row.applied_discount_pct),
          discount_amount: Number(row.discount_amount),
          line_total: Number(row.line_total),
        })),
        payments: paymentsResult.rows.map((row: any) => ({
          reference: row.reference,
          amount_paid: Number(row.amount_paid),
          payment_method: row.payment_method,
          payment_date: row.payment_date,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/portal/invoices/:publicId/apply-wallet — customer credit wallet invoice payment
invoicesPortalRouter.post("/:publicId/apply-wallet", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const { publicId } = req.params;

    const result = await query(
      `SELECT id, invoice_number, customer_id, currency_code, status, grand_total, total_paid
       FROM invoices WHERE public_id::text = $1`,
      [publicId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Invoice", publicId);
    }
    const invoice = result.rows[0];
    if (Number(invoice.customer_id) !== Number(customerId)) {
      throw new NotFoundError("Invoice", publicId);
    }
    if (invoice.status === "CANCELLED" || invoice.status === "PAID") {
      throw new UnprocessableEntityError(`Invoice is already ${invoice.status.toLowerCase()}`);
    }

    const balanceDue = Number(Number(invoice.grand_total - invoice.total_paid).toFixed(4));
    if (balanceDue <= 0) {
      throw new UnprocessableEntityError("Invoice has no balance due");
    }

    const { offset, newTotalPaid, newStatus } = await withTransaction(async (client) => {
      const walletOffset = await applyWalletToInvoice(client, {
        customerId,
        invoiceAmount: balanceDue,
        invoiceId: Number(invoice.id),
        currencyCode: invoice.currency_code,
      });

      if (walletOffset <= 0) {
        throw new UnprocessableEntityError("Credit wallet balance is 0 or insufficient");
      }

      const totalPaid = Number((Number(invoice.total_paid) + walletOffset).toFixed(4));
      const status = totalPaid >= Number(invoice.grand_total) - 0.005 ? "PAID" : "PARTIALLY_PAID";

      await client.query(
        `UPDATE invoices SET wallet_offset_amount = COALESCE(wallet_offset_amount, 0) + $1, total_paid = $2, status = $3, updated_at = NOW() WHERE id = $4`,
        [walletOffset, totalPaid, status, Number(invoice.id)]
      );

      await client.query(
        `INSERT INTO invoice_payments
           (invoice_id, reference, amount_paid, payment_date, payment_method, received_by, notes)
         VALUES ($1, $2, $3, NOW(), 'CREDIT_WALLET', NULL, $4)`,
        [Number(invoice.id), `WAL-${Date.now().toString(36).toUpperCase()}`, walletOffset, "Applied from Customer Credit Wallet"]
      );

      return { offset: walletOffset, newTotalPaid: totalPaid, newStatus: status };
    });

    res.json({
      data: {
        applied_amount: offset,
        invoice_number: invoice.invoice_number,
        new_total_paid: newTotalPaid,
        new_status: newStatus,
      },
    });
  } catch (err) {
    next(err);
  }
});
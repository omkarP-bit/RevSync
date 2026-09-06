import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError, ConflictError } from "../../shared/errors.js";
import { z } from "zod";

export const currenciesRouter = Router();
currenciesRouter.use(authenticate);

const currencySchema = z.object({
  code: z.string().length(3),
  name: z.string().min(1).max(100),
  symbol: z.string().min(1).max(10),
  is_active: z.boolean().default(true),
});

const exchangeRateSchema = z.object({
  from_currency_code: z.string().length(3),
  to_currency_code: z.string().length(3),
  rate: z.number().positive(),
});

currenciesRouter.get("/rates", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.SALES_REP, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const base = String((req.query.base as string) || "USD").toUpperCase();

    const result = await query(
      `SELECT c.code, c.name, c.symbol, c.is_active,
              COALESCE(er.rate, 1) AS rate
       FROM currencies c
       LEFT JOIN LATERAL (
         SELECT rate FROM exchange_rates
         WHERE from_currency_code = $1 AND to_currency_code = c.code
         ORDER BY effective_at DESC
         LIMIT 1
       ) er ON true
       WHERE c.is_active = true
       ORDER BY c.code ASC`,
      [base]
    );

    const currencies: Record<string, { name: string; symbol: string; rate: number }> = {};
    for (const row of result.rows) {
      currencies[row.code] = {
        name: row.name,
        symbol: row.symbol,
        rate: Number(row.rate) || 1,
      };
    }

    res.json({ data: { base_currency: base, currencies } });
  } catch (err) {
    next(err);
  }
});

currenciesRouter.get("/", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.SALES_REP, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const countResult = await query("SELECT COUNT(*) FROM currencies");
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT id, code, name, symbol, is_active, created_at
       FROM currencies
       ORDER BY code ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      data: result.rows,
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

currenciesRouter.post("/", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = currencySchema.parse(req.body);
    const result = await query(
      "INSERT INTO currencies (code, name, symbol, is_active) VALUES ($1, $2, $3, $4) RETURNING *",
      [data.code.toUpperCase(), data.name, data.symbol, data.is_active]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err: any) {
    if (err.code === "23505") {
      return next(new ConflictError(`Currency with code ${req.body.code} already exists`));
    }
    next(err);
  }
});

currenciesRouter.get("/exchange-rates", requireRole(ROLES.ADMIN, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      `SELECT er.id, er.from_currency_code, er.to_currency_code, er.rate, er.effective_at,
              fc.name as from_currency_name, tc.name as to_currency_name
       FROM exchange_rates er
       JOIN currencies fc ON er.from_currency_code = fc.code
       JOIN currencies tc ON er.to_currency_code = tc.code
       ORDER BY er.effective_at DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

currenciesRouter.post("/exchange-rates", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = exchangeRateSchema.parse(req.body);
    if (data.from_currency_code === data.to_currency_code) {
      throw new ValidationError("from_currency_code and to_currency_code must be different");
    }
    const result = await query(
      `INSERT INTO exchange_rates (from_currency_code, to_currency_code, rate, effective_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [data.from_currency_code.toUpperCase(), data.to_currency_code.toUpperCase(), data.rate]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

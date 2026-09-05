import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";
import { loadConfig } from "../../config.js";
import { query } from "../../database/pool.js";
import { UnauthorizedError, ValidationError, NotFoundError } from "../../shared/errors.js";

export const customerAuthRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

const setupPasswordSchema = z.object({
  setup_token: z.string().min(1, "Setup token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

// POST /api/v1/auth/customer/login
customerAuthRouter.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const result = await query(
      `SELECT c.id, c.name, c.email, c.company, c.status, c.currency_code,
              c.tier_id, ct.name as tier_name, c.password_hash
       FROM customers c
       LEFT JOIN customer_tiers ct ON c.tier_id = ct.id
       WHERE LOWER(c.email) = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const customer = result.rows[0];

    if (customer.status !== "ACTIVE") {
      throw new UnauthorizedError("Customer account is not active");
    }

    if (!customer.password_hash) {
      throw new UnauthorizedError("Password not set. Please set up your password via the account setup link.");
    }

    const valid = await bcrypt.compare(password, customer.password_hash);
    if (!valid) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const config = loadConfig();
    const tokenPayload = { customerId: Number(customer.id), email: customer.email };
    const accessToken = jwt.sign(tokenPayload, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN as any,
    });

    res.json({
      data: {
        token: accessToken,
        customer: {
          id: Number(customer.id),
          name: customer.name,
          email: customer.email,
          company: customer.company,
          status: customer.status,
          currency_code: customer.currency_code,
          tier_name: customer.tier_name || "STANDARD",
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/customer/setup-password
customerAuthRouter.post("/setup-password", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { setup_token, password } = setupPasswordSchema.parse(req.body);
    const tokenHash = crypto.createHash("sha256").update(setup_token).digest("hex");

    const result = await query(
      `SELECT c.id, c.name, c.email, c.company, c.status, c.currency_code,
              c.tier_id, ct.name as tier_name
       FROM customers c
       LEFT JOIN customer_tiers ct ON c.tier_id = ct.id
       WHERE c.setup_token_hash = $1 AND c.setup_token_expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      throw new ValidationError("Invalid or expired password setup token");
    }

    const customer = result.rows[0];
    const passwordHash = await bcrypt.hash(password, 10);

    await query(
      `UPDATE customers
       SET password_hash = $1, setup_token_hash = NULL, setup_token_expires_at = NULL, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, customer.id]
    );

    const config = loadConfig();
    const tokenPayload = { customerId: Number(customer.id), email: customer.email };
    const accessToken = jwt.sign(tokenPayload, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN as any,
    });

    res.json({
      data: {
        token: accessToken,
        customer: {
          id: Number(customer.id),
          name: customer.name,
          email: customer.email,
          company: customer.company,
          status: customer.status,
          currency_code: customer.currency_code,
          tier_name: customer.tier_name || "STANDARD",
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

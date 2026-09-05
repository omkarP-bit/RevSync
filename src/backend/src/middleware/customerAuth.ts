import { Request, Response, NextFunction } from "express";
import { UnauthorizedError, ForbiddenError } from "../shared/errors.js";
import { query } from "../database/pool.js";
import jwt from "jsonwebtoken";
import { loadConfig } from "../config.js";
import type { JwtPayload } from "./auth.js";

export interface CustomerJwtPayload {
  customerId: number;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      customer?: CustomerJwtPayload;
    }
  }
}

export function authenticateCustomer(req: Request, _res: Response, next: NextFunction): void {
  const config = loadConfig();
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Missing or invalid authorization header"));
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as CustomerJwtPayload;
    req.customer = payload;
    next();
  } catch {
    next(new UnauthorizedError("Invalid or expired token"));
  }
}

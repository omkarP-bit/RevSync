import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { loadConfig } from "../config.js";
import { UnauthorizedError, ForbiddenError } from "../shared/errors.js";

export interface JwtPayload {
  userId: number;
  roleId: number;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const config = loadConfig();
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Missing or invalid authorization header"));
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    next(new UnauthorizedError("Invalid or expired token"));
  }
}

export function requireRole(...roleIds: number[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    if (roleIds.length > 0 && !roleIds.includes(req.user.roleId)) {
      return next(new ForbiddenError("Insufficient permissions"));
    }
    next();
  };
}

// Role IDs (matched with seed data in migration):
// 1 = Sales Rep, 2 = Sales Manager, 3 = Finance, 4 = Warehouse Manager, 5 = Admin
export const ROLES = {
  SALES_REP: 1,
  SALES_MANAGER: 2,
  FINANCE: 3,
  WAREHOUSE_MANAGER: 4,
  ADMIN: 5,
} as const;

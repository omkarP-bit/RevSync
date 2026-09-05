import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../shared/errors.js";
import { getLogger } from "../shared/logger.js";

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const logger = getLogger();
  const requestId = (req as any).id || "unknown";

  if (err instanceof AppError) {
    logger.warn(`[${requestId}] ${err.code}: ${err.message}`);
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({ field: e.path.join("."), message: e.message }));
    logger.warn(`[${requestId}] VALIDATION_ERROR: Validation failed`);
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Validation failed", details },
    });
    return;
  }

  logger.error(`[${requestId}] INTERNAL_ERROR: ${err.message}`);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Internal server error", details: [] },
  });
}

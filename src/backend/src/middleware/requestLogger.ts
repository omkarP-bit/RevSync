import { Request, Response, NextFunction } from "express";
import { getLogger } from "../shared/logger.js";

// Derive the API module from the request path, e.g. /api/v1/customers -> customers.
function moduleFromPath(path: string): string {
  const match = /\/api\/v1\/([^/]+)/.exec(path);
  return match ? match[1] : "unknown";
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const logger = getLogger();
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info({
      requestId: (req as any).id,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      module: moduleFromPath(req.originalUrl),
      userId: (req as any).userId,
    });
  });

  next();
}

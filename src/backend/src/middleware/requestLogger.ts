import { Request, Response, NextFunction } from "express";
import { getLogger } from "../shared/logger.js";

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
      userId: (req as any).userId,
    });
  });

  next();
}

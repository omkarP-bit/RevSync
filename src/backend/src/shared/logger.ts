import winston from "winston";
import { loadConfig } from "../config.js";

let _logger: winston.Logger | null = null;

export function getLogger(): winston.Logger {
  if (_logger) return _logger;
  const config = loadConfig();
  _logger = winston.createLogger({
    level: config.LOG_LEVEL,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: "dealflow360-backend" },
    transports: [new winston.transports.Console()],
  });
  return _logger;
}

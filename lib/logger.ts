// lib/logger.ts
import winston from "winston";
import { env } from "./env";

const isProd = env.NODE_ENV === "production";

const logger = winston.createLogger({
  level: isProd ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    isProd
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length
              ? ` ${JSON.stringify(meta)}`
              : "";
            return `${timestamp} [${level}]: ${message}${metaStr}`;
          })
        )
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: ["error", "warn"],
    }),
  ],
});

// Graceful shutdown helper
export function shutdownLogger() {
  logger.info("Shutting down logger...");
  logger.end();
}

export default logger;

// Convenience methods
export const log = {
  info: (msg: string, meta?: any) => logger.info(msg, meta),
  warn: (msg: string, meta?: any) => logger.warn(msg, meta),
  error: (msg: string | Error, meta?: any) => {
    if (msg instanceof Error) {
      logger.error(msg.message, { ...meta, stack: msg.stack });
    } else {
      logger.error(msg, meta);
    }
  },
  debug: (msg: string, meta?: any) => logger.debug(msg, meta),
};
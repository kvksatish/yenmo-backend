import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  logFilePath: process.env.LOG_FILE_PATH || path.resolve(process.cwd(), 'sample.log'),
} as const;

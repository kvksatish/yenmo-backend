import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { startWatching } from './utils/fileWatcher.js';
import { handleInit, broadcastLines, broadcastTruncate } from './routes/sse.js';

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', routes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start watching the log file and wire up SSE broadcasting
startWatching(config.logFilePath, broadcastLines, handleInit, broadcastTruncate);

export default app;

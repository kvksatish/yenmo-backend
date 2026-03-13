import app from './app.js';
import { config } from './config/env.js';

app.listen(config.port, () => {
  console.log(`[server] Running on http://localhost:${config.port} (${config.nodeEnv})`);
});

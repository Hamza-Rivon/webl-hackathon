/**
 * WEBL API Server Entry Point
 *
 * This is the main entry point for the WEBL REST API service.
 * It initializes the Express server with all middleware and routes.
 */

import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from '@webl/shared';
import { createServer } from 'http';
import { activityRealtimeGateway } from './realtime/gateway.js';

const PORT = config.port;

async function main() {
  try {
    const app = await createApp();
    const server = createServer(app);
    await activityRealtimeGateway.attach(server);

    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 WEBL API server running on port ${PORT}`);
      logger.info(`📍 Environment: ${config.nodeEnv}`);
      logger.info(`📡 Listening on all interfaces (0.0.0.0:${PORT})`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();

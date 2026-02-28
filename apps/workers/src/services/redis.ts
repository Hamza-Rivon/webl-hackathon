/**
 * Redis Connection
 *
 * Configures Redis connection for BullMQ job queues.
 */

import IORedis from 'ioredis';
import { config } from '../config.js';

// Upstash Redis requires TLS - detect from URL or enable for Upstash domains
const redisUrl = config.redis.url;
const isUpstash = redisUrl.includes('upstash.io');

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Enable TLS for Upstash Redis
  ...(isUpstash && {
    tls: {
      rejectUnauthorized: true,
    },
  }),
});

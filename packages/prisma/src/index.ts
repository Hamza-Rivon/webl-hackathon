/**
 * Prisma Client with Conditional Adapter
 *
 * Uses Neon serverless adapter for Neon databases, standard client for local PostgreSQL.
 */

import { neonConfig, type PoolConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import type { WebSocket } from 'ws';

const connectionString = process.env.DATABASE_URL!;

// Detect if we're using Neon (serverless) or local PostgreSQL
const isNeonDatabase = (url: string): boolean => {
  // Neon URLs typically contain 'neon' or use serverless format
  // Local PostgreSQL URLs are standard postgresql:// format
  return url.includes('neon.tech') || 
         url.includes('neon') || 
         url.startsWith('postgresql://') === false ||
         url.includes('pooler');
};

const useNeonAdapter = isNeonDatabase(connectionString);

// Required for Neon serverless in Node.js environment
// This enables WebSocket connections in Node.js
async function configureNeon(): Promise<void> {
  if (typeof globalThis.WebSocket === 'undefined') {
    const ws = await import('ws');
    neonConfig.webSocketConstructor = ws.default as unknown as typeof WebSocket;
  }
}

let prismaClient: PrismaClient | null = null;

async function createPrismaClient(): Promise<PrismaClient> {
  if (prismaClient) {
    return prismaClient;
  }

  if (useNeonAdapter) {
    await configureNeon();
    const poolConfig: PoolConfig = { connectionString };
    const adapter = new PrismaNeon(poolConfig);
    prismaClient = new PrismaClient({ adapter });
  } else {
    // Use standard PrismaClient for local PostgreSQL
    prismaClient = new PrismaClient();
  }

  return prismaClient;
}

// Synchronous client creation (for compatibility)
function createPrismaClientSync(): PrismaClient {
  if (useNeonAdapter) {
    const poolConfig: PoolConfig = { connectionString };
    const adapter = new PrismaNeon(poolConfig);
    return new PrismaClient({ adapter });
  } else {
    // Use standard PrismaClient for local PostgreSQL
    return new PrismaClient();
  }
}

// For development, prevent multiple instances during hot reload
declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

// Initialize WebSocket constructor if in Node.js and using Neon
if (useNeonAdapter && typeof globalThis.WebSocket === 'undefined') {
  import('ws').then((ws) => {
    neonConfig.webSocketConstructor = ws.default as unknown as typeof WebSocket;
  });
}

export const prisma: PrismaClient =
  process.env.NODE_ENV === 'production'
    ? createPrismaClientSync()
    : (global.__prisma__ ??= createPrismaClientSync());

// Export async client creator for better initialization
export { createPrismaClient };

// Re-export Prisma types
export * from '@prisma/client';

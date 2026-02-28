/**
 * Prisma Client with Neon Serverless Adapter
 *
 * Configured for serverless deployment with connection pooling.
 */
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
// Required for Neon serverless in Node.js environment
// This enables WebSocket connections in Node.js
async function configureNeon() {
    if (typeof globalThis.WebSocket === 'undefined') {
        const ws = await import('ws');
        neonConfig.webSocketConstructor = ws.default;
    }
}
const connectionString = process.env.DATABASE_URL;
let prismaClient = null;
async function createPrismaClient() {
    if (prismaClient) {
        return prismaClient;
    }
    await configureNeon();
    const poolConfig = { connectionString };
    const adapter = new PrismaNeon(poolConfig);
    prismaClient = new PrismaClient({ adapter });
    return prismaClient;
}
// Synchronous client creation (for compatibility)
function createPrismaClientSync() {
    const poolConfig = { connectionString };
    const adapter = new PrismaNeon(poolConfig);
    return new PrismaClient({ adapter });
}
// Initialize WebSocket constructor if in Node.js
if (typeof globalThis.WebSocket === 'undefined') {
    import('ws').then((ws) => {
        neonConfig.webSocketConstructor = ws.default;
    });
}
export const prisma = process.env.NODE_ENV === 'production'
    ? createPrismaClientSync()
    : (global.__prisma__ ??= createPrismaClientSync());
// Export async client creator for better initialization
export { createPrismaClient };
// Re-export Prisma types
export * from '@prisma/client';
//# sourceMappingURL=index.js.map
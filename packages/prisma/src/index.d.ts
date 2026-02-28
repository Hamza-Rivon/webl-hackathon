/**
 * Prisma Client with Neon Serverless Adapter
 *
 * Configured for serverless deployment with connection pooling.
 */
import { PrismaClient } from '@prisma/client';
declare function createPrismaClient(): Promise<PrismaClient>;
declare global {
    var __prisma__: PrismaClient | undefined;
}
export declare const prisma: PrismaClient;
export { createPrismaClient };
export * from '@prisma/client';
//# sourceMappingURL=index.d.ts.map
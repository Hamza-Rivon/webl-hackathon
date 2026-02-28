/**
 * Webhook Routes
 *
 * Handles incoming webhooks from Clerk (user sync) and Mux (video processing).
 */

import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { config } from '../config/index.js';
import { logger } from '@webl/shared';
import { prisma } from '@webl/prisma';
import { muxService } from '../services/mux.js';

export const webhooksRouter = Router();

// ==================== CLERK WEBHOOKS ====================

function getRawBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }
  if (typeof req.body === 'string') {
    return req.body;
  }
  return JSON.stringify(req.body ?? {});
}

function getSvixHeader(headerValue: string | string[] | undefined): string | null {
  if (Array.isArray(headerValue)) {
    return typeof headerValue[0] === 'string' ? headerValue[0] : null;
  }
  return typeof headerValue === 'string' ? headerValue : null;
}

function resolvePrimaryEmail(payload: ClerkWebhookPayload['data']): string {
  return payload.email_addresses?.[0]?.email_address || `${payload.id}@no-email.webl.local`;
}

interface ClerkWebhookPayload {
  type: string;
  data: {
    id: string;
    email_addresses?: Array<{ email_address: string }>;
    first_name?: string;
    last_name?: string;
    image_url?: string;
    created_at?: number;
    updated_at?: number;
  };
}

webhooksRouter.post('/clerk', async (req: Request, res: Response) => {
  const rawBody = getRawBody(req);
  const headers = req.headers;

  try {
    if (!config.clerk.webhookSecret) {
      logger.error('Clerk webhook secret is missing. Set CLERK_WEBHOOK_SIGNING_SECRET.');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    const svixId = getSvixHeader(headers['svix-id']);
    const svixTimestamp = getSvixHeader(headers['svix-timestamp']);
    const svixSignature = getSvixHeader(headers['svix-signature']);

    if (!svixId || !svixTimestamp || !svixSignature) {
      return res.status(400).json({ error: 'Missing required Svix headers' });
    }

    const wh = new Webhook(config.clerk.webhookSecret);
    const evt = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookPayload;

    const { type, data } = evt;

    switch (type) {
      case 'user.created':
      case 'user.updated':
        await prisma.user.upsert({
          where: { id: data.id },
          create: {
            id: data.id,
            email: resolvePrimaryEmail(data),
            firstName: data.first_name || null,
            lastName: data.last_name || null,
            imageUrl: data.image_url || null,
          },
          update: {
            email: resolvePrimaryEmail(data),
            firstName: data.first_name || null,
            lastName: data.last_name || null,
            imageUrl: data.image_url || null,
          },
        });
        logger.info(`User synced from Clerk webhook: ${data.id} (${type})`);
        break;

      case 'user.deleted':
        await prisma.user.deleteMany({ where: { id: data.id } });
        logger.info(`User deleted: ${data.id}`);
        break;

      default:
        logger.debug(`Unhandled Clerk webhook type: ${type}`);
    }

    return res.json({ received: true });
  } catch (err) {
    logger.error('Clerk webhook verification failed:', err);
    return res.status(400).json({ error: 'Webhook verification failed' });
  }
});

// ==================== MUX WEBHOOKS ====================

interface MuxWebhookEvent {
  type: string;
  data: {
    id: string;
    passthrough?: string;
    status?: string;
    duration?: number;
    aspect_ratio?: string;
    max_stored_resolution?: string;
    playback_ids?: Array<{ id: string; policy: string }>;
    tracks?: Array<{
      id: string;
      type: string;
      max_width?: number;
      max_height?: number;
      duration?: number;
    }>;
    errors?: {
      type: string;
      messages: string[];
    };
  };
}

/**
 * POST /webhooks/mux - Mux webhook handler
 *
 * Handles Mux video processing events.
 */
webhooksRouter.post('/mux', async (req: Request, res: Response) => {
  const rawBody = getRawBody(req);
  const headers = req.headers;

  try {
    // Verify webhook signature if secret is configured
    let event: MuxWebhookEvent;

    if (config.mux.webhookSecret) {
      const headerRecord = headers as Record<string, string | string[] | undefined>;
      event = muxService.verifyWebhookSignature(rawBody, headerRecord) as MuxWebhookEvent;
    } else {
      // Development mode - parse without verification
      logger.warn('Mux webhook received without signature verification (dev mode)');
      event = JSON.parse(rawBody);
    }

    const { type, data } = event;

    logger.info(`Mux webhook received: ${type}`, { assetId: data.id, passthrough: data.passthrough });

    logger.debug(`Unhandled Mux webhook type: ${type}`);

    res.json({ received: true });
  } catch (err) {
    logger.error('Mux webhook processing failed:', err);
    res.status(400).json({ error: 'Webhook processing failed' });
  }
});

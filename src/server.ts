import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';
import {
  listGuildEmojis,
  publishListing,
  publishReview,
  removeListing,
  removeReview,
  sendPasswordReset,
  sendVerificationCode,
  updateListing,
} from './discord.ts';
import { isListingPayload, isReviewPayload } from './types.ts';

const MAX_BODY_BYTES = 64 * 1024;

function authorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;

  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(config.sharedSecret);
  // Compare in constant time; bail on length first since timingSafeEqual throws
  // on mismatched lengths (and length alone is not a useful secret).
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Payload too large');
    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);

  // Unauthenticated liveness probe — useful for the website to show whether the
  // bot is reachable before offering to link an account.
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true });
  }

  // The website's review emoji picker reads this; authenticated but a GET,
  // since it is a plain read with no side effects.
  if (req.method === 'GET' && url.pathname === '/emojis') {
    if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });
    const emojis = await listGuildEmojis();
    return json(res, 200, { emojis });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }
  if (!authorized(req)) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const body = await readJson(req);

  if (url.pathname === '/events/listing') {
    const { action, listing } = (body ?? {}) as Record<string, unknown>;

    if (action === 'deleted') {
      // Deletion only needs the id — the row is already gone on the site.
      const id = isListingPayload(listing) ? listing.id : (listing as { id?: string })?.id;
      if (typeof id !== 'string') return json(res, 400, { error: 'listing.id required' });
      await removeListing(id);
      return json(res, 200, { ok: true });
    }

    if (!isListingPayload(listing)) {
      return json(res, 400, { error: 'Invalid listing payload' });
    }
    if (action === 'created') await publishListing(listing);
    else if (action === 'updated') await updateListing(listing);
    else return json(res, 400, { error: 'Unknown action' });

    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/events/review') {
    const { action, review } = (body ?? {}) as Record<string, unknown>;

    if (action === 'deleted') {
      const id = (review as { id?: string })?.id;
      if (typeof id !== 'string') return json(res, 400, { error: 'review.id required' });
      await removeReview(id);
      return json(res, 200, { ok: true });
    }

    if (!isReviewPayload(review)) {
      return json(res, 400, { error: 'Invalid review payload' });
    }
    if (action !== 'created') return json(res, 400, { error: 'Unknown action' });

    await publishReview(review);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/password-reset') {
    const { discordId, code, siteUsername } = (body ?? {}) as Record<string, unknown>;
    if (
      typeof discordId !== 'string' ||
      typeof code !== 'string' ||
      typeof siteUsername !== 'string'
    ) {
      return json(res, 400, { error: 'discordId, code and siteUsername required' });
    }

    const result = await sendPasswordReset(discordId, code, siteUsername);
    return json(res, 200, result);
  }

  if (url.pathname === '/link/request') {
    const { discordUsername, code, siteUsername } = (body ?? {}) as Record<string, unknown>;
    if (
      typeof discordUsername !== 'string' ||
      typeof code !== 'string' ||
      typeof siteUsername !== 'string'
    ) {
      return json(res, 400, { error: 'discordUsername, code and siteUsername required' });
    }

    const result = await sendVerificationCode(discordUsername, code, siteUsername);
    // A failed lookup is a normal outcome the site needs to show the user, not a
    // server error — so it comes back 200 with ok:false and a reason.
    return json(res, 200, result);
  }

  return json(res, 404, { error: 'Not found' });
}

export function startServer(): Server {
  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error('[qolhelper] request failed:', error);
      if (!res.headersSent) json(res, 500, { error: 'Internal error' });
    });
  });

  server.listen(config.port, config.host, () => {
    console.log(`[qolhelper] listening on ${config.host}:${config.port}`);
  });

  return server;
}

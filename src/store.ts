import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

/**
 * The bot's only persistent state: which Discord post corresponds to which
 * website row. Without it an "updated" event has no idea what to edit.
 *
 * Uses node:sqlite (built into Node 22.5+) so there is no native module to
 * compile on Windows. It is still flagged experimental, hence the startup
 * warning; the API used here is a stable subset.
 */
const db = new DatabaseSync(config.databaseFile);

db.exec(`
  CREATE TABLE IF NOT EXISTS listing_posts (
    listing_id  TEXT PRIMARY KEY,
    category    TEXT NOT NULL,
    thread_id   TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS review_posts (
    review_id   TEXT PRIMARY KEY,
    listing_id  TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
`);

export type ListingPost = {
  listingId: string;
  category: string;
  threadId: string;
  messageId: string;
};

export function getListingPost(listingId: string): ListingPost | null {
  const row = db
    .prepare('SELECT listing_id, category, thread_id, message_id FROM listing_posts WHERE listing_id = ?')
    .get(listingId) as Record<string, string> | undefined;

  if (!row) return null;
  return {
    listingId: row.listing_id!,
    category: row.category!,
    threadId: row.thread_id!,
    messageId: row.message_id!,
  };
}

export function saveListingPost(post: ListingPost): void {
  db.prepare(
    `INSERT INTO listing_posts (listing_id, category, thread_id, message_id, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(listing_id) DO UPDATE SET
       category = excluded.category,
       thread_id = excluded.thread_id,
       message_id = excluded.message_id,
       updated_at = excluded.updated_at`
  ).run(post.listingId, post.category, post.threadId, post.messageId, new Date().toISOString());
}

export function deleteListingPost(listingId: string): void {
  db.prepare('DELETE FROM listing_posts WHERE listing_id = ?').run(listingId);
}

export function getReviewMessageId(reviewId: string): string | null {
  const row = db
    .prepare('SELECT message_id FROM review_posts WHERE review_id = ?')
    .get(reviewId) as Record<string, string> | undefined;
  return row?.message_id ?? null;
}

export function saveReviewPost(reviewId: string, listingId: string, messageId: string): void {
  db.prepare(
    `INSERT INTO review_posts (review_id, listing_id, message_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(review_id) DO UPDATE SET message_id = excluded.message_id`
  ).run(reviewId, listingId, messageId, new Date().toISOString());
}

export function deleteReviewPost(reviewId: string): void {
  db.prepare('DELETE FROM review_posts WHERE review_id = ?').run(reviewId);
}

/** Review posts belonging to a listing, so deleting a listing can clean up. */
export function getReviewIdsForListing(listingId: string): { reviewId: string; messageId: string }[] {
  const rows = db
    .prepare('SELECT review_id, message_id FROM review_posts WHERE listing_id = ?')
    .all(listingId) as Record<string, string>[];
  return rows.map((r) => ({ reviewId: r.review_id!, messageId: r.message_id! }));
}

// Payload shapes the website sends. Kept deliberately narrow: the bot validates
// what it needs and ignores everything else, so adding a column to the site's
// schema never breaks the bot.

export type ListingPayload = {
  id: string;
  name: string;
  description: string;
  category: string;
  developer: string | null;
  url: string;
  secondaryUrl: string | null;
  isTrusted: boolean;
  /** FREE | PAID | FREEMIUM, or null when not recorded. Optional on the wire so
   *  an older website build still validates. */
  pricing?: string | null;
  /** What it costs, as free text ("5€ / month"). Same reasoning: optional, and
   *  only ever set alongside PAID or FREEMIUM. */
  price?: string | null;
};

export type ReviewPayload = {
  id: string;
  rating: number;
  body: string;
  username: string;
  listingId: string;
  listingName: string;
};

export type AnnouncementPayload = {
  id: string;
  listingId: string;
  listingName: string;
  body: string;
  /** Site username of the team member who published it. */
  author: string;
  /** Absolute URL of the listing page, so readers can get back to it. */
  url: string;
};

export type ChangeRequestPayload = {
  listingName: string;
  /** Site username of the team member who proposed it. */
  author: string;
  /** Human-readable "Name, Description, Primary link" — what actually differs. */
  fields: string[];
  note: string | null;
  /** Where to go and decide: the admin queue. */
  url: string;
  /** Discord ids to DM. Resolved by the site, which knows who its admins are. */
  recipients: string[];
};

export type ListingEvent = {
  action: 'created' | 'updated' | 'deleted';
  listing: ListingPayload;
};

export type ReviewEvent = {
  action: 'created' | 'deleted';
  review: ReviewPayload;
};

export type LinkRequest = {
  discordUsername: string;
  code: string;
  siteUsername: string;
};

export function isAnnouncementPayload(value: unknown): value is AnnouncementPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.listingId === 'string' &&
    typeof v.body === 'string' &&
    typeof v.author === 'string'
  );
}

export function isChangeRequestPayload(value: unknown): value is ChangeRequestPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.listingName === 'string' &&
    typeof v.author === 'string' &&
    typeof v.url === 'string' &&
    Array.isArray(v.recipients) &&
    v.recipients.every((r) => typeof r === 'string')
  );
}

export function isListingPayload(value: unknown): value is ListingPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.description === 'string' &&
    typeof v.category === 'string' &&
    typeof v.url === 'string' &&
    typeof v.isTrusted === 'boolean'
  );
}

export function isReviewPayload(value: unknown): value is ReviewPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.rating === 'number' &&
    typeof v.body === 'string' &&
    typeof v.username === 'string' &&
    typeof v.listingId === 'string'
  );
}

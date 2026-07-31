// All configuration comes from the environment. Anything missing that the bot
// genuinely cannot run without fails loudly at boot rather than at 2am when the
// first listing is published.

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

/**
 * Category keys mirror src/lib/categories.ts in the betterqolhub-v2 repo, which
 * is the source of truth. That file says the website, API, admin form and this
 * bot must all agree on these identifiers — so if a category is added there, add
 * it here and give it a forum channel.
 */
export const CATEGORY_KEYS = [
  'CHEAT_CLIENT',
  'MACRO_CLIENT',
  'LEGIT_MOD',
  'SHOP',
  'OTHER',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_META: Record<CategoryKey, { label: string; color: number }> = {
  // Colours are the Minecraft chat colours the site draws each category in, as
  // integers because that is what Discord embeds take. The rarity words that
  // used to accompany them were dropped on the site, so they are gone here too.
  CHEAT_CLIENT: { label: 'Cheat Clients', color: 0xff5555 },
  MACRO_CLIENT: { label: 'Macro Clients', color: 0xff55ff },
  LEGIT_MOD: { label: 'Legit Mods', color: 0x55ff55 },
  SHOP: { label: 'Shops', color: 0xffaa00 },
  OTHER: { label: 'Other', color: 0x55ffff },
};

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === 'string' && (CATEGORY_KEYS as readonly string[]).includes(value);
}

/** One forum channel per category, e.g. FORUM_CHEAT_CLIENT=123456789. */
function readForumChannels(): Record<CategoryKey, string> {
  const entries = CATEGORY_KEYS.map((key) => [key, required(`FORUM_${key}`)] as const);
  return Object.fromEntries(entries) as Record<CategoryKey, string>;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  guildId: required('DISCORD_GUILD_ID'),
  forumChannels: readForumChannels(),
  reviewsChannelId: required('REVIEWS_CHANNEL_ID'),

  /** Shared secret the website presents as `Authorization: Bearer …`. */
  sharedSecret: required('BOT_SHARED_SECRET'),

  port: Number(optional('PORT') ?? 8787),

  /**
   * Interface to bind. Defaults to loopback: when the website runs on the same
   * machine there is no reason to expose this port to the internet, where the
   * shared secret would be the only thing protecting the forum channels. Set to
   * 0.0.0.0 only if the site genuinely calls in from another host — and put it
   * behind TLS and a firewall if you do.
   */
  host: optional('HOST') ?? '127.0.0.1',

  /** Public base URL of the website, used for links back to listings. */
  siteUrl: (optional('SITE_URL') ?? 'http://localhost:3000').replace(/\/$/, ''),

  databaseFile: optional('DATABASE_FILE') ?? './qolhelper.db',
} as const;

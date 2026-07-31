import {
  Client,
  GatewayIntentBits,
  ChannelType,
  DiscordAPIError,
  type ForumChannel,
  type TextChannel,
  type GuildMember,
} from 'discord.js';
import { config, isCategoryKey } from './config.ts';
import { listingEmbed, passwordResetDm, reviewEmbed, verificationDm } from './embeds.ts';
import {
  deleteListingPost,
  deleteReviewPost,
  getListingPost,
  getReviewIdsForListing,
  getReviewMessageId,
  saveListingPost,
  saveReviewPost,
} from './store.ts';
import type { ListingPayload, ReviewPayload } from './types.ts';

// GuildMembers is a *privileged* intent and must be enabled in the Developer
// Portal. Without it, looking a member up by username silently finds nobody,
// which would make Discord linking fail for everyone.
export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const THREAD_NAME_LIMIT = 100;

function threadName(listing: ListingPayload): string {
  const name = listing.isTrusted ? listing.name : `${listing.name} (unverified)`;
  return name.length > THREAD_NAME_LIMIT ? `${name.slice(0, THREAD_NAME_LIMIT - 1)}…` : name;
}

async function getForumChannel(category: string): Promise<ForumChannel> {
  const key = isCategoryKey(category) ? category : 'OTHER';
  const id = config.forumChannels[key];

  const channel = await client.channels.fetch(id);
  if (!channel || channel.type !== ChannelType.GuildForum) {
    throw new Error(`FORUM_${key} (${id}) is not a forum channel.`);
  }
  return channel as ForumChannel;
}

async function getReviewsChannel(): Promise<TextChannel> {
  const channel = await client.channels.fetch(config.reviewsChannelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error(`REVIEWS_CHANNEL_ID (${config.reviewsChannelId}) is not a text channel.`);
  }
  return channel as TextChannel;
}

/** Create the forum post for a listing and remember where it went. */
export async function publishListing(listing: ListingPayload): Promise<void> {
  const existing = getListingPost(listing.id);
  if (existing) {
    // A duplicate "created" (retry, replayed webhook) should not make a second
    // post — treat it as an update instead.
    await updateListing(listing);
    return;
  }

  const forum = await getForumChannel(listing.category);
  const thread = await forum.threads.create({
    name: threadName(listing),
    message: { embeds: [listingEmbed(listing)] },
  });

  const starter = await thread.fetchStarterMessage();
  saveListingPost({
    listingId: listing.id,
    category: listing.category,
    threadId: thread.id,
    messageId: starter?.id ?? '',
  });
}

/** Edit the existing post; move it if the category changed. */
export async function updateListing(listing: ListingPayload): Promise<void> {
  const existing = getListingPost(listing.id);
  if (!existing) {
    await publishListing(listing);
    return;
  }

  // Forum posts cannot move between channels, so a category change means
  // recreating the post in the right forum. Only the post is removed — the
  // listing's reviews are untouched, since they live in a separate channel.
  if (existing.category !== listing.category) {
    await removeListingPost(listing.id);
    await publishListing(listing);
    return;
  }

  try {
    const thread = await client.channels.fetch(existing.threadId);
    if (!thread || !thread.isThread()) {
      // Someone deleted the post in Discord — republish rather than error.
      deleteListingPost(listing.id);
      await publishListing(listing);
      return;
    }

    const starter = existing.messageId
      ? await thread.messages.fetch(existing.messageId)
      : await thread.fetchStarterMessage();

    await starter?.edit({ embeds: [listingEmbed(listing)] });

    const desired = threadName(listing);
    if (thread.name !== desired) {
      await thread.setName(desired);
    }
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 10003) {
      // Unknown channel — the thread is gone.
      deleteListingPost(listing.id);
      await publishListing(listing);
      return;
    }
    throw error;
  }
}

/**
 * Deletes only the listing's forum post and its mapping.
 *
 * Deliberately leaves review messages alone: this is also the first half of
 * moving a post between forums, and the reviews channel has nothing to do with
 * which forum a listing lives in. Conflating the two meant a category change
 * silently deleted every review the listing had.
 */
async function removeListingPost(listingId: string): Promise<void> {
  const existing = getListingPost(listingId);
  if (!existing) return;

  try {
    const thread = await client.channels.fetch(existing.threadId);
    if (thread?.isThread()) {
      await thread.delete('Listing removed or recategorised on Better QOLHub');
    }
  } catch (error) {
    // Already gone in Discord is a success for our purposes.
    if (!(error instanceof DiscordAPIError && (error.code === 10003 || error.code === 10008))) {
      throw error;
    }
  }

  deleteListingPost(listingId);
}

/** The listing was actually deleted: its post *and* its reviews should go. */
export async function removeListing(listingId: string): Promise<void> {
  await removeListingPost(listingId);

  // The site cascades reviews when a listing is deleted, so mirror that here
  // rather than leaving orphaned review messages pointing at a dead listing.
  for (const { reviewId, messageId } of getReviewIdsForListing(listingId)) {
    await deleteReviewMessage(messageId);
    deleteReviewPost(reviewId);
  }
}

export async function publishReview(review: ReviewPayload): Promise<void> {
  if (getReviewMessageId(review.id)) {
    // Editing a review re-sends the same id; update the existing message.
    await updateReview(review);
    return;
  }

  const channel = await getReviewsChannel();
  const message = await channel.send({ embeds: [reviewEmbed(review)] });
  saveReviewPost(review.id, review.listingId, message.id);
}

export async function updateReview(review: ReviewPayload): Promise<void> {
  const messageId = getReviewMessageId(review.id);
  if (!messageId) {
    await publishReview(review);
    return;
  }

  try {
    const channel = await getReviewsChannel();
    const message = await channel.messages.fetch(messageId);
    await message.edit({ embeds: [reviewEmbed(review)] });
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 10008) {
      deleteReviewPost(review.id);
      await publishReview(review);
      return;
    }
    throw error;
  }
}

async function deleteReviewMessage(messageId: string): Promise<void> {
  try {
    const channel = await getReviewsChannel();
    const message = await channel.messages.fetch(messageId);
    await message.delete();
  } catch (error) {
    if (!(error instanceof DiscordAPIError && error.code === 10008)) {
      throw error;
    }
  }
}

export async function removeReview(reviewId: string): Promise<void> {
  const messageId = getReviewMessageId(reviewId);
  if (!messageId) return;
  await deleteReviewMessage(messageId);
  deleteReviewPost(reviewId);
}

export type GuildEmoji = {
  id: string;
  name: string;
  animated: boolean;
};

/**
 * Every custom emoji in the guild, for the website's review picker.
 *
 * Reviews store custom emoji in Discord's own `<:name:id>` / `<a:name:id>`
 * form, so the same string renders as an image on the site and natively when
 * the bot posts the review embed — no translation layer either way.
 */
export async function listGuildEmojis(): Promise<GuildEmoji[]> {
  const guild = await client.guilds.fetch(config.guildId);
  const emojis = await guild.emojis.fetch();

  return [...emojis.values()]
    .filter((e) => e.id && e.name)
    .map((e) => ({ id: e.id, name: e.name!, animated: Boolean(e.animated) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type DmResult =
  | { ok: true }
  | { ok: false; reason: 'dms_closed' | 'unknown_user' | 'failed'; message: string };

/**
 * DM a password-reset code to an already-known Discord id.
 *
 * Unlike linking, there is no username to resolve — the id came from a link the
 * user already verified, so this is a direct send.
 */
export async function sendPasswordReset(
  discordId: string,
  code: string,
  siteUsername: string
): Promise<DmResult> {
  let user;
  try {
    user = await client.users.fetch(discordId);
  } catch {
    return {
      ok: false,
      reason: 'unknown_user',
      message: 'That Discord account could not be found.',
    };
  }

  try {
    await user.send({ embeds: [passwordResetDm(code, siteUsername)] });
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 50007) {
      return {
        ok: false,
        reason: 'dms_closed',
        message:
          'Could not DM you — enable "Direct Messages" from server members in Discord, then try again.',
      };
    }
    return { ok: false, reason: 'failed', message: 'Could not send the DM. Try again.' };
  }

  return { ok: true };
}

export type LinkResult =
  | { ok: true; discordId: string; discordTag: string }
  | { ok: false; reason: 'not_found' | 'ambiguous' | 'dms_closed' | 'failed'; message: string };

/**
 * Resolve a Discord username to a member of the guild and DM them a code.
 *
 * Two failure modes are inherent to this flow rather than bugs, so they get
 * their own reasons and user-facing copy: Discord usernames are not unique
 * enough to disambiguate reliably, and a bot cannot DM someone who has DMs from
 * server members turned off.
 */
export async function sendVerificationCode(
  discordUsername: string,
  code: string,
  siteUsername: string
): Promise<LinkResult> {
  // Tolerate a pasted "@name" or legacy "name#1234".
  const wanted = discordUsername.trim().replace(/^@/, '').split('#')[0]!.toLowerCase();

  let matches: GuildMember[] = [];
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const found = await guild.members.fetch({ query: wanted, limit: 10 });
    matches = [...found.values()].filter((m) => m.user.username.toLowerCase() === wanted);
  } catch {
    return {
      ok: false,
      reason: 'failed',
      message: 'Could not search the Discord server. Try again in a moment.',
    };
  }

  if (matches.length === 0) {
    return {
      ok: false,
      reason: 'not_found',
      message:
        'No member with that username is in the Discord server. Join the server first, then try again.',
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      message: 'More than one member matches that username. Contact an admin to link manually.',
    };
  }

  const member = matches[0]!;

  try {
    await member.send({ embeds: [verificationDm(code, siteUsername)] });
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 50007) {
      return {
        ok: false,
        reason: 'dms_closed',
        message:
          'Could not DM you — enable "Direct Messages" from server members in your Discord privacy settings, then try again.',
      };
    }
    return { ok: false, reason: 'failed', message: 'Could not send the DM. Try again.' };
  }

  return { ok: true, discordId: member.id, discordTag: member.user.username };
}

export async function start(): Promise<void> {
  await client.login(config.discordToken);
  await new Promise<void>((resolve) => {
    if (client.isReady()) return resolve();
    client.once('clientReady', () => resolve());
  });
  console.log(`[qolhelper] logged in as ${client.user?.tag}`);
}

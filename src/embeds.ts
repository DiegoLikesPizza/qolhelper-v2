import { EmbedBuilder } from 'discord.js';
import { CATEGORY_META, config, isCategoryKey } from './config.ts';
import type { ListingPayload, ReviewPayload } from './types.ts';

const MAX_RATING = 5;

function stars(rating: number): string {
  const filled = Math.max(0, Math.min(MAX_RATING, Math.round(rating)));
  return '★'.repeat(filled) + '☆'.repeat(MAX_RATING - filled);
}

function meta(category: string) {
  return isCategoryKey(category) ? CATEGORY_META[category] : CATEGORY_META.OTHER;
}

// Mirrors src/lib/pricing.ts on the website.
const PRICING_TEXT: Record<string, string> = {
  FREE: '🆓 Free',
  PAID: '💰 Paid',
  FREEMIUM: '🎁 Free + paid tiers',
};

/**
 * The Pricing field's value: the state, plus the concrete price when the site
 * recorded one. Mirrors pricingBadge() on the website so the forum post and the
 * listing page say the same thing.
 */
function pricingText(listing: ListingPayload): string | null {
  const label = listing.pricing ? PRICING_TEXT[listing.pricing] : null;
  if (!label) return null;

  const price = listing.price?.trim();
  return price ? `${label}\n\`${price}\`` : label;
}

/** Mirrors the site's linkLabel(): Discord invites get a different verb. */
function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'discord.gg' || host === 'discord.com' || host.endsWith('.discord.gg') || host.endsWith('.discord.com')) {
      return 'Join Discord';
    }
  } catch {
    // Not an absolute URL — fall through.
  }
  return 'Visit';
}

export function listingEmbed(listing: ListingPayload): EmbedBuilder {
  const { label, color } = meta(listing.category);

  const links = [`[${linkLabel(listing.url)}](${listing.url})`];
  if (listing.secondaryUrl) {
    links.push(`[${linkLabel(listing.secondaryUrl)}](${listing.secondaryUrl})`);
  }

  const embed = new EmbedBuilder()
    .setTitle(listing.name)
    .setDescription(listing.description)
    .setColor(color)
    .addFields(
      { name: 'Category', value: label, inline: true },
      { name: 'Status', value: listing.isTrusted ? '✅ Trusted' : '⚠️ Unverified', inline: true },
      // Only added when the site recorded it — an empty field would read as
      // "free" to anyone skimming.
      ...(pricingText(listing)
        ? [{ name: 'Pricing', value: pricingText(listing)!, inline: true }]
        : []),
      { name: 'Links', value: links.join(' · '), inline: false }
    )
    .setURL(`${config.siteUrl}/listings/${listing.id}`)
    .setFooter({ text: 'Better QOLHub' })
    .setTimestamp(new Date());

  if (listing.developer) {
    embed.setAuthor({ name: `by ${listing.developer}` });
  }

  return embed;
}

export function reviewEmbed(review: ReviewPayload): EmbedBuilder {
  // Green / gold / red by rating, matching the site's ratingColor().
  const color = review.rating >= 4 ? 0x55ff55 : review.rating >= 3 ? 0xffaa00 : 0xff5555;

  return new EmbedBuilder()
    .setTitle(`${stars(review.rating)}  ${review.listingName}`)
    .setURL(`${config.siteUrl}/listings/${review.listingId}`)
    .setDescription(review.body)
    .setColor(color)
    .setFooter({ text: `Reviewed by ${review.username}` })
    .setTimestamp(new Date());
}

export function passwordResetDm(code: string, siteUsername: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Password reset for Better QOLHub')
    .setDescription(
      [
        `A password reset was requested for the Better QOLHub account **${siteUsername}**, which is linked to this Discord account.`,
        '',
        `Your reset code is:\n## \`${code}\``,
        '',
        'Enter it on the website to choose a new password.',
        '',
        '_If this was not you, ignore this message and nothing will change — but consider that someone knows your username._',
      ].join('\n')
    )
    .setColor(0xff5555)
    .setFooter({ text: 'Better QOLHub' });
}

export function verificationDm(code: string, siteUsername: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Link your Discord to Better QOLHub')
    .setDescription(
      [
        `Someone (hopefully you) asked to link this Discord account to the Better QOLHub account **${siteUsername}**.`,
        '',
        `Your verification code is:\n## \`${code}\``,
        '',
        'Paste it into the popup on the website to finish linking.',
        '',
        '_If this was not you, just ignore this message — nothing is linked until the code is entered._',
      ].join('\n')
    )
    .setColor(0xffaa00)
    .setFooter({ text: 'Better QOLHub' });
}

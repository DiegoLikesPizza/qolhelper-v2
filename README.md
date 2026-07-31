# QOLHelper

The Discord bot for [Better QOLHub](../betterqolhub-v2). It mirrors the website
into Discord:

- **Listings** become forum posts — one forum channel per category. Creating a
  listing opens a post, editing it edits the post, deleting it removes the post.
- **Reviews** are posted to a dedicated reviews channel, and removed when the
  review is deleted.
- **Account linking** — when a member enters their Discord username in the site's
  settings, the bot DMs them a code they paste back into the site.

The website pushes events to this bot over HTTP; the bot never polls and never
touches the website's database.

## How it fits together

```
betterqolhub-v2                          qolhelper
──────────────                           ─────────
admin action / REST API
  └─ notifyListing() ──── POST /events/listing ──▶ create/edit/delete forum post
review action
  └─ notifyReview()  ──── POST /events/review  ──▶ post/remove in reviews channel
settings page
  └─ requestDiscordDm() ─ POST /link/request   ──▶ DM the code, return discordId
```

Every request carries `Authorization: Bearer $BOT_SHARED_SECRET`. The site's
dispatches are best-effort: if this bot is down, the website still works and just
misses that event.

## Setup

### 1. Discord Developer Portal

1. **Bot → Privileged Gateway Intents → enable `SERVER MEMBERS INTENT`.**
   Without it the bot cannot look a member up by username and *every* link
   attempt fails.
2. Copy the bot token (Bot → Reset Token).
3. Invite the bot with the `bot` scope and these permissions:

   | Permission | Why |
   | --- | --- |
   | View Channels | See the forums at all |
   | Send Messages | Post in the reviews channel |
   | Embed Links | Every post is an embed |
   | Read Message History | **Required to edit or delete an existing post** — without it, updates and deletes fail even though creates work |
   | Manage Messages | Delete review messages |
   | Create Public Threads | Open a forum post |
   | Send Messages in Threads | Write the post's first message |
   | Manage Threads | Delete a listing's post |

   Ready-made invite URL (replace `YOUR_APP_ID` with the Application ID from
   General Information):

   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot&permissions=326417607680
   ```

### 2. Channels

Create one **Forum** channel per category and one regular text channel for
reviews. Turn on Developer Mode in Discord (Settings → Advanced) to copy IDs.

Two things that will otherwise look like bugs:

- **Channel permission overwrites beat the invite.** If a forum is private or
  restricted, the bot's role needs to be granted access on that specific channel
  — server-wide permissions do not override a channel-level deny.
- **Turn off "Require members to select a tag" on each forum.** The bot creates
  posts without tags, and Discord rejects an untagged post in a forum that
  requires one. (If you want listings tagged by category instead, say so — the
  bot can apply a tag on creation.)

### 3. Configure

```bash
cp .env.example .env      # then fill it in
npm install
npm start
```

Generate the shared secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the same value in the website's `.env.local` as `DISCORD_BOT_SECRET`, and
point `DISCORD_BOT_URL` at this bot (default `http://localhost:8787`).

> The bot must be reachable from wherever the website runs. Running the site on
> Vercel and the bot on your PC will not work without a tunnel — see
> [Deploying](#deploying).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness probe (unauthenticated) |
| `POST` | `/events/listing` | `{ action: created \| updated \| deleted, listing }` |
| `POST` | `/events/review` | `{ action: created \| deleted, review }` |
| `POST` | `/link/request` | `{ discordUsername, code, siteUsername }` |

`/link/request` answers `200` with `{ ok: false, reason, message }` for outcomes
the user needs to see (not in the server, ambiguous username, DMs closed) — these
are normal results, not errors, and the site shows `message` verbatim.

## Behaviour worth knowing

**Forum posts cannot move between channels.** Changing a listing's category
deletes the old post and creates a new one in the right forum, so the thread's
replies do not survive a recategorisation.

**Deleting a listing also removes its review messages**, mirroring the database
cascade — otherwise the reviews channel fills with entries pointing at listings
that no longer exist.

**Events are idempotent.** A replayed `created` becomes an update rather than a
duplicate post, and if someone deletes a post by hand in Discord, the next update
republishes it instead of erroring.

**Editing a review reuses its id**, so the site sends `created` again and the bot
edits the existing message.

### Limits of username-based linking

This is inherent to the DM flow, not a bug:

- The bot can only DM someone who **shares the server** and has **DMs from server
  members enabled**. Otherwise Discord returns `50007` and the user is told to
  change that setting.
- Discord usernames are **not reliably unique** in a search; if more than one
  member matches, the bot refuses rather than guessing, and asks them to contact
  an admin.

If those cases become common, Discord OAuth removes both problems entirely.

## State

The bot keeps one local SQLite file (`qolhelper.db` by default) mapping listing
and review ids to their Discord message ids. It uses `node:sqlite`, built into
Node 22.5+, so there is no native module to compile — hence the
`ExperimentalWarning: SQLite` line on startup.

**Deleting this file orphans every existing post**: the bot will no longer know
which post belongs to which listing and will create duplicates on the next edit.
Back it up alongside the database.

## Deploying

The bot is a long-running process and needs a host that allows one (a small VPS,
Railway, Fly.io, a Raspberry Pi). It does not work on serverless.

If the website is deployed and the bot is not publicly reachable, put a tunnel in
front of it (Cloudflare Tunnel, ngrok) and set `DISCORD_BOT_URL` to the tunnel
URL. Keep `BOT_SHARED_SECRET` secret — it is the only thing standing between the
open internet and your forum channels.

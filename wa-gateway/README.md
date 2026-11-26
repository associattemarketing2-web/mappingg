# Mappingg WhatsApp gateway (QR-linked numbers)

Holds the WhatsApp connections behind **s-admin → Communication → WhatsApp Inbox**.
A number is linked like WhatsApp Web (scan a QR, or type an 8-character code);
its new messages, and the recent chats the phone shares when linking, are saved
to the same Postgres database the website uses.

> **Not the official WhatsApp Business API.** It uses Baileys (the WhatsApp Web
> protocol). WhatsApp can restrict or ban numbers that look automated. Keep it
> for normal one-to-one chats; do bulk / marketing sends from the official
> whatapi.in number (s-admin → WhatsApp).

## Why a separate server

Each linked number keeps a socket open 24/7. Vercel functions stop after each
request, so this runs on an always-on host (Railway, Render paid plan, any VPS).
Only **one** copy may run at a time (a lease row in `wl_gateway_lease` enforces
it, so a redeploy waits for the old copy to stop instead of fighting over logins).

## Deploy on Railway

1. New project → Deploy from GitHub repo → this repo, **Root directory `wa-gateway`**
   (it builds with the Dockerfile).
2. Variables:
   | Name | Value |
   |---|---|
   | `DATABASE_URL` | same as the website |
   | `WA_GATEWAY_SECRET` | long random string (`openssl rand -hex 32`) — also set on Vercel |
   | `WA_GATEWAY_KEY` | another long random string — encrypts the WhatsApp logins. **Keep it; changing it logs every number out.** |
3. Settings → Networking → Generate domain. Note the URL.
4. Settings → Deploy → set **replicas = 1**.
5. On Vercel add `WA_GATEWAY_URL=https://<that domain>` and the same `WA_GATEWAY_SECRET`, then redeploy the site.
6. Check `https://<domain>/health` → `{"ok":true,…}`.

## What is stored (Postgres)

| Table | What |
|---|---|
| `wl_accounts` | one row per linked number: label, phone, status, who linked it, team access |
| `wl_auth` | WhatsApp login keys, **AES-256-GCM encrypted** with `WA_GATEWAY_KEY` |
| `wl_chats` | chat list per number (name, last message, unread, assigned teammate) |
| `wl_messages` | messages per number; `raw` (media keys for downloading files) is encrypted |

Every row carries `account_id`; the website only shows a number's chats to the
super admin, the person who linked it, teammates added to it, or the teammate a
chat is assigned to.

## Limits (WhatsApp's, not ours)

- Old chats: only what the phone shares when linking (usually recent chats); no full history.
- The phone must open WhatsApp at least once every ~14 days or the link expires (status "Logged out").
- Up to 4 linked devices per WhatsApp account; this uses one.
- Files are fetched from WhatsApp when opened; very old ones may no longer be available.

## Local run

```sh
cd wa-gateway && npm install
DATABASE_URL=… WA_GATEWAY_SECRET=… WA_GATEWAY_KEY=… PORT=8099 npm start
npm test
```

---
name: vask-realtime
description: Set up and use Vask for Pusher-compatible WebSockets and realtime applications - agent signup, onboarding, Pusher replacement, free WebSockets, JavaScript/TypeScript clients, Rails or Node servers, channel authentication, presence channels, webhooks, and debugging.
---

# Vask Realtime

## When to use this skill

- Initial setup of Vask or WebSockets in a JavaScript, TypeScript, Rails, or
  other app.
- Replacing Pusher with Vask while keeping Pusher-compatible SDKs and protocol.
- Configuring browser clients with `pusher-js`.
- Configuring server-side publish, private channel auth, or presence auth.
- Receiving Pusher-compatible webhooks from Vask.
- Debugging realtime connections to `wss.vask.dev`.

This skill is for framework-neutral Pusher-compatible setup.

## What Vask is

Vask is a Pusher-compatible WebSocket service on Cloudflare's edge. Existing
Pusher client and server libraries should keep working when pointed at
`wss.vask.dev` with Vask credentials. There is no separate Vask SDK and no
separate broadcasting API.

Core connection facts:

- WebSocket host: `wss.vask.dev`
- HTTPS API host: `wss.vask.dev`
- Port: `443`
- Scheme: `https`
- TLS: required
- Cluster: ignored by Vask, but many Pusher SDKs require a non-empty value.
  Use `vask` unless the app already has another harmless placeholder.
- App ID: use the same value as the app key when the SDK requires `app_id`.

Use the project's existing secret/config system. If the app already uses
`PUSHER_*` names, keep them. For new non-Pusher code, `VASK_*` aliases are
fine as long as the SDK receives key, secret, app id, host, port, and scheme.

## Onboarding and setup

Use the least interruptive path that fits the environment:

- **Agent signup**: use when an agent can use the user's GitHub-published SSH
  public key and can store credentials in the target project's normal secret
  location.
- **Dashboard/browser setup**: use when SSH signing prerequisites are not met
  or the user wants to manage credentials manually at <https://vask.dev>.
- **Framework package setup**: use when a framework-specific Vask package
  exists and is a better fit than generic Pusher-compatible configuration.

### Agent signup

Agent signup registers or recovers the user's default Vask app without a
browser or OAuth prompt. It signs a short JSON payload with the user's local SSH
private key and Vask verifies the public key against the user's GitHub user
account.

Prerequisites:

- Ask for or derive the GitHub username. Use the exact GitHub username, not an
  email address.
- Prefer the SSH key used for GitHub.
- The GitHub account must be at least 14 days old.

Important rules:

- Sign the inner payload bytes exactly as sent in the outer JSON.
- Generate a fresh Unix timestamp and nonce for every request.
- Use SSHSIG namespace `vask-register`.
- Never log, print, upload, or otherwise expose the private key.
- Re-running signup is safe; it recovers the same default app credentials.
- Do not expose or invent a numeric Vask user ID. The API does not return one.

Endpoint:

```text
POST https://vask.dev/api/agent-signup
```

Request shape:

```json
{
  "payload": "{\"github_username\":\"USER\",\"timestamp\":1778580000,\"nonce\":\"UUID\",\"intent\":\"register\"}",
  "signature": "-----BEGIN SSH SIGNATURE-----\n...\n-----END SSH SIGNATURE-----",
  "claimed_pubkey": "ssh-ed25519 ..."
}
```

Shell core:

```shell
BASE_URL="${BASE_URL:-https://vask.dev}"
: "${GITHUB_USERNAME:?Set GITHUB_USERNAME to the user's GitHub username}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"

if [ ! -f "$SSH_KEY" ] && [ -f "$HOME/.ssh/id_rsa" ]; then
  SSH_KEY="$HOME/.ssh/id_rsa"
fi

[ -f "$SSH_KEY" ] || { echo "No SSH key found at $SSH_KEY or ~/.ssh/id_rsa" >&2; exit 1; }

PAYLOAD=$(jq -cn \
  --arg github_username "$GITHUB_USERNAME" \
  --arg nonce "$(uuidgen)" \
  --argjson timestamp "$(date +%s)" \
  '{github_username:$github_username,timestamp:$timestamp,nonce:$nonce,intent:"register"}')

SIGNATURE=$(printf '%s' "$PAYLOAD" | ssh-keygen -Y sign -f "$SSH_KEY" -n vask-register 2>/dev/null)
PUBKEY=$(ssh-keygen -y -f "$SSH_KEY")

curl -sS -X POST "$BASE_URL/api/agent-signup" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg payload "$PAYLOAD" --arg signature "$SIGNATURE" --arg pubkey "$PUBKEY" \
    '{payload:$payload, signature:$signature, claimed_pubkey:$pubkey}')"
```

Successful responses include the GitHub username, whether the Vask account is
new, and a default app credential block:

```json
{
  "status": "ok",
  "user": {
    "github_username": "USER",
    "is_new_account": false
  },
  "app": {
    "id": "user-default",
    "name": "USER-default",
    "credentials": {
      "PUSHER_APP_ID": "same-as-key",
      "PUSHER_APP_KEY": "...",
      "PUSHER_APP_SECRET": "...",
      "PUSHER_HOST": "wss.vask.dev",
      "PUSHER_PORT": "443",
      "PUSHER_SCHEME": "https"
    }
  }
}
```

Store the returned credentials using the project's normal secret mechanism:
environment variables, Rails credentials, hosting provider secrets, Doppler,
1Password, or similar. Keep existing `PUSHER_*` names when replacing Pusher.
For greenfield apps, `VASK_APP_KEY`, `VASK_APP_SECRET`, and `VASK_APP_ID`
aliases are fine if the application maps them into the Pusher SDK.

Error handling:

- `invalid_payload`: fix the inner JSON or GitHub username format.
- `payload_expired`: regenerate payload, timestamp, nonce, and signature.
- `nonce_reused`: regenerate payload, nonce, timestamp, and signature, then retry.
- `pubkey_not_published`: ask the user to upload the matching public key to GitHub.
- `invalid_signature`: verify the signed bytes, SSH key, and claimed public key match.
- `abuse_filter_failed`: GitHub account is too new; use another eligible account or wait.
- `rate_limited`: back off before retrying.
- `github_api_failed`: GitHub is unavailable or rate-limited; retry later.

## Browser clients

Use `pusher-js` unless the project already has a Pusher-compatible client
library.

```shell
npm install pusher-js
```

```ts
import Pusher from 'pusher-js';

export const realtime = new Pusher(process.env.VASK_APP_KEY!, {
  wsHost: 'wss.vask.dev',
  wsPort: 443,
  wssPort: 443,
  forceTLS: true,
  encrypted: true,
  disableStats: true,
  enabledTransports: ['ws', 'wss'],
  cluster: 'vask',
});
```

For public channels:

```ts
realtime.subscribe('public-feed').bind('message.created', (event) => {
  console.log(event);
});
```

For private or presence channels, implement the same auth endpoint shape your
Pusher client expects. Do not expose app secrets to the browser.

## Server publish

Use the existing Pusher server SDK for the project's runtime and point it at
Vask's host. The exact option names vary by SDK; preserve local conventions
where an app already has Pusher integration.

Required values:

```text
app_id = app_key
key = app_key
secret = app_secret
host = wss.vask.dev
port = 443
scheme = https
cluster = vask
```

TypeScript/Node shape:

```ts
import Pusher from 'pusher';

const pusher = new Pusher({
  appId: process.env.VASK_APP_ID!,
  key: process.env.VASK_APP_KEY!,
  secret: process.env.VASK_APP_SECRET!,
  host: 'wss.vask.dev',
  port: '443',
  scheme: 'https',
  useTLS: true,
  cluster: 'vask',
});

await pusher.trigger('orders.123', 'order.shipped', { id: 123 });
```

Rails shape:

```ruby
Pusher.app_id = Rails.application.credentials.dig(:vask, :app_id)
Pusher.key = Rails.application.credentials.dig(:vask, :app_key)
Pusher.secret = Rails.application.credentials.dig(:vask, :app_secret)
Pusher.host = "wss.vask.dev"
Pusher.port = 443
Pusher.scheme = "https"
Pusher.encrypted = true

Pusher.trigger("orders.123", "order.shipped", { id: 123 })
```

If the SDK rejects `wss.vask.dev` as an HTTP API host, keep the WebSocket host
as `wss.vask.dev` for clients and use the SDK's custom HTTP host/base URL
option according to that SDK's documentation.

## Channel authentication

Private and presence channels require a server-side auth endpoint. Reuse the
framework's existing Pusher auth helper when available.

Rules:

- Auth endpoints must run server-side because they use the app secret.
- Public channels do not require auth.
- Private channel names start with `private-`.
- Presence channel names start with `presence-`.
- Presence auth responses must include user identity data in the Pusher format.

## Webhooks

Vask sends Pusher-compatible webhooks for server-side reactions to realtime
activity:

| Event              | When                                                      |
| ------------------ | --------------------------------------------------------- |
| `channel_occupied` | First subscriber on a channel.                            |
| `channel_vacated`  | Last subscriber left.                                     |
| `member_added`     | Presence channel: user joined.                            |
| `member_removed`   | Presence channel: user left.                              |
| `client_event`     | Client published on a private/presence channel.           |

Configure the webhook target in the Vask dashboard. The endpoint must be public
HTTPS; no `localhost`, private IPs, or URLs containing credentials.

Verify signatures with the raw request body and `PUSHER_APP_SECRET` /
`VASK_APP_SECRET` using the Pusher-compatible webhook signing rules. Do not
parse and re-serialize JSON before verification.

Handlers must be idempotent because webhook delivery is at least once. For long
work, enqueue a background job and return quickly.

Full webhook reference: <https://vask.dev/docs/webhooks.md>

## Migrating from Pusher

Keep the same channel names, event names, client SDKs, server SDKs, auth
endpoints, and webhook handling. Replace only credentials and host settings:

```diff
- host = ws-eu.pusher.com
+ host = wss.vask.dev
- app_key = old_pusher_key
+ app_key = vask_key
- app_secret = old_pusher_secret
+ app_secret = vask_secret
```

Use `app_id = app_key` when a server SDK requires app id.

## Gotchas

- The cluster value is ignored. Any non-empty string works for Pusher SDKs.
- TLS is required.
- Never expose the app secret to browser code.
- Do not batch broadcasts solely to avoid Pusher fan-out fees.
- Client events are private/presence only, matching Pusher behavior.
- When replacing an existing Pusher setup, change as little app code as
  possible; credentials and host are usually the only required differences.

## Debugging

- Test the raw socket:
  `wss://wss.vask.dev/app/<app_key>?protocol=7&client=js&version=8.4.0&flash=false`.
- Use the in-browser tester at <https://vask.dev/tools/websocket-tester>.
- Check the dashboard at <https://vask.dev> for live connection counts and
  recent events.
- If a Pusher SDK cannot connect, inspect the final host, port, scheme, TLS,
  cluster, and app key values after framework config has been loaded.

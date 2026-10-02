# Deployment

Taskgram is a single container: a small Node server that serves the web app and talks to
your Postgram instance on your behalf. Your Postgram API key never reaches the browser.

- [Requirements](#requirements)
- [Quick start (password login)](#quick-start-password-login)
- [HTTPS with Caddy](#https-with-caddy)
- [Authentication modes](#authentication-modes)
  - [password](#password)
  - [proxy (Authelia, Authentik, oauth2-proxy, …)](#proxy)
  - [cosmos (Cosmos Cloud)](#cosmos)
  - [oidc (OpenID Connect)](#oidc)
- [Push notifications](#push-notifications)
- [Updating](#updating)
- [Security notes](#security-notes)

## Requirements

- A running [Postgram](https://github.com/ivotoby/postgram) instance reachable over HTTPS,
  and an API key for it that may read and write tasks, projects and edges.
- Docker (or Node.js 22 to run it directly).
- A domain with HTTPS. Browsers only enable the service worker (offline mode),
  installation as an app and push notifications on secure origins.

## Quick start (password login)

```bash
cp .env.example .env
# Fill in POSTGRAM_URL, POSTGRAM_API_KEY, AUTH_USERNAME and SESSION_SECRET:
openssl rand -hex 32                     # → SESSION_SECRET
docker run --rm -it ghcr.io/OWNER/taskgram:latest node dist-server/server/hash-password.js
#                                          → AUTH_PASSWORD_HASH='…' (single quotes, see below)
docker compose up -d
```

Edit `docker-compose.yml` to point `image:` at the published image (or use `build: .`).
The container listens on `127.0.0.1:3000`; put a reverse proxy with TLS in front of it.

> The scrypt hash contains `$` characters, which Docker Compose would treat as variables.
> In `.env` wrap it in **single quotes** (`AUTH_PASSWORD_HASH='scrypt$16384$…'`); in the
> `environment:` section of a compose file escape every `$` as `$$` instead.

## HTTPS with Caddy

```caddyfile
taskgram.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

When the app runs behind a proxy, set `TRUST_PROXY=true` so login rate limiting uses
the real client address from `X-Forwarded-For`.

## Authentication modes

Choose one with `AUTH_MODE`. All modes protect every `/api` endpoint; state-changing
requests additionally require a custom header and a same-origin `Origin` (CSRF protection).

### password

Built-in login for a single user. This is the default.

| Variable | Description |
| --- | --- |
| `AUTH_USERNAME` | Login name |
| `AUTH_PASSWORD_HASH` | scrypt hash from `npm run hash-password` (or `node dist-server/server/hash-password.js` in the image) |
| `AUTH_PASSWORD` | Plain-text alternative (min. 12 characters). Prefer the hash. |
| `SESSION_SECRET` | At least 32 characters; signs the session cookie |
| `SESSION_DAYS` | Session lifetime, default 30 |
| `TRUST_PROXY` | `true` behind a reverse proxy (for rate limiting) |

Sessions are stateless, HMAC-signed, `HttpOnly`, `SameSite=Lax`, `Secure` cookies. Only on
`localhost` are they sent without `Secure`; set `COOKIE_INSECURE=true` to test over plain HTTP on
another address (never in production).
Failed logins are limited to 10 per client address per 15 minutes. Changing `SESSION_SECRET`
logs everyone out.

### proxy

For setups where a reverse proxy already handles login (Authelia, Authentik proxy outpost,
oauth2-proxy, Traefik/Caddy `forward_auth`). The proxy must:

1. authenticate the user and set a header with the user name (default `Remote-User`),
2. **strip** that header from incoming client requests, and
3. add a secret header (default `X-Proxy-Secret`) with the value of `PROXY_SECRET`.

The secret makes sure a request that bypasses the proxy (for example from another container
on the same Docker network) is never trusted.

| Variable | Description |
| --- | --- |
| `PROXY_USER_HEADER` | Header with the user name, default `remote-user` |
| `PROXY_SECRET_HEADER` | Header with the shared secret, default `x-proxy-secret` |
| `PROXY_SECRET` | At least 32 characters |
| `ALLOWED_USERS` | Comma-separated user names that may use the app |
| `PROXY_LOGIN_PATH` | Where the app sends the browser to log in again, default `/api/login` |

Example with Caddy and Authelia:

```caddyfile
taskgram.example.com {
    forward_auth authelia:9091 {
        uri /api/authz/forward-auth
        copy_headers Remote-User
    }
    reverse_proxy taskgram:3000 {
        header_up X-Proxy-Secret {env.TASKGRAM_PROXY_SECRET}
    }
}
```

### cosmos

A preset of `proxy` for [Cosmos Cloud](https://cosmos-cloud.io): the user header is
`x-cosmos-user`, which Cosmos sets after its SSO login and strips from client requests.

1. Create the container (ServApp) with `AUTH_MODE=cosmos`, `ALLOWED_USERS=<your Cosmos user>`
   and `PROXY_SECRET`.
2. Create a URL for it with **Authentication Required** enabled.
3. Under *Advanced → Extra headers*, add `x-proxy-secret` with exactly the `PROXY_SECRET` value.

If the app answers `Not authenticated` after logging in, the header value does not match:
the container log shows `proxy secret mismatch` with the lengths of both values.

### oidc

Log in with an OpenID Connect provider (Authentik, Keycloak, Zitadel, Google, …) using the
authorization-code flow with PKCE.

| Variable | Description |
| --- | --- |
| `OIDC_ISSUER` | Issuer URL (discovery via `/.well-known/openid-configuration`) |
| `OIDC_CLIENT_ID` | Client ID |
| `OIDC_CLIENT_SECRET` | Client secret (omit for a public client) |
| `OIDC_REDIRECT_URL` | `https://<your host>/auth/oidc/callback` — register this at the provider |
| `OIDC_SCOPES` | Default `openid profile email` |
| `OIDC_USER_CLAIM` | Claim used as user name, default `email` |
| `ALLOWED_USERS` | Comma-separated values of that claim that may log in (case-insensitive) |
| `SESSION_SECRET` | At least 32 characters |

## Push notifications

Optional. Generate a VAPID key pair once and set all three variables:

```bash
npx web-push generate-vapid-keys
```

| Variable | Description |
| --- | --- |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | The key pair |
| `VAPID_SUBJECT` | `mailto:` address or `https://` URL push services can contact |
| `APP_TIMEZONE` | Time zone for the daily digest and reminders |

Subscriptions are stored in `DATA_DIR` (`/app/data` in the image) — mount a volume there,
or every redeploy loses them. On iOS, notifications only work once the app has been added
to the home screen (iOS 16.4 or later). Digest and reminder texts follow the language chosen
in the app's settings.

## Updating

```bash
docker compose pull && docker compose up -d
```

Settings, push subscriptions and the browser's offline data survive updates.

## Security notes

- The Postgram API key stays on the server; the browser only talks to this app.
- Every API response is `Cache-Control: no-store`; a strict Content Security Policy is set.
- Tasks are cached in the browser's IndexedDB for offline use. Logging out (password and
  oidc mode) wipes that cache from the device, after a warning if changes are still unsynced.
- The server only sends push notifications to the known push services of Google, Apple,
  Mozilla and Microsoft.

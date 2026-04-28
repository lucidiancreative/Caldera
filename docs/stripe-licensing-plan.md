# Revised Plan: Stripe Licensing + Supabase Auth

## Summary
Caldera will use:

- A 30-day soft local trial for low-friction onboarding
- Supabase Auth with PKCE for account sign-in
- Stripe Checkout for a one-time lifetime purchase
- Supabase Edge Functions plus Postgres RPC for purchase fulfillment, entitlement issuance, and device enforcement
- Short-lived signed entitlement tokens for offline app launch

This replaces the earlier "forever JWT cached locally" model. The server remains the source of truth for license state. The app may run offline, but only within a bounded grace window after a recent successful online validation.

## Goals

- Support a 30-day trial with no required sign-in
- Sell a one-time lifetime license through Stripe Checkout
- Allow offline use for legitimate customers
- Make refunds and revocations take effect reliably
- Limit active desktop installs to 2 per account
- Keep all renderer network access disabled; licensing network calls stay in the main process

## Non-goals

- Prevent all trial abuse by reinstalling the app
- Bind a license to invasive hardware fingerprints
- Support mobile licensing in v1
- Add cloud sync for user calendar data

## Key Decisions

1. Trial enforcement is soft. It is stored locally and can be reset by clearing app data. This is intentional for v1 because the purchase path, not the trial path, is the revenue control boundary.
2. Checkout sessions are always created server-side. The app never constructs Stripe URLs itself.
3. Stripe fulfillment is keyed to the authenticated Caldera user ID, not email matching.
4. Licenses are represented in the database as state, not as a forever-valid token.
5. Offline access uses a short-lived entitlement token plus a 7-day grace window after the last successful online validation.
6. Device limits are enforced server-side in one transaction or RPC call.
7. Payment methods are limited to immediate methods in v1 (cards and wallets). If delayed-notification methods are enabled later, webhook handling must expand before launch.

## High-level Architecture

### Components

- Electron main process
  - Owns OAuth flow, protocol handling, secure local storage, and all network traffic
- Electron renderer
  - Displays trial, account, purchase, and license state
- Supabase Auth
  - Handles Google OAuth and Caldera account identity
- Supabase Postgres
  - Stores profiles, Stripe customer mapping, license records, device registrations, and processed webhook events
- Supabase Edge Functions
  - `create-checkout-session`
  - `stripe-webhook`
  - `issue-license-token`
  - `licensing-health`
- Stripe Checkout
  - Handles payment collection for the lifetime license

### Recommended main-process modules

```text
src/
  main/
    auth-service.ts
    protocol-handler.ts
    secure-store.ts
    license-service.ts
    stripe-service.ts
    supabase-service.ts
  renderer/
    licensing-ui.ts
  types.ts
```

Keep Stripe, Supabase, secure storage, and entitlement logic behind service boundaries. Do not spread license rules across IPC handlers.

## End-to-end Flows

### 1. First launch and trial

1. On first launch, generate an `install_id` as a random UUID.
2. Store `install_id` and `trial_started_at` in encrypted local storage using `safeStorage`.
3. Show the remaining trial days in the renderer.
4. When the trial expires and there is no active license, show a full-screen blocked state with:
   - `Sign in`
   - `Buy now`
   - `Restore purchase`

Notes:

- This is a soft trial.
- If stronger trial abuse resistance is needed later, add an optional anonymous server-side trial claim flow. Do not complicate v1 with that requirement.

### 2. Sign-in flow

Use Supabase OAuth with PKCE. Do not place access tokens in the custom protocol URL.

Flow:

1. Renderer invokes `auth:start`.
2. Main process creates:
   - `code_verifier`
   - `code_challenge`
   - `state`
   - `nonce`
3. Main process stores `code_verifier`, `state`, and `nonce` in memory with a short timeout.
4. Main process opens the Supabase authorize URL over HTTPS only.
5. Supabase redirects to `caldera://auth/callback?code=...&state=...`.
6. Main process validates `state`.
7. Main process exchanges `code` for a Supabase session over HTTPS.
8. Main process stores the session encrypted with `safeStorage`.
9. Renderer receives sanitized profile state from IPC.

Rules:

- Never log OAuth codes, access tokens, or refresh tokens.
- Reject malformed or repeated callbacks.
- Expire pending auth state after a few minutes.

### 3. Purchase flow

The app must require a signed-in user before purchase so the resulting Stripe payment can be attached to the correct Caldera account.

Flow:

1. Renderer invokes `license:startCheckout`.
2. Main process verifies a valid Supabase session exists.
3. Main process calls authenticated Edge Function `create-checkout-session`.
4. The Edge Function:
   - Verifies the Supabase user
   - Creates or reuses a Stripe Customer for that user
   - Creates a Checkout Session in `mode=payment`
   - Uses the configured lifetime price ID from environment
   - Sets `client_reference_id = auth.uid()`
   - Sets metadata such as `app_user_id`, `app = caldera`, `license_type = lifetime`
   - Sets a hosted HTTPS `success_url` that includes `{CHECKOUT_SESSION_ID}`
   - Sets a hosted HTTPS `cancel_url`
5. Edge Function returns the Checkout Session URL.
6. Main process validates that the returned URL is HTTPS and opens it with `shell.openExternal`.

Why use a hosted HTTPS success page:

- It is safer and more standard than trusting a direct app deep link as proof of purchase.
- The page can attempt to reopen the app with `caldera://checkout/success?session_id=...`.
- The app still verifies the session with the server before changing local state.

### 4. Stripe fulfillment and license activation

The webhook is the source of truth for purchase activation.

Flow:

1. Stripe sends `checkout.session.completed` to `stripe-webhook`.
2. Webhook verifies the Stripe signature against the raw request body.
3. Webhook checks `processed_webhook_events` for `event.id`.
4. If already processed, return `200`.
5. Webhook retrieves the user identity from `client_reference_id` or metadata, never from email matching.
6. Webhook confirms the session is paid.
7. Webhook upserts the license row and stores Stripe linkage fields.
8. Webhook records the processed event ID.
9. Webhook returns `200` quickly.

V1 payment-method constraint:

- Only enable immediate payment methods.
- Fulfillment requires `checkout.session.completed` with `payment_status = paid`.

If delayed payment methods are enabled later, add handling for:

- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

before production rollout.

### 5. Entitlement token issuance

The app does not persist the server's license decision as a forever-valid token. Instead, it requests a short-lived signed entitlement token when needed.

Flow:

1. On app launch, the main process loads the encrypted local entitlement cache.
2. If the token signature is valid and `exp` is still in the future, the app may start immediately.
3. If the token is missing or expired and the network is available, the main process calls `issue-license-token`.
4. The Edge Function:
   - Verifies the Supabase session
   - Loads the user's license record
   - Rejects revoked, refunded, or missing licenses
   - Calls the device-registration RPC
   - Signs an Ed25519 JWT with a short TTL, recommended 24 hours
5. Main process stores:
   - the signed token
   - `last_online_validation_at`
   - the granted device state
6. Renderer receives current license status.

Recommended token claims:

```json
{
  "iss": "caldera-licensing",
  "sub": "supabase-user-uuid",
  "aud": "caldera-desktop",
  "license_id": "license-uuid",
  "license_type": "lifetime",
  "install_id": "local-install-uuid",
  "device_slots": 2,
  "token_version": 1,
  "iat": 1710000000,
  "nbf": 1710000000,
  "exp": 1710086400
}
```

### 6. Offline behavior

On launch:

1. If a cached entitlement token is valid and unexpired, allow startup.
2. If the token is expired and the app is online, refresh it.
3. If the token is expired, the app is offline, and `last_online_validation_at` is within the last 7 days, allow offline grace mode.
4. Otherwise, block the app and prompt the user to reconnect and sign in.

This ensures:

- Legitimate customers are not locked out by short outages
- Revoked users do not stay licensed forever
- Refunds take effect within a bounded window

## Data Model

### Tables

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table billing_customers (
  user_id uuid primary key references profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

create table licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'active', 'revoked', 'refunded')),
  license_type text not null check (license_type in ('lifetime')),
  stripe_customer_id text not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  token_version integer not null default 1,
  licensed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  install_id text not null,
  platform text not null check (platform in ('windows', 'macos', 'linux')),
  device_name text,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, install_id)
);

create table processed_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);
```

### RLS

```sql
alter table licenses enable row level security;
alter table devices enable row level security;
alter table billing_customers enable row level security;

create policy "users read own license" on licenses
  for select using (auth.uid() = user_id);

create policy "users read own devices" on devices
  for select using (auth.uid() = user_id);
```

Do not allow direct client inserts or deletes on `devices`. Mutations should go through RPC or service-role code so device limits remain enforceable.

## Device Management

### Strategy

- Use a random local `install_id`, not a hardware fingerprint
- Limit active desktop installs to 2
- Enforce limits on the server in one transactional path
- Let users deactivate a device from the settings UI

### Recommended RPCs

- `claim_device_slot(p_install_id, p_platform, p_device_name)`
- `deactivate_device(p_install_id)`
- `replace_device(p_old_install_id, p_new_install_id, p_platform, p_device_name)`

Expected behavior of `claim_device_slot`:

1. If the install already exists and is active, update `last_seen_at` and succeed.
2. If active device count is below 2, insert and succeed.
3. Otherwise return `device_limit` plus the current active device list.

`issue-license-token` should call `claim_device_slot` before signing a new token.

## Edge Functions

### `create-checkout-session`

Responsibilities:

- Authenticate the caller with Supabase JWT
- Create or reuse the Stripe Customer
- Create the Checkout Session on the server
- Return only the Checkout URL and session ID

Notes:

- Pin Stripe to the latest API version in use for this project. As of April 28, 2026, the curated Stripe guidance in this workspace references `2026-02-25.clover`.
- Keep product and price IDs in environment variables, not in renderer code.

### `stripe-webhook`

Responsibilities:

- Verify Stripe signature
- Deduplicate event delivery
- Upsert license state
- Mark refunds and revocations
- Return quickly with `2xx`

Recommended event set for v1:

- `checkout.session.completed`
- `charge.refunded`

Optional later events:

- `charge.dispute.created`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

### `issue-license-token`

Responsibilities:

- Authenticate the caller
- Verify active license state
- Enforce device limits
- Sign short-lived Ed25519 entitlement token
- Return device list and entitlement summary

### `licensing-health`

Responsibilities:

- Return `200` with simple service status
- Verify critical configuration exists
- Support deployment and monitoring checks

## Electron Integration Notes

### Protocol handling

Register and handle:

- `caldera://auth/callback`
- `caldera://checkout/success`

Rules:

- Parse with `new URL(...)`
- Validate expected hostnames and parameters
- Ignore unknown deep links
- Treat the checkout success link as a hint only; fetch and verify license state from the server before updating local entitlement cache

### Secure storage

Encrypt the following values before writing to disk:

- Supabase access token
- Supabase refresh token
- Cached entitlement token
- `install_id`
- `trial_started_at`
- `last_online_validation_at`

If `safeStorage` is unavailable on a platform, fail closed for account tokens and show a clear unsupported-state message. Do not silently fall back to plaintext for auth data.

### IPC surface

Recommended IPC handlers:

- `auth:start`
- `auth:getSessionSummary`
- `auth:logout`
- `license:getStatus`
- `license:startCheckout`
- `license:restorePurchase`
- `license:listDevices`
- `license:deactivateDevice`

Return sanitized DTOs only. Never return raw Supabase sessions or secrets to the renderer.

## UI Plan

### Trial state

- Persistent badge with remaining days
- `Upgrade` button
- `Sign in` entry point

### Licensed state

- Settings shows:
  - signed-in email
  - license type
  - last validation time
  - offline grace status when applicable
  - active devices list

### Expired or blocked state

- Full-screen overlay
- Clear reason:
  - trial expired
  - offline grace expired
  - license revoked or refunded
  - device limit reached
- Actions:
  - `Sign in`
  - `Buy now`
  - `Restore purchase`
  - `Manage devices` when relevant

## Security Requirements

1. Keep `contextIsolation = true`, `nodeIntegration = false`, and `sandbox = true`.
2. Validate every `openExternal` URL as HTTPS before calling it.
3. Keep `connect-src 'none'` in the renderer; do licensing network calls from the main process only.
4. Never trust any renderer-supplied user ID, email, or price ID.
5. Never log tokens, Stripe secrets, webhook payload signatures, or raw session objects.
6. Verify Stripe webhooks against the raw request body.
7. Use idempotency controls for Stripe webhook processing.
8. Store all timestamps in UTC.

## Testing Plan

### Auth

- Successful PKCE login
- Expired callback state
- Replayed callback URL
- Invalid state
- Logout clears encrypted session cache

### Purchase and fulfillment

- Successful Checkout purchase
- User closes browser before app resumes
- Duplicate webhook delivery
- Webhook before app focus returns
- Refund revokes license

### Entitlement and offline

- Valid cached token starts app instantly
- Expired token refreshes online
- Expired token allows offline use within 7 days of last validation
- Expired token blocks after offline grace expires
- Revoked license no longer refreshes token

### Device limits

- First device registration succeeds
- Second device registration succeeds
- Third device is blocked with device list
- Replace-device flow is atomic
- Deactivated device frees a slot

## Implementation Phases

### Phase 1: Auth and secure local state

1. Add protocol handler plumbing
2. Implement PKCE login in the main process
3. Encrypt session and local trial state
4. Add settings account UI

### Phase 2: Stripe server path

1. Create Stripe product and lifetime price
2. Implement `create-checkout-session`
3. Implement hosted success and cancel landing pages
4. Implement `stripe-webhook` with idempotency

### Phase 3: License issuance and device enforcement

1. Add schema and migrations
2. Implement device RPCs
3. Implement `issue-license-token`
4. Implement offline cache verification in the main process

### Phase 4: UX and hardening

1. Add trial badge and blocked overlay
2. Add restore purchase flow
3. Add device management UI
4. Add monitoring, health checks, and error telemetry

## Open Follow-ups

These are not blockers for the architecture, but should be confirmed before build starts:

1. Whether the hosted success page will live on the marketing site or a Supabase-hosted page
2. Whether disputes should immediately suspend access or create a manual-review state
3. Whether the soft trial is acceptable for v1 or if abuse resistance must be stronger

## Final Recommendation

This revised architecture is the recommended v1 path:

- It follows Stripe Checkout best practices by creating sessions server-side and using webhooks as the payment authority.
- It follows Electron security best practices by keeping tokens out of deep links and keeping network access in the main process.
- It solves the biggest flaw in the original plan by replacing forever-valid local JWTs with short-lived server-issued entitlements.

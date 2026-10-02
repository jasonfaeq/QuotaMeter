# OAuth enrollment

QuotaMeter enrolls each managed account through its own authorization flow
rather than copying or refreshing a harness's existing session. Using an existing
provider CLI's client identifier does not mean QuotaMeter owns that OAuth client
registration. Tests use fixtures and mocked HTTP calls; they validate protocol
handling, not provider policy or availability for every subscription.

## Codex

`lib/oauth.js` implements authorization-code PKCE with the Codex public client.

- Authorize: `https://auth.openai.com/oauth/authorize`
- Token: `https://auth.openai.com/oauth/token`
- Redirect: `http://localhost:1455/auth/callback`
- State validation, a callback timeout, and headless URL presentation.
- The fixed port reports an actionable error when it is already in use.

Refresh tokens may rotate. QuotaMeter refreshes only accounts it enrolled itself,
serializes refresh by credential identity, and writes the returned pair
atomically to every owned row that held the previous refresh token.

## Claude

`lib/claude-oauth.js` implements authorization-code PKCE using the Claude Code
client and the console-hosted redirect with manual `code#state` entry.

- Authorize: `https://claude.ai/oauth/authorize`
- Token: `https://console.anthropic.com/v1/oauth/token`
- Redirect: `https://console.anthropic.com/oauth/code/callback`

Only managed sessions are refreshed; discovered external sessions stay read-only.

## Antigravity / Google AI Pro

- Authorize: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- Redirect: `http://localhost:36742/oauth-callback`
- Client configuration: `ANTIGRAVITY_CLIENT_ID` and `ANTIGRAVITY_CLIENT_SECRET`,
  from the environment only. No client secret is stored in the source.
- Scopes: Google `cloud-platform`, `userinfo.email`, and `userinfo.profile`.
- PKCE S256, `access_type=offline`, `prompt=consent`.
- The Cloud Code project is resolved via `loadCodeAssist` after login.
- Google may omit a replacement refresh token; the previous one is preserved.

Installed-app Google flows can use a client-secret parameter. The configured
client must support the redirect and scopes above.

## Ownership

External access tokens may be used while they are valid, but they are never
refreshed. Rows in a managed file that QuotaMeter did not enroll are treated as
imported: they are read-only until `qm <provider> reauth <label>` replaces them
with a new login.

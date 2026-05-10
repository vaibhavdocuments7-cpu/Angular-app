# Manual OAuth 2.0 + PKCE Implementation (Angular)

## Overview

Zero-library OAuth 2.0 implementation using pure `fetch()` and Web Crypto API. No MSAL, no OIDC library — just raw HTTP requests to Azure AD's OAuth 2.0 endpoints.

## Why Manual OAuth?

| Aspect | MSAL / OIDC Library | Manual OAuth |
|--------|---------------------|--------------|
| Bundle size | +50-200KB | ~5KB (just your code) |
| Dependencies | Library updates, breaking changes | Zero external deps |
| Control | Library decides the flow | You control everything |
| Learning | Learn the library API | Learn the OAuth 2.0 spec |
| Production ready | ✅ Recommended | ⚠️ Educational / light use |

## Architecture

### Files

| File | Purpose |
|------|---------|
| `services/manual-auth.service.ts` | Full OAuth 2.0 + PKCE implementation |
| `environments/environment.ts` | Set `authProvider: 'manual'` to activate |
| `app.config.ts` | `getManualProviders()` registers the service |

### How It Extends the Abstraction

```
AuthService (abstract)
  ├── MsalAuthService      ← authProvider: 'msal'
  ├── OidcAuthService       ← authProvider: 'oidc'
  └── ManualAuthService     ← authProvider: 'manual'  ⭐ NEW
```

All three implement the same `AuthService` interface. Components don't know which one is active.

## OAuth 2.0 Authorization Code + PKCE Flow

```
┌──────────┐         ┌──────────────┐         ┌──────────┐
│  Angular  │         │   Azure AD   │         │  Token   │
│   App     │         │  /authorize  │         │ Endpoint │
└────┬─────┘         └──────┬───────┘         └────┬─────┘
     │                      │                      │
     │ 1. Generate PKCE     │                      │
     │    code_verifier     │                      │
     │    code_challenge    │                      │
     │    state             │                      │
     │                      │                      │
     │ 2. Redirect ────────►│                      │
     │    ?client_id=       │                      │
     │    &code_challenge=  │                      │
     │    &state=           │                      │
     │                      │                      │
     │ 3. User logs in      │                      │
     │    at Azure AD       │                      │
     │                      │                      │
     │ 4. Redirect back ◄───│                      │
     │    ?code=AUTH_CODE    │                      │
     │    &state=SAME_STATE │                      │
     │                      │                      │
     │ 5. Validate state    │                      │
     │                      │                      │
     │ 6. POST /token ─────────────────────────────►│
     │    code=AUTH_CODE     │                      │
     │    code_verifier=     │   ← proves we        │
     │                      │      started this     │
     │                      │                      │
     │ 7. Tokens ◄──────────────────────────────────│
     │    access_token       │                      │
     │    id_token           │                      │
     │    refresh_token      │                      │
     │                      │                      │
     │ 8. Store tokens      │                      │
     │    in sessionStorage  │                      │
     │                      │                      │
     │ 9. Call Graph API     │                      │
     │    Authorization:     │                      │
     │    Bearer {token}     │                      │
```

## PKCE Deep Dive

PKCE (Proof Key for Code Exchange) prevents authorization code interception attacks.

### Step 1: Generate `code_verifier`
```typescript
function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);        // cryptographically random
  return base64UrlEncode(array);        // 86-char random string
}
```

### Step 2: Create `code_challenge`
```typescript
async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);  // hash it
  return base64UrlEncode(new Uint8Array(digest));               // base64url
}
```

### Step 3: Generate `state`
```typescript
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);    // CSRF protection token
}
```

### Why PKCE matters:
- **Without PKCE:** An attacker who intercepts the `?code=` could exchange it for tokens
- **With PKCE:** Only the app that generated the `code_verifier` can exchange the code
- Azure AD verifies: `SHA-256(code_verifier) === code_challenge` sent earlier

## Token Types

| Token | Purpose | Lifetime | Stored in |
|-------|---------|----------|-----------|
| `access_token` | Call APIs (Graph API) | ~1 hour | sessionStorage |
| `id_token` | User identity claims (name, email) | ~1 hour | sessionStorage |
| `refresh_token` | Get new access tokens silently | ~24 hours | sessionStorage |

## State Parameter (CSRF Protection)

1. **Before redirect:** Generate random `state`, store in `sessionStorage`
2. **After redirect:** Azure AD returns same `state` in URL
3. **Validation:** Compare URL `state` vs stored `state`
4. **Mismatch?** Reject — possible CSRF attack

## Token Refresh Flow

```typescript
// Automatic refresh when token expires
getAccessToken(): Observable<string> {
  const expiresAt = parseInt(sessionStorage.getItem('expires_at') || '0');
  
  if (this.accessToken && Date.now() < expiresAt) {
    return of(this.accessToken);  // still valid
  }

  // Token expired — use refresh_token to get new one
  return from(this.refreshAccessToken(refreshToken));
}
```

## Angular-Specific Patterns

### Observable Wrapping
The abstract `AuthService` returns `Observable<T>`, but manual OAuth uses `async/await`. We bridge with:
```typescript
// Wrap Promise in Observable using RxJS `from()`
handleRedirectCallback(): Observable<boolean> {
  return from(this.exchangeCodeForTokens(code));
}

// Simple sync values use `of()`
initialize(): Observable<void> {
  return of(void 0);
}
```

### Async Login
`login()` returns `void` but PKCE needs `async` (for `crypto.subtle.digest`). Solved with async IIFE:
```typescript
login(): void {
  (async () => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    // ... redirect
  })();
}
```

## How to Switch

In `environment.ts`:
```typescript
authProvider: 'manual'   // ← activates ManualAuthService
```

In `app.config.ts`, the switch statement routes to `getManualProviders()`:
```typescript
function getManualProviders() {
  return [
    { provide: AuthService, useClass: ManualAuthService },
  ];
}
```

## Security Comparison

| Feature | MSAL | OIDC Library | Manual |
|---------|------|-------------|--------|
| PKCE | ✅ Auto | ✅ Auto | ✅ Implemented |
| State/CSRF | ✅ Auto | ✅ Auto | ✅ Implemented |
| Token refresh | ✅ Auto | ✅ Auto | ✅ Implemented |
| JWT signature validation | ✅ | ✅ | ❌ Not implemented |
| Nonce validation | ✅ | ✅ | ❌ Not implemented |
| Token binding | ✅ | ✅ | ❌ Not implemented |

> ⚠️ **Production Note:** For production apps, use MSAL or OIDC library. Manual OAuth is great for learning and lightweight scenarios, but lacks JWT signature validation and other security hardening.

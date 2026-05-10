# OIDC Implementation Details

## Overview

OIDC (OpenID Connect) is implemented using `angular-auth-oidc-client`, a generic OIDC library that works with any OpenID Connect provider — including Azure AD, Keycloak, Auth0, Okta, etc. Unlike MSAL (Microsoft-specific), this library follows the standard OIDC protocol.

---

## 1. How OIDC Works — The Flow

```
User clicks "Sign in"
        │
        ▼
LoginComponent.login()
        │
        ▼
OidcAuthService.login()
        │
        ▼
oidcService.authorize()
        │
        ▼
Library fetches OIDC Discovery Document:
GET https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration
  → Returns: authorization_endpoint, token_endpoint, jwks_uri, etc.
        │
        ▼
Browser redirects to the discovered authorization_endpoint:
https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
  ?client_id=f50d4ced-...
  &response_type=code
  &redirect_uri=http://localhost:4200
  &scope=openid profile email user.read offline_access
  &code_challenge=... (PKCE)
  &state=... (random string stored in sessionStorage)
  &nonce=... (replay attack prevention)
        │
        ▼
User picks Microsoft account → Azure AD validates
        │
        ▼
Azure AD redirects back to:
http://localhost:4200/?code=ABC123&state=XYZ789&session_state=...
        │
        ▼
App loads → app.ts ngOnInit()
        │
        ▼
OidcAuthService.handleRedirectCallback()
  → oidcService.checkAuth(window.location.toString())
        │
        ▼
Library processes the callback:
  1. Extracts ?code= and ?state= from URL
  2. Validates state matches stored value
  3. Sends code + code_verifier to /token endpoint (POST)
  4. Receives: { access_token, id_token, refresh_token }
  5. Validates id_token (signature, issuer, audience, nonce, iat)
  6. Stores tokens in sessionStorage
  7. Returns { isAuthenticated: true }
        │
        ▼
App navigates to /home → Dashboard shown
```

---

## 2. OIDC Configuration

### File: `app.config.ts` → `getOidcProviders()`

```ts
provideAuth({
  config: {
    authority: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    redirectUrl: 'http://localhost:4200',
    postLogoutRedirectUri: 'http://localhost:4200',
    clientId: 'f50d4ced-...',
    scope: 'openid profile email user.read offline_access',
    responseType: 'code',
    silentRenew: true,
    useRefreshToken: true,
    logLevel: LogLevel.Debug,
    autoUserInfo: false,
    authWellknownEndpointUrl: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    maxIdTokenIatOffsetAllowedInSeconds: 600,
    unauthorizedRoute: '/',
  },
})
```

### Configuration Explained:

| Setting | Purpose | Without It |
|---------|---------|-----------|
| `authority` | Base URL for OIDC discovery. Library appends `/.well-known/openid-configuration` | Library doesn't know where to find auth endpoints |
| `redirectUrl` | Where Azure AD sends user back with `?code=` | Azure AD returns "redirect URI mismatch" error |
| `clientId` | Identifies your app (same as MSAL) | Azure AD rejects — "unknown application" |
| `scope` | Permissions requested (see breakdown below) | No tokens returned, or limited claims |
| `responseType: 'code'` | Use Authorization Code flow with PKCE | Falls back to implicit flow (less secure, deprecated) |
| `silentRenew: true` | Auto-renew tokens before expiry | User gets logged out when token expires (~1 hour) |
| `useRefreshToken: true` | Use refresh tokens for renewal | Uses hidden iframe (slower, blocked by some browsers) |
| `autoUserInfo: false` | Don't call /userinfo endpoint | If `true`: Azure AD's userinfo returns limited data, may cause errors |
| `maxIdTokenIatOffsetAllowedInSeconds: 600` | Allow 10-minute clock skew | **Token validation fails** with "iat rejected" if system clock is slightly off |
| `unauthorizedRoute: '/'` | Where to navigate on auth failure | **NG04002 error** — tries to navigate to `/unauthorized` which doesn't exist |
| `authWellknownEndpointUrl` | Explicit discovery URL | Library may construct wrong URL for Azure AD |
| `logLevel: LogLevel.Debug` | Detailed console logs for debugging | Hard to debug auth issues (set to `LogLevel.None` in production) |

### Scopes Breakdown:

| Scope | What It Does |
|-------|-------------|
| `openid` | Required for OIDC. Returns an ID token with user identity |
| `profile` | Adds name, preferred_username to ID token claims |
| `email` | Adds email address to ID token claims |
| `user.read` | Permission to call Microsoft Graph API `/me` endpoint |
| `offline_access` | Returns a refresh token for silent renewal |

---

## 3. OIDC Discovery Document

The OIDC library auto-discovers all endpoints by fetching:
```
GET https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration
```

This returns a JSON document with:
```json
{
  "authorization_endpoint": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
  "token_endpoint": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
  "jwks_uri": "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys",
  "issuer": "https://login.microsoftonline.com/{tenant}/v2.0",
  "userinfo_endpoint": "https://graph.microsoft.com/oidc/userinfo",
  ...
}
```

**Why this matters:** Unlike MSAL which hardcodes Microsoft URLs, the OIDC library discovers them. This means you can point it at ANY OIDC provider (Keycloak, Okta, Auth0) just by changing the `authority` URL.

---

## 4. OidcAuthService Implementation

### File: `src/app/services/oidc-auth.service.ts`

```ts
export class OidcAuthService extends AuthService {
  private _isAuthenticated = false;
  private _userData: any = null;

  // Check internal state flag (set during handleRedirectCallback)
  isAuthenticated(): boolean {
    return this._isAuthenticated;
  }

  // Get user info from ID token claims
  getUserName(): string {
    return this._userData?.name || this._userData?.preferred_username || 'Unknown';
  }

  // Trigger OIDC authorization redirect
  login(): void {
    this.oidcService.authorize();
  }

  // Get stored access token
  getAccessToken(): Observable<string> {
    return this.oidcService.getAccessToken();
  }

  // Process redirect callback — exchange code for tokens
  handleRedirectCallback(): Observable<boolean> {
    const currentUrl = window.location.toString();
    
    return this.oidcService.checkAuth(currentUrl).pipe(
      map((loginResponse) => {
        this._isAuthenticated = loginResponse?.isAuthenticated || false;
        
        if (this._isAuthenticated) {
          // Extract user info from ID token claims
          if (loginResponse?.userData) {
            this._userData = loginResponse.userData;
          } else if (loginResponse?.idToken) {
            // Decode JWT payload manually
            const payload = JSON.parse(atob(loginResponse.idToken.split('.')[1]));
            this._userData = payload;
          }
        }
        return this._isAuthenticated;
      })
    );
  }
}
```

### Key Differences from MSAL:

| Aspect | MSAL | OIDC |
|--------|------|------|
| Login | `msalService.loginRedirect()` | `oidcService.authorize()` |
| Handle redirect | `msalService.handleRedirectObservable()` | `oidcService.checkAuth(url)` |
| Get token | `msalService.acquireTokenSilent()` | `oidcService.getAccessToken()` |
| User info | `account.name` from MSAL cache | Decoded from ID token JWT |
| Logout | `msalService.logoutRedirect()` | `oidcService.logoff()` |
| Init needed | Yes (`initialize()`) | No (auto-initialized by `provideAuth`) |

---

## 5. Token Validation — What OIDC Library Checks

When the library receives tokens back from Azure AD, it validates:

| Check | What It Does | Error If Fails |
|-------|-------------|----------------|
| **Signature** | Verifies JWT signature using Azure AD's public keys (from jwks_uri) | "Token signature validation failed" |
| **Issuer (`iss`)** | Must match `https://login.microsoftonline.com/{tenant}/v2.0` | "Issuer validation failed" |
| **Audience (`aud`)** | Must match your Client ID | "Audience validation failed" |
| **Expiry (`exp`)** | Token must not be expired | "Token expired" |
| **Issued At (`iat`)** | Must be within `maxIdTokenIatOffsetAllowedInSeconds` of current time | **"iat rejected id_token was issued too far away"** ← We hit this! |
| **Nonce** | Must match the nonce sent in the authorize request | "Nonce validation failed" |
| **State** | Must match the state stored in sessionStorage | "State validation failed" |

---

## 6. Issues We Encountered & Fixes

### Issue 1: "iat rejected id_token was issued too far away from the current time"
**Cause:** The system clock was slightly off from Azure AD's server time. The default `maxIdTokenIatOffsetAllowedInSeconds` is very strict (~120 seconds).
**Fix:** Set `maxIdTokenIatOffsetAllowedInSeconds: 600` (10 minutes tolerance).

### Issue 2: NG04002 — Cannot match routes: 'unauthorized'
**Cause:** When token validation fails, the OIDC library tries to navigate to `/unauthorized` by default. We didn't have that route.
**Fix:** Set `unauthorizedRoute: '/'` to redirect to the login page instead.

### Issue 3: Login page shown again after successful login
**Cause:** `checkAuth()` was called without the current URL, so it couldn't find the `?code=` parameter.
**Fix:** Pass `window.location.toString()` to `checkAuth(currentUrl)`.

### Issue 4: `autoUserInfo: true` causing issues
**Cause:** Azure AD's userinfo endpoint (`https://graph.microsoft.com/oidc/userinfo`) returns very limited data and sometimes fails with certain token types.
**Fix:** Set `autoUserInfo: false` and extract user info from the ID token claims directly.

---

## 7. OIDC vs MSAL — When to Use Which

| Criteria | Use MSAL | Use OIDC |
|----------|----------|----------|
| Only Azure AD | ✅ Best choice | ✅ Works fine |
| Multiple providers (Azure AD + Keycloak) | ❌ Microsoft only | ✅ Generic |
| Microsoft official support | ✅ Full support | ❌ Community |
| Fewer dependencies | ❌ Heavier | ✅ Lighter |
| SSR compatibility | ❌ Has issues | ❌ Has issues |
| Token auto-renewal | ✅ Built-in | ✅ Built-in |
| Graph API integration | ✅ Interceptor | ⚠️ Manual token |
| Debugging ease | ❌ Complex internals | ✅ Better logs |

---

## 8. Security — OAuth 2.0 + PKCE Flow

Both MSAL and OIDC use the **Authorization Code flow with PKCE** (Proof Key for Code Exchange):

```
1. App generates random code_verifier (128 chars)
2. App creates code_challenge = SHA256(code_verifier)
3. App sends code_challenge to /authorize
4. Azure AD returns authorization code
5. App sends code + code_verifier to /token
6. Azure AD verifies SHA256(code_verifier) == code_challenge
7. If match → returns tokens
```

**Why PKCE?** Without it, if an attacker intercepts the authorization code (from URL), they could exchange it for tokens. With PKCE, they also need the `code_verifier` which never leaves the browser.

---

## 9. Production Checklist

Before deploying to production:

- [ ] Change `logLevel` from `Debug` to `None`
- [ ] Update `redirectUrl` to production URL
- [ ] Update Azure AD App Registration with production redirect URI
- [ ] Consider reducing `maxIdTokenIatOffsetAllowedInSeconds` to 300 (5 min)
- [ ] Enable `silentRenew` (already done)
- [ ] Test token renewal works correctly
- [ ] Ensure HTTPS is used (required for production)

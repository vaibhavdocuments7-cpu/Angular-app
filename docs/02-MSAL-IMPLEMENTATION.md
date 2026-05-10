# MSAL Implementation Details

## Overview

MSAL (Microsoft Authentication Library) is Microsoft's official SDK for authenticating with Azure AD / Entra ID. We use `@azure/msal-angular` (v5.2.3) which is the Angular wrapper around `@azure/msal-browser` (v5.10.0).

---

## 1. How MSAL Works — The Flow

```
User clicks "Sign in"
        │
        ▼
LoginComponent.login()
        │
        ▼
MsalAuthService.login()
        │
        ▼
msalService.loginRedirect({ scopes: ['user.read'] })
        │
        ▼
Browser redirects to:
https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
  ?client_id=f50d4ced-...
  &response_type=code
  &redirect_uri=http://localhost:4200
  &scope=openid profile user.read
  &code_challenge=... (PKCE)
  &state=... (random string stored in sessionStorage)
        │
        ▼
User picks Microsoft account → Azure AD validates credentials
        │
        ▼
Azure AD redirects back to:
http://localhost:4200/?code=ABC123&state=XYZ789
        │
        ▼
App loads → app.ts ngOnInit()
        │
        ▼
MsalAuthService.initialize() → msalService.initialize()
        │
        ▼
MsalAuthService.handleRedirectCallback()
  → msalService.handleRedirectObservable()
        │
        ▼
MSAL reads ?code= and ?state= from URL
  → validates state matches what was stored in sessionStorage
  → sends code to /token endpoint
  → receives: { access_token, id_token, refresh_token }
        │
        ▼
Sets active account → router.navigate(['/home'])
```

---

## 2. MSAL Configuration

### File: `app.config.ts` → `getMsalProviders()`

```ts
new PublicClientApplication({
  auth: {
    clientId: 'f50d4ced-...',          // From App Registration
    authority: 'https://login.microsoftonline.com/{tenant}',
    redirectUri: 'http://localhost:4200',
    postLogoutRedirectUri: 'http://localhost:4200',
  },
  cache: {
    cacheLocation: BrowserCacheLocation.SessionStorage,
  },
})
```

### Configuration Explained:

| Setting | Purpose | Without It |
|---------|---------|-----------|
| `clientId` | Identifies your app to Azure AD | Azure AD rejects the request — "unknown application" |
| `authority` | Azure AD endpoint for your tenant | MSAL doesn't know where to send auth requests |
| `redirectUri` | Where Azure AD sends the user back after login | Azure AD returns error: "redirect URI mismatch" |
| `postLogoutRedirectUri` | Where to go after logout | User stays on Microsoft's logout page |
| `cacheLocation: SessionStorage` | Where tokens are stored in browser | Defaults to sessionStorage anyway, but explicit is better. LocalStorage persists across tabs but caused `state_mismatch` with SSR |

---

## 3. MSAL Providers Registered

```ts
// The PublicClientApplication instance (singleton)
{ provide: MSAL_INSTANCE, useFactory: () => new PublicClientApplication(...) }

// How to handle unauthenticated route access
{ provide: MSAL_GUARD_CONFIG, useValue: { 
    interactionType: InteractionType.Redirect,  // Full page redirect
    authRequest: { scopes: ['user.read'] }       // Permissions requested
}}

// Which API URLs get Bearer tokens automatically
{ provide: MSAL_INTERCEPTOR_CONFIG, useValue: {
    interactionType: InteractionType.Redirect,
    protectedResourceMap: new Map([
        ['https://graph.microsoft.com/v1.0/', ['user.read']]
    ])
}}

// HTTP interceptor — auto-attaches tokens to API calls
{ provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true }

// Core MSAL services
MsalService           // Login, logout, token methods
MsalGuard             // Route protection (used when authProvider = 'msal')
MsalBroadcastService  // Auth event broadcasting

// Wire up to abstract AuthService
{ provide: AuthService, useClass: MsalAuthService }
```

---

## 4. MsalAuthService Implementation

### File: `src/app/services/msal-auth.service.ts`

```ts
export class MsalAuthService extends AuthService {

  // Check if any accounts exist in MSAL's cache
  isAuthenticated(): boolean {
    return this.msalService.instance.getAllAccounts().length > 0;
  }

  // Get user info from the active account object
  getUserName(): string {
    return this.msalService.instance.getActiveAccount()?.name || 'Unknown';
  }

  // Trigger redirect to Microsoft login page
  login(): void {
    this.msalService.loginRedirect({ scopes: ['user.read'] });
  }

  // Silently get an access token (from cache or refresh)
  getAccessToken(): Observable<string> {
    return this.msalService.acquireTokenSilent({
      scopes: ['user.read'],
      account: this.msalService.instance.getActiveAccount(),
    }).pipe(map(result => result.accessToken));
  }

  // Process the ?code= and ?state= from the redirect URL
  handleRedirectCallback(): Observable<boolean> {
    return this.msalService.handleRedirectObservable().pipe(
      map(result => {
        if (result?.account) {
          this.msalService.instance.setActiveAccount(result.account);
          return true;
        }
        return false;
      })
    );
  }
}
```

---

## 5. Key MSAL Concepts

### PublicClientApplication
The main MSAL object. It handles all authentication operations. Created once as a singleton and shared across the app via Angular DI.

### Accounts
After login, MSAL stores account info in sessionStorage. `getAllAccounts()` returns all cached accounts. `setActiveAccount()` marks which one to use for token requests.

### Token Acquisition
- **`acquireTokenSilent()`** — Gets token from cache or uses refresh token. No UI. Use this for API calls.
- **`acquireTokenRedirect()`** — Full page redirect to get a new token. Used when silent fails (e.g., consent needed).

### Scopes
Permissions your app requests. Examples:
- `openid` — Get an ID token (user identity)
- `profile` — User's name, etc.
- `user.read` — Read user's profile from Microsoft Graph
- `offline_access` — Get a refresh token

### PKCE (Proof Key for Code Exchange)
MSAL automatically uses PKCE for security. It generates a random `code_verifier`, hashes it to create `code_challenge`, sends the challenge to Azure AD, and uses the verifier when exchanging the code for tokens. This prevents code interception attacks.

---

## 6. Issues We Encountered & Fixes

### Issue 1: `state_mismatch` Error
**Cause:** SSR (Server-Side Rendering) was processing the redirect URL on the server side, which has no access to browser's `sessionStorage` where MSAL stored the state.
**Fix:** Disabled SSR — removed `server`, `outputMode`, `ssr` from `angular.json`.

### Issue 2: `state_mismatch` After Disabling SSR
**Cause:** `handleRedirectObservable()` was being called without first calling `initialize()` (required in MSAL v5).
**Fix:** Added `this.authService.initialize().subscribe(() => { ... })` before handling redirect.

### Issue 3: Access Token Empty (Graph API returning 401)
**Cause:** MSAL Interceptor wasn't attaching tokens due to initialization timing.
**Fix:** Manually acquire token using `acquireTokenSilent()` and attach `Authorization: Bearer` header.

### Issue 4: `navigateToLoginRequestUrl` and `storeAuthStateInCookie` TypeScript Errors
**Cause:** These properties were removed in MSAL Browser v5.
**Fix:** Removed both properties from the config.

---

## 7. MSAL vs MSAL Versions

| Feature | MSAL Angular v3 | MSAL Angular v5 (Current) |
|---------|-----------------|--------------------------|
| `initialize()` | Not needed | **Required** before any operation |
| `handleRedirectObservable()` | Primary approach | Still works but needs initialize() first |
| `storeAuthStateInCookie` | Supported | **Removed** |
| `navigateToLoginRequestUrl` | Supported | **Removed** |
| `MsalRedirectComponent` | Recommended | Available but selector issues |

---

## 8. Security Considerations

- **Never store tokens in code** — MSAL handles storage in sessionStorage
- **Always use PKCE** — MSAL does this automatically
- **Use `acquireTokenSilent()` for API calls** — avoids unnecessary redirects
- **Set `cacheLocation: SessionStorage`** — tokens are cleared when browser tab closes
- **Validate `redirectUri`** in Azure Portal matches exactly what the app sends

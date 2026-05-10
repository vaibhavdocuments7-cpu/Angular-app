# Auth Abstraction Layer — How Provider Switching Works

## Overview

The app supports two authentication libraries (MSAL and OIDC) with a single environment variable switch. Components never interact with either library directly — they use an abstract `AuthService`. This document explains how the abstraction works.

---

## 1. The Problem

Without abstraction, every component directly imports and uses MSAL:

```ts
// ❌ BAD — tightly coupled to MSAL
import { MsalService } from '@azure/msal-angular';

export class LoginComponent {
  constructor(private msalService: MsalService) {}
  
  login() {
    this.msalService.loginRedirect({ scopes: ['user.read'] });
  }
}
```

**Problem:** If you want to switch to OIDC, you'd have to:
- Change imports in every file
- Rewrite `login()`, `logout()`, `getToken()` in every component
- Update constructor injection everywhere
- Risk breaking things

---

## 2. The Solution — Abstraction via Dependency Injection

### Layer 1: Abstract Contract (`auth.service.ts`)

```ts
@Injectable()
export abstract class AuthService {
  abstract isAuthenticated(): boolean;
  abstract getUserName(): string;
  abstract getUserEmail(): string;
  abstract login(): void;
  abstract logout(): void;
  abstract getAccessToken(): Observable<string>;
  abstract initialize(): Observable<void>;
  abstract handleRedirectCallback(): Observable<boolean>;
}
```

This defines WHAT the auth service must do. Not HOW.

### Layer 2: Implementations

**MsalAuthService** (`msal-auth.service.ts`):
```ts
export class MsalAuthService extends AuthService {
  login() { this.msalService.loginRedirect(...); }
}
```

**OidcAuthService** (`oidc-auth.service.ts`):
```ts
export class OidcAuthService extends AuthService {
  login() { this.oidcService.authorize(); }
}
```

### Layer 3: Conditional Registration (`app.config.ts`)

```ts
...(environment.authProvider === 'msal'
  ? [{ provide: AuthService, useClass: MsalAuthService }]
  : [{ provide: AuthService, useClass: OidcAuthService }])
```

### Layer 4: Components Use Abstract Service

```ts
// ✅ GOOD — decoupled from any specific library
import { AuthService } from '../../services/auth.service';

export class LoginComponent {
  constructor(private authService: AuthService) {}
  
  login() {
    this.authService.login(); // Could be MSAL or OIDC — component doesn't know
  }
}
```

---

## 3. How Angular DI Resolves It

```
                    environment.ts
                    authProvider: 'oidc'
                         │
                         ▼
                    app.config.ts
          ┌─────────────────────────────┐
          │ if 'msal':                  │
          │   provide: AuthService      │
          │   useClass: MsalAuthService │
          │                             │
          │ if 'oidc':                  │
          │   provide: AuthService      │  ← This one gets registered
          │   useClass: OidcAuthService │
          └─────────────┬───────────────┘
                        │
           Angular DI Container stores:
           AuthService → OidcAuthService
                        │
                        ▼
          ┌─────────────────────────────┐
          │ LoginComponent              │
          │ constructor(                │
          │   private auth: AuthService │ ← DI injects OidcAuthService
          │ )                           │
          └─────────────────────────────┘
```

When a component asks for `AuthService`, Angular's Dependency Injection:
1. Looks up the provider registry: "What class is registered for `AuthService`?"
2. Finds: `{ provide: AuthService, useClass: OidcAuthService }`
3. Creates an `OidcAuthService` instance (or reuses existing one)
4. Injects it into the component

The component receives `OidcAuthService` but only sees it as `AuthService`. It can only call methods defined in the abstract class.

---

## 4. File-by-File Explanation

### `src/environments/environment.ts`
```ts
export const environment = {
  production: false,
  authProvider: 'oidc' as 'msal' | 'oidc',  // ⭐ THE SWITCH
  azureAd: {
    tenantId: '79e7043b-...',
    clientId: 'f50d4ced-...',
    redirectUri: 'http://localhost:4200',
    // ... shared config used by BOTH providers
  },
};
```
**Purpose:** Single source of truth for which provider to use. Azure AD config is shared because both providers connect to the same App Registration.

### `src/app/services/auth.service.ts`
**Purpose:** Abstract class that defines the contract. Components import THIS, not MSAL or OIDC.

### `src/app/services/msal-auth.service.ts`
**Purpose:** Implements `AuthService` using `@azure/msal-angular`. Wraps MSAL-specific APIs behind the common interface.

### `src/app/services/oidc-auth.service.ts`
**Purpose:** Implements `AuthService` using `angular-auth-oidc-client`. Wraps OIDC-specific APIs behind the common interface.

### `src/app/services/auth.guard.ts`
```ts
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);  // Gets whichever is registered
  return authService.isAuthenticated() || router.navigate(['/']);
};
```
**Purpose:** Universal route guard. Works with both providers because it only calls `AuthService.isAuthenticated()`.

### `src/app/app.config.ts`
```ts
...(environment.authProvider === 'msal' 
  ? getMsalProviders()   // Registers MSAL + MsalAuthService
  : getOidcProviders())  // Registers OIDC + OidcAuthService
```
**Purpose:** The switching logic. Only one set of providers is loaded — the unused library's code is included in the bundle but never instantiated.

### `src/app/app.ts`
```ts
export class App implements OnInit {
  constructor(private authService: AuthService) {}  // Abstract!
  
  ngOnInit() {
    this.authService.initialize().subscribe(() => {
      this.authService.handleRedirectCallback().subscribe((loggedIn) => {
        if (loggedIn) this.router.navigate(['/home']);
      });
    });
  }
}
```
**Purpose:** Root component handles auth initialization and redirect processing. Same code for both providers.

### `src/app/pages/login/login.ts`
```ts
export class LoginComponent {
  authProvider = environment.authProvider;  // For UI display only
  
  login() { this.authService.login(); }     // Provider-agnostic
  logout() { this.authService.logout(); }   // Provider-agnostic
}
```
**Purpose:** Login page. Shows which provider is active in the UI. Login/logout calls go through the abstract service.

### `src/app/pages/home/home.ts`
```ts
loadProfile() {
  this.authService.getAccessToken().subscribe(token => {
    // Use token to call Graph API — works with both providers
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    this.http.get('https://graph.microsoft.com/v1.0/me', { headers }).subscribe(...);
  });
}
```
**Purpose:** Dashboard page. Fetches user profile from Microsoft Graph API. Token acquisition is abstracted — works the same whether MSAL or OIDC provided the token.

---

## 5. Adding a New Auth Provider

To add a third provider (e.g., Auth0):

### Step 1: Create implementation
```ts
// src/app/services/auth0-auth.service.ts
export class Auth0AuthService extends AuthService {
  constructor(private auth0: AuthService_from_Auth0) { super(); }
  login() { this.auth0.loginWithRedirect(); }
  // ... implement all abstract methods
}
```

### Step 2: Add provider function
```ts
// In app.config.ts
function getAuth0Providers() {
  return [
    provideAuth0({ domain: '...', clientId: '...' }),
    { provide: AuthService, useClass: Auth0AuthService },
  ];
}
```

### Step 3: Update the switch
```ts
// In environment.ts
authProvider: 'auth0' as 'msal' | 'oidc' | 'auth0'

// In app.config.ts
...(environment.authProvider === 'msal' ? getMsalProviders()
  : environment.authProvider === 'oidc' ? getOidcProviders()
  : getAuth0Providers())
```

**No component changes needed.** The abstraction handles it.

---

## 6. Design Pattern Used

This is the **Strategy Pattern** combined with **Dependency Injection**:

- **Strategy Pattern:** Multiple algorithms (MSAL, OIDC) implement the same interface (AuthService). The algorithm is selected at configuration time.
- **Dependency Injection:** Angular's DI container handles creating and distributing the selected strategy to all components.

```
┌─────────────────────────────────────────┐
│           Strategy Pattern              │
│                                         │
│  ┌───────────┐                          │
│  │ AuthService│ ← Abstract Strategy     │
│  └─────┬─────┘                          │
│        │                                │
│   ┌────┴────┐    ┌────┴────┐            │
│   │  MSAL   │    │  OIDC   │            │
│   │Strategy │    │Strategy │            │
│   └─────────┘    └─────────┘            │
│                                         │
│  Selected by: environment.authProvider  │
│  Injected by: Angular DI               │
└─────────────────────────────────────────┘
```

---

## 7. Trade-offs

### Pros
- ✅ Switch providers with one variable change
- ✅ Components are clean — no auth library imports
- ✅ Easy to add new providers
- ✅ Easy to test — mock `AuthService` in unit tests
- ✅ Same Azure AD App Registration for both

### Cons
- ⚠️ Both libraries are in the bundle (increases size by ~120KB)
- ⚠️ Abstract interface limits provider-specific features
- ⚠️ Extra layer of indirection — debugging requires checking which implementation is active

### Future Optimization
To reduce bundle size, use **lazy loading** with dynamic imports:
```ts
// Only load the selected provider's code
if (environment.authProvider === 'msal') {
  const { MsalAuthService } = await import('./services/msal-auth.service');
}
```
This is a more advanced optimization for production apps.

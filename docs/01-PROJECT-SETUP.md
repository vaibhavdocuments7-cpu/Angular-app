# Angular App — Project Setup Guide

## Overview

This document explains how the Angular project was created from scratch, including project setup, dependencies, and folder structure.

---

## 1. Prerequisites

| Tool         | Version    | Install Command                          |
|-------------|------------|------------------------------------------|
| Node.js     | v22.x LTS  | Install via [nvm-windows](https://github.com/coreybutler/nvm-windows) |
| Angular CLI | v21.x      | `npm install -g @angular/cli`            |
| npm         | v10+       | Comes with Node.js                       |

### Node.js Version Compatibility
- Angular CLI v19+ requires **Node ≥20.19** or **≥22.12**
- Node v24 is **NOT** supported by Angular CLI
- We used **Node v22.22.2** via nvm4w

---

## 2. Project Creation

```bash
# Navigate to the parent directory
cd C:\Users\v-vaibhavg\OneDrive - Microsoft\Desktop\terraform\angularproject

# Create new Angular project
ng new angular-app --style=css --skip-tests --ssr

# Navigate into the project
cd angular-app
```

### Flags Explained:
| Flag           | What it does                                    |
|----------------|------------------------------------------------|
| `--style=css`  | Use plain CSS (not SCSS/LESS)                  |
| `--skip-tests` | Don't generate `.spec.ts` test files           |
| `--ssr`        | Enable Server-Side Rendering (later disabled)  |

---

## 3. SSR Was Disabled

SSR was initially enabled but caused `state_mismatch` errors with MSAL authentication. When Microsoft redirected back to `localhost:4200/?state=...`, the SSR server processed the URL first but had no access to browser's `sessionStorage` where MSAL stored the pre-redirect state.

**Fix:** Removed SSR configuration from `angular.json`:
```json
// REMOVED these lines from angular.json → build → options:
"server": "src/main.server.ts",
"outputMode": "server",
"ssr": {
  "entry": "src/server.ts"
}
```

The app now runs as a **pure client-side SPA**.

---

## 4. Dependencies Installed

### Authentication Libraries
```bash
# MSAL — Microsoft's official auth library
npm install @azure/msal-angular @azure/msal-browser

# OIDC — Generic OpenID Connect library (alternative to MSAL)
npm install angular-auth-oidc-client
```

### Other Dependencies
```bash
# Angular animations (required by some MSAL components)
npm install @angular/animations
```

### Installed Versions
| Package                      | Version |
|-----------------------------|---------|
| @azure/msal-angular         | 5.2.3   |
| @azure/msal-browser         | 5.10.0  |
| angular-auth-oidc-client    | 19.x    |
| @angular/core               | 21.x    |

---

## 5. Project Structure

```
angular-app/
├── docs/                          # Documentation
│   ├── 01-PROJECT-SETUP.md        # This file
│   ├── 02-MSAL-IMPLEMENTATION.md  # MSAL auth details
│   ├── 03-OIDC-IMPLEMENTATION.md  # OIDC auth details
│   └── 04-AUTH-ABSTRACTION.md     # How switching works
├── src/
│   ├── environments/
│   │   ├── environment.ts         # ⭐ Auth provider switch
│   │   └── environment.development.ts
│   ├── app/
│   │   ├── services/
│   │   │   ├── auth.service.ts        # Abstract auth interface
│   │   │   ├── msal-auth.service.ts   # MSAL implementation
│   │   │   ├── oidc-auth.service.ts   # OIDC implementation
│   │   │   └── auth.guard.ts          # Route guard (both providers)
│   │   ├── pages/
│   │   │   ├── login/                 # Login page
│   │   │   │   ├── login.ts
│   │   │   │   ├── login.html
│   │   │   │   └── login.css
│   │   │   └── home/                  # Dashboard (protected)
│   │   │       ├── home.ts
│   │   │       ├── home.html
│   │   │       └── home.css
│   │   ├── app.ts                 # Root component
│   │   ├── app.config.ts          # ⭐ Provider registration
│   │   ├── app.routes.ts          # Route definitions
│   │   └── auth-config.ts         # Legacy MSAL config (kept for reference)
│   ├── main.ts                    # App entry point
│   └── index.html
├── angular.json                   # Angular build config
├── package.json
└── tsconfig.app.json
```

---

## 6. Azure AD App Registration

The app uses an Azure AD (Entra ID) App Registration for authentication.

| Setting              | Value                                          |
|---------------------|------------------------------------------------|
| App Name            | angularlogin                                   |
| Client ID           | `f50d4ced-edfb-4ce9-b4e1-2bebf771e699`        |
| Tenant ID           | `79e7043b-2d89-4454-9f07-1d8ceb3f0399`        |
| Platform            | Single-page application (SPA)                  |
| Redirect URI        | `http://localhost:4200`                        |
| Supported Accounts  | Single tenant                                  |

### How to Configure in Azure Portal:
1. Go to **Azure Portal** → **Entra ID** → **App Registrations**
2. Click **New Registration**
3. Name: `angularlogin`, Supported account types: Single tenant
4. Under **Authentication** → Add platform → **Single-page application**
5. Redirect URI: `http://localhost:4200`
6. Under **API Permissions** → Add `Microsoft Graph` → `User.Read`

---

## 7. Running the App

```bash
# Development server
ng serve

# Build for production
ng build --configuration production

# The app will be available at:
# http://localhost:4200
```

---

## 8. Switching Auth Provider

Open `src/environments/environment.ts` and change:

```ts
// Use OIDC (angular-auth-oidc-client)
authProvider: 'oidc'

// Use MSAL (Microsoft Authentication Library)
authProvider: 'msal'
```

No other code changes needed — the abstraction layer handles everything.

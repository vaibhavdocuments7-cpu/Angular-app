import { MsalGuardConfiguration, MsalInterceptorConfiguration } from '@azure/msal-angular';
import { BrowserCacheLocation, InteractionType, PublicClientApplication } from '@azure/msal-browser';

// ============================================================================
// Azure AD App Registration Details
// ============================================================================
// These values come from Azure Portal → Entra ID → App Registrations → angularlogin
const TENANT_ID = '79e7043b-2d89-4454-9f07-1d8ceb3f0399';
const CLIENT_ID = 'f50d4ced-edfb-4ce9-b4e1-2bebf771e699';

// ============================================================================
// MSAL Configuration
// ============================================================================
// PublicClientApplication = the main MSAL object that handles all auth
export const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    // Authority = Azure AD endpoint for your tenant
    // This tells MSAL: "validate tokens against THIS Azure AD tenant"
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    // Where Azure AD redirects AFTER login — must match Azure Portal config
    redirectUri: 'http://localhost:4200',
    // Where to go after logout
    postLogoutRedirectUri: 'http://localhost:4200',
    // Don't try to navigate back to the original URL with state params
    navigateToLoginRequestUrl: false,
  },
  cache: {
    // sessionStorage is more reliable for redirect flow (avoids state_mismatch)
    cacheLocation: BrowserCacheLocation.SessionStorage,
    storeAuthStateInCookie: false,
  },
};

// ============================================================================
// MSAL Guard Config (protects routes)
// ============================================================================
// When an unauthenticated user hits a protected route:
// InteractionType.Redirect = full page redirect to Microsoft login
// InteractionType.Popup = login popup window (less disruptive)
export const msalGuardConfig: MsalGuardConfiguration = {
  interactionType: InteractionType.Redirect,
  authRequest: {
    // Scopes = what permissions your app requests
    // 'user.read' = permission to read the logged-in user's profile
    scopes: ['user.read'],
  },
};

// ============================================================================
// MSAL Interceptor Config (auto-attaches tokens to HTTP calls)
// ============================================================================
// Maps API URLs to the scopes needed for that API
// When Angular HttpClient calls these URLs, MSAL automatically adds
// the Bearer token to the Authorization header
export const msalInterceptorConfig: MsalInterceptorConfiguration = {
  interactionType: InteractionType.Redirect,
  protectedResourceMap: new Map<string, string[]>([
    // Microsoft Graph API — needs 'user.read' scope
    ['https://graph.microsoft.com/v1.0/', ['user.read']],
    // Add your own API here:
    // ['https://your-api.azurewebsites.net/api/', ['api://CLIENT_ID/access_as_user']],
  ]),
};

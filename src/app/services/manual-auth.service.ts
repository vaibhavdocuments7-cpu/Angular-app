import { Injectable } from '@angular/core';
import { Observable, of, from } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

// ============================================================================
// Manual OAuth 2.0 + PKCE Implementation — Zero Library
// ============================================================================
// Pure implementation using fetch() and Web Crypto API.
// No MSAL, no OIDC library — just raw OAuth 2.0 Authorization Code + PKCE.

const azureAd = environment.azureAd;
const TENANT_ID = azureAd.tenantId;
const CLIENT_ID = azureAd.clientId;
const REDIRECT_URI = azureAd.redirectUri;
const SCOPES = 'openid profile email user.read offline_access';

// Azure AD OAuth 2.0 endpoints
const AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const LOGOUT_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/logout`;

// Session storage keys
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'manual_auth_access_token',
  ID_TOKEN: 'manual_auth_id_token',
  REFRESH_TOKEN: 'manual_auth_refresh_token',
  EXPIRES_AT: 'manual_auth_expires_at',
  CODE_VERIFIER: 'manual_auth_code_verifier',
  STATE: 'manual_auth_state',
};

// ============================================================================
// PKCE Helper Functions (Web Crypto API)
// ============================================================================

// Generate a cryptographically random code_verifier (43-128 chars)
function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

// Create code_challenge = Base64URL(SHA-256(code_verifier))
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

// Generate random state parameter (CSRF protection)
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

// Base64 URL encoding (no padding, URL-safe characters)
function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ============================================================================
// JWT Decoder — extract user claims from ID token
// ============================================================================
function decodeJwt(token: string): Record<string, any> {
  const payload = token.split('.')[1];
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decoded);
}

// ============================================================================
// ManualAuthService — Angular Service
// ============================================================================
@Injectable()
export class ManualAuthService extends AuthService {
  private accessToken = '';
  private idToken = '';
  private userClaims: Record<string, any> | null = null;

  constructor() {
    super();
    // Restore tokens from session storage on service creation
    this.accessToken = sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) || '';
    this.idToken = sessionStorage.getItem(STORAGE_KEYS.ID_TOKEN) || '';
    if (this.idToken) {
      try {
        this.userClaims = decodeJwt(this.idToken);
      } catch {
        this.userClaims = null;
      }
    }
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  getUserName(): string {
    return this.userClaims?.['name'] || this.userClaims?.['preferred_username'] || 'Unknown';
  }

  getUserEmail(): string {
    return this.userClaims?.['email'] || this.userClaims?.['preferred_username'] || 'Unknown';
  }

  // ============================================================================
  // Login — Build authorize URL with PKCE and redirect to Azure AD
  // ============================================================================
  login(): void {
    // Use async IIFE since login() returns void but PKCE needs async crypto
    (async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = generateState();

      // Store PKCE values for verification after redirect
      sessionStorage.setItem(STORAGE_KEYS.CODE_VERIFIER, codeVerifier);
      sessionStorage.setItem(STORAGE_KEYS.STATE, state);

      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: state,
        response_mode: 'query',
      });

      console.log('Manual Auth: Redirecting to Azure AD...');
      window.location.href = `${AUTHORIZE_URL}?${params.toString()}`;
    })();
  }

  // ============================================================================
  // Logout — Clear tokens and redirect to Azure AD logout
  // ============================================================================
  logout(): void {
    Object.values(STORAGE_KEYS).forEach((key) => sessionStorage.removeItem(key));
    this.accessToken = '';
    this.idToken = '';
    this.userClaims = null;

    const params = new URLSearchParams({
      post_logout_redirect_uri: azureAd.postLogoutRedirectUri,
    });
    window.location.href = `${LOGOUT_URL}?${params.toString()}`;
  }

  // ============================================================================
  // Get Access Token — returns token with auto-refresh if expired
  // ============================================================================
  getAccessToken(): Observable<string> {
    const expiresAt = parseInt(sessionStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || '0');

    // Token still valid
    if (this.accessToken && Date.now() < expiresAt) {
      return of(this.accessToken);
    }

    // Try to refresh
    const refreshToken = sessionStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    if (refreshToken) {
      return from(this.refreshAccessToken(refreshToken));
    }

    return of(this.accessToken);
  }

  // ============================================================================
  // Initialize — nothing to initialize for manual flow
  // ============================================================================
  initialize(): Observable<void> {
    return of(void 0);
  }

  // ============================================================================
  // Handle Redirect Callback — check for ?code= in URL and exchange for tokens
  // ============================================================================
  handleRedirectCallback(): Observable<boolean> {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const savedState = sessionStorage.getItem(STORAGE_KEYS.STATE);

    if (!code) {
      // No authorization code — not a redirect callback
      return of(false);
    }

    // Validate state to prevent CSRF attacks
    if (state !== savedState) {
      console.error('Manual Auth: State mismatch! Possible CSRF attack.');
      window.history.replaceState({}, document.title, window.location.pathname);
      return of(false);
    }

    // Exchange authorization code for tokens
    return from(this.exchangeCodeForTokens(code));
  }

  // ============================================================================
  // Private: Exchange authorization code for tokens via POST to /token endpoint
  // ============================================================================
  private async exchangeCodeForTokens(code: string): Promise<boolean> {
    const codeVerifier = sessionStorage.getItem(STORAGE_KEYS.CODE_VERIFIER);
    if (!codeVerifier) {
      console.error('Manual Auth: No code_verifier found — cannot complete PKCE');
      return false;
    }

    console.log('Manual Auth: Exchanging authorization code for tokens...');

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      scope: SCOPES,
    });

    try {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Manual Auth: Token exchange failed:', error);
        return false;
      }

      const tokens = await response.json();
      console.log('Manual Auth: Tokens received!', {
        hasAccessToken: !!tokens.access_token,
        hasIdToken: !!tokens.id_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
      });

      // Store tokens in session storage
      const expiresAt = Date.now() + tokens.expires_in * 1000;
      sessionStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.access_token);
      sessionStorage.setItem(STORAGE_KEYS.ID_TOKEN, tokens.id_token);
      sessionStorage.setItem(STORAGE_KEYS.EXPIRES_AT, expiresAt.toString());
      if (tokens.refresh_token) {
        sessionStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refresh_token);
      }

      // Clean up PKCE values (one-time use)
      sessionStorage.removeItem(STORAGE_KEYS.CODE_VERIFIER);
      sessionStorage.removeItem(STORAGE_KEYS.STATE);

      // Update service state
      this.accessToken = tokens.access_token;
      this.idToken = tokens.id_token;
      try {
        this.userClaims = decodeJwt(tokens.id_token);
      } catch {
        this.userClaims = null;
      }

      // Clean URL (remove ?code=&state= params)
      window.history.replaceState({}, document.title, window.location.pathname);

      return true;
    } catch (err) {
      console.error('Manual Auth: Token exchange error:', err);
      return false;
    }
  }

  // ============================================================================
  // Private: Refresh access token using refresh_token grant
  // ============================================================================
  private async refreshAccessToken(refreshToken: string): Promise<string> {
    console.log('Manual Auth: Token expired, refreshing...');

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPES,
    });

    try {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (response.ok) {
        const tokens = await response.json();
        const newExpiresAt = Date.now() + tokens.expires_in * 1000;
        sessionStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.access_token);
        sessionStorage.setItem(STORAGE_KEYS.ID_TOKEN, tokens.id_token);
        sessionStorage.setItem(STORAGE_KEYS.EXPIRES_AT, newExpiresAt.toString());
        if (tokens.refresh_token) {
          sessionStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refresh_token);
        }

        this.accessToken = tokens.access_token;
        this.idToken = tokens.id_token;
        try {
          this.userClaims = decodeJwt(tokens.id_token);
        } catch {
          this.userClaims = null;
        }

        return tokens.access_token;
      }
    } catch (err) {
      console.error('Manual Auth: Token refresh failed:', err);
    }

    return this.accessToken;
  }
}

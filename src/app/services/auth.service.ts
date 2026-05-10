import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

// ============================================================================
// Abstract Auth Service — common interface for MSAL and OIDC
// ============================================================================
// Components use THIS service — they don't know which provider is behind it.
// Switching provider = change environment.authProvider, no component changes.

export interface UserProfile {
  displayName: string;
  mail: string;
  jobTitle?: string;
  officeLocation?: string;
  mobilePhone?: string;
  userPrincipalName?: string;
}

@Injectable()
export abstract class AuthService {
  // Is the user currently authenticated?
  abstract isAuthenticated(): boolean;

  // Get the logged-in user's name
  abstract getUserName(): string;

  // Get the logged-in user's email
  abstract getUserEmail(): string;

  // Trigger login redirect to Azure AD
  abstract login(): void;

  // Trigger logout redirect
  abstract logout(): void;

  // Get access token for calling APIs (e.g., Graph API)
  abstract getAccessToken(): Observable<string>;

  // Initialize auth — called once at app startup
  abstract initialize(): Observable<void>;

  // Check and handle redirect callback (after Azure AD redirect)
  abstract handleRedirectCallback(): Observable<boolean>;
}

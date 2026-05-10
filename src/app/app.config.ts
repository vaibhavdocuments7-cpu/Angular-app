import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi, withFetch } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HTTP_INTERCEPTORS } from '@angular/common/http';

import {
  MSAL_GUARD_CONFIG,
  MSAL_INSTANCE,
  MSAL_INTERCEPTOR_CONFIG,
  MsalBroadcastService,
  MsalGuard,
  MsalInterceptor,
  MsalService,
} from '@azure/msal-angular';
import { BrowserCacheLocation, InteractionType, PublicClientApplication } from '@azure/msal-browser';
import { provideAuth, LogLevel } from 'angular-auth-oidc-client';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { AuthService } from './services/auth.service';
import { MsalAuthService } from './services/msal-auth.service';
import { OidcAuthService } from './services/oidc-auth.service';
import { ManualAuthService } from './services/manual-auth.service';

const azureAd = environment.azureAd;

// ============================================================================
// MSAL Providers (only used when authProvider = 'msal')
// ============================================================================
function getMsalProviders() {
  return [
    {
      provide: MSAL_INSTANCE,
      useFactory: () =>
        new PublicClientApplication({
          auth: {
            clientId: azureAd.clientId,
            authority: `https://login.microsoftonline.com/${azureAd.tenantId}`,
            redirectUri: azureAd.redirectUri,
            postLogoutRedirectUri: azureAd.postLogoutRedirectUri,
          },
          cache: {
            cacheLocation: BrowserCacheLocation.SessionStorage,
          },
        }),
    },
    {
      provide: MSAL_GUARD_CONFIG,
      useValue: { interactionType: InteractionType.Redirect, authRequest: { scopes: ['user.read'] } },
    },
    {
      provide: MSAL_INTERCEPTOR_CONFIG,
      useValue: {
        interactionType: InteractionType.Redirect,
        protectedResourceMap: new Map([['https://graph.microsoft.com/v1.0/', ['user.read']]]),
      },
    },
    { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
    MsalService,
    MsalGuard,
    MsalBroadcastService,
    { provide: AuthService, useClass: MsalAuthService },
  ];
}

// ============================================================================
// OIDC Providers (only used when authProvider = 'oidc')
// ============================================================================
function getOidcProviders() {
  return [
    provideAuth({
      config: {
        authority: `https://login.microsoftonline.com/${azureAd.tenantId}/v2.0`,
        redirectUrl: azureAd.redirectUri,
        postLogoutRedirectUri: azureAd.postLogoutRedirectUri,
        clientId: azureAd.clientId,
        scope: 'openid profile email user.read offline_access',
        responseType: 'code',
        silentRenew: true,
        useRefreshToken: true,
        logLevel: LogLevel.Debug,
        autoUserInfo: false,
        authWellknownEndpointUrl: `https://login.microsoftonline.com/${azureAd.tenantId}/v2.0`,
        // Fix: Allow clock skew up to 10 minutes (default is too strict)
        maxIdTokenIatOffsetAllowedInSeconds: 600,
        // Don't redirect to /unauthorized on failure
        unauthorizedRoute: '/',
      },
    }),
    { provide: AuthService, useClass: OidcAuthService },
  ];
}

// ============================================================================
// Manual Providers (only used when authProvider = 'manual')
// ============================================================================
function getManualProviders() {
  return [
    { provide: AuthService, useClass: ManualAuthService },
  ];
}

// ============================================================================
// Provider Selector — returns the right providers based on environment
// ============================================================================
function getAuthProviders() {
  switch (environment.authProvider) {
    case 'msal':
      return getMsalProviders();
    case 'oidc':
      return getOidcProviders();
    case 'manual':
      return getManualProviders();
    default:
      console.warn(`Unknown auth provider: ${environment.authProvider}, falling back to MSAL`);
      return getMsalProviders();
  }
}

// ============================================================================
// App Configuration — switches providers based on environment
// ============================================================================
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi(), withFetch()),
    provideNoopAnimations(),

    // ⭐ Conditionally load auth providers based on environment variable
    ...getAuthProviders(),
  ],
};


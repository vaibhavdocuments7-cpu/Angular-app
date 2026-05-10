// ============================================================================
// Environment Configuration
// ============================================================================
// Switch authProvider to change authentication library:
//   'msal' = Microsoft Authentication Library (Microsoft's official SDK)
//   'oidc' = angular-auth-oidc-client (generic OpenID Connect library)
// Both use the SAME Azure AD App Registration — no portal changes needed

export const environment = {
  production: false,

  // ⭐ CHANGE THIS to switch auth provider
  authProvider: 'oidc' as 'msal' | 'oidc',

  // Azure AD App Registration (shared by both providers)
  azureAd: {
    tenantId: '79e7043b-2d89-4454-9f07-1d8ceb3f0399',
    clientId: 'f50d4ced-edfb-4ce9-b4e1-2bebf771e699',
    redirectUri: 'http://localhost:4200',
    postLogoutRedirectUri: 'http://localhost:4200',
    scopes: ['openid', 'profile', 'email', 'user.read'],
  },
};

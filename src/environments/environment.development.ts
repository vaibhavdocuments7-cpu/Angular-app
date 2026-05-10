// Development environment — same as default
// Angular CLI swaps this file via angular.json fileReplacements
export const environment = {
  production: false,
  authProvider: 'oidc' as 'msal' | 'oidc',
  azureAd: {
    tenantId: '79e7043b-2d89-4454-9f07-1d8ceb3f0399',
    clientId: 'f50d4ced-edfb-4ce9-b4e1-2bebf771e699',
    redirectUri: 'http://localhost:4200',
    postLogoutRedirectUri: 'http://localhost:4200',
    scopes: ['openid', 'profile', 'email', 'user.read'],
  },
};

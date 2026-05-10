import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// ============================================================================
// Universal Auth Guard — works with both MSAL and OIDC
// ============================================================================
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  // Not authenticated — redirect to login page
  router.navigate(['/']);
  return false;
};

import { Injectable } from '@angular/core';
import { Observable, of, map, catchError, switchMap, take } from 'rxjs';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { AuthService } from './auth.service';

@Injectable()
export class OidcAuthService extends AuthService {
  private _isAuthenticated = false;
  private _userData: any = null;

  constructor(private oidcService: OidcSecurityService) {
    super();
  }

  isAuthenticated(): boolean {
    return this._isAuthenticated;
  }

  getUserName(): string {
    return this._userData?.name || this._userData?.preferred_username || 'Unknown';
  }

  getUserEmail(): string {
    return this._userData?.email || this._userData?.preferred_username || 'Unknown';
  }

  login(): void {
    this.oidcService.authorize();
  }

  logout(): void {
    this.oidcService.logoff().subscribe();
  }

  getAccessToken(): Observable<string> {
    return this.oidcService.getAccessToken();
  }

  initialize(): Observable<void> {
    return of(void 0);
  }

  handleRedirectCallback(): Observable<boolean> {
    // Pass the full URL so the library can extract ?code= and ?state=
    // This prevents Angular router from stripping params before OIDC processes them
    const currentUrl = window.location.toString();
    console.log('OIDC: checking auth with URL:', currentUrl);

    return this.oidcService.checkAuth(currentUrl).pipe(
      map((loginResponse) => {
        console.log('OIDC checkAuth result:', JSON.stringify(loginResponse));
        this._isAuthenticated = loginResponse?.isAuthenticated || false;

        if (this._isAuthenticated && loginResponse?.userData) {
          this._userData = loginResponse.userData;
          console.log('OIDC user data from response:', this._userData);
        } else if (this._isAuthenticated) {
          // Try to get claims from ID token
          const idToken = loginResponse?.idToken;
          if (idToken) {
            try {
              const payload = JSON.parse(atob(idToken.split('.')[1]));
              this._userData = payload;
              console.log('OIDC user data from ID token:', this._userData);
            } catch (e) {
              console.warn('Could not parse ID token');
            }
          }
        }

        return this._isAuthenticated;
      }),
      catchError((err) => {
        console.error('OIDC auth check error:', err);
        return of(false);
      })
    );
  }
}

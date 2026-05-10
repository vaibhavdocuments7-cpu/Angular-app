import { Injectable } from '@angular/core';
import { Observable, of, map, catchError } from 'rxjs';
import { MsalService, MsalBroadcastService } from '@azure/msal-angular';
import { AuthService } from './auth.service';

// ============================================================================
// MSAL Implementation of AuthService
// ============================================================================
@Injectable()
export class MsalAuthService extends AuthService {
  constructor(
    private msalService: MsalService,
    private msalBroadcastService: MsalBroadcastService
  ) {
    super();
  }

  isAuthenticated(): boolean {
    return this.msalService.instance.getAllAccounts().length > 0;
  }

  getUserName(): string {
    const account = this.msalService.instance.getActiveAccount();
    return account?.name || 'Unknown';
  }

  getUserEmail(): string {
    const account = this.msalService.instance.getActiveAccount();
    return account?.username || 'Unknown';
  }

  login(): void {
    this.msalService.loginRedirect({ scopes: ['user.read'] });
  }

  logout(): void {
    this.msalService.logoutRedirect();
  }

  getAccessToken(): Observable<string> {
    const account = this.msalService.instance.getActiveAccount();
    if (!account) {
      return of('');
    }
    return this.msalService.acquireTokenSilent({
      scopes: ['user.read'],
      account: account,
    }).pipe(
      map((result) => result.accessToken),
      catchError((err) => {
        console.error('MSAL token acquisition failed:', err);
        return of('');
      })
    );
  }

  initialize(): Observable<void> {
    return this.msalService.initialize();
  }

  handleRedirectCallback(): Observable<boolean> {
    return this.msalService.handleRedirectObservable().pipe(
      map((result) => {
        if (result && result.account) {
          this.msalService.instance.setActiveAccount(result.account);
          return true; // login success
        }
        // No redirect result — set active account if one exists
        const accounts = this.msalService.instance.getAllAccounts();
        if (accounts.length > 0) {
          this.msalService.instance.setActiveAccount(accounts[0]);
        }
        return false;
      }),
      catchError((err) => {
        console.error('MSAL redirect error:', err);
        return of(false);
      })
    );
  }
}

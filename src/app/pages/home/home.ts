import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent {
  userProfile: any = null;
  authProvider = environment.authProvider;

  constructor(
    private authService: AuthService,
    private http: HttpClient
  ) {}

  loadProfile(): void {
    // Get access token from whichever provider is active
    this.authService.getAccessToken().subscribe({
      next: (token) => {
        if (!token) {
          console.error('No access token available');
          return;
        }
        const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
        this.http
          .get('https://graph.microsoft.com/v1.0/me', { headers })
          .subscribe({
            next: (profile) => { this.userProfile = profile; },
            error: (err) => { console.error('Graph API error:', err); },
          });
      },
      error: (err) => {
        console.error('Token acquisition failed:', err);
      },
    });
  }

  logout(): void {
    this.authService.logout();
  }
}

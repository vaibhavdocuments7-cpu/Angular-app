import { Component, OnInit } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
  styleUrl: './app.css',
})
export class App implements OnInit {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Initialize auth provider, then handle any redirect callback
    this.authService.initialize().subscribe(() => {
      this.authService.handleRedirectCallback().subscribe((loggedIn) => {
        console.log('Auth callback result — loggedIn:', loggedIn);
        if (loggedIn) {
          this.router.navigate(['/home'], { replaceUrl: true });
        }
        // Don't clear URL params manually — let the auth library handle it
      });
    });
  }
}

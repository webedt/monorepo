/**
 * Login Page
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Input, Card, toast } from '../../components';
import { authStore } from '../../stores/authStore';
import './login.css';

export class LoginPage extends Page<PageOptions> {
  readonly route = '/login';
  readonly title = 'Login';

  private emailInput: Input | null = null;
  private passwordInput: Input | null = null;
  private submitButton: Button | null = null;
  private card: Card | null = null;

  protected render(): string {
    return `
      <div class="login-page">
        <div class="login-container">
          <div class="login-header">
            <h1 class="login-title">WebEDT</h1>
            <p class="login-subtitle">AI-Powered Code Editor</p>
          </div>

          <div class="login-card"></div>

          <p class="login-footer">
            Don't have an account?
            <a href="#/register" class="login-link">Register</a>
          </p>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    // Check if already logged in
    if (authStore.isAuthenticated()) {
      this.navigate('/agents', { replace: true });
      return;
    }

    // Create form card
    const cardContainer = this.$('.login-card') as HTMLElement;
    if (cardContainer) {
      this.card = new Card();
      const body = this.card.body();
      body.getElement().appendChild(this.createForm());
      this.card.mount(cardContainer);
    }
  }

  private createForm(): HTMLElement {
    const form = document.createElement('form');
    form.className = 'login-form';
    form.innerHTML = `
      <div class="form-group">
        <label for="email" class="form-label">Email</label>
        <div class="email-input"></div>
      </div>

      <div class="form-group">
        <label for="password" class="form-label">Password</label>
        <div class="password-input"></div>
      </div>

      <div class="form-group form-checkbox">
        <input type="checkbox" id="remember" class="checkbox">
        <label for="remember" class="checkbox-label">Remember me</label>
      </div>

      <div class="form-actions">
        <div class="submit-button"></div>
      </div>
    `;

    // Create email input
    this.emailInput = new Input({
      type: 'email',
      placeholder: 'you@example.com',
      required: true,
      autocomplete: 'email',
    });
    const emailContainer = form.querySelector('.email-input') as HTMLElement;
    if (emailContainer) {
      this.emailInput.mount(emailContainer);
    }

    // Create password input
    this.passwordInput = new Input({
      type: 'password',
      placeholder: 'Your password',
      required: true,
      autocomplete: 'current-password',
    });
    const passwordContainer = form.querySelector('.password-input') as HTMLElement;
    if (passwordContainer) {
      this.passwordInput.mount(passwordContainer);
    }

    // Create submit button
    this.submitButton = new Button('Sign In', {
      variant: 'primary',
      fullWidth: true,
      type: 'submit',
    });
    const submitContainer = form.querySelector('.submit-button') as HTMLElement;
    if (submitContainer) {
      this.submitButton.mount(submitContainer);
    }

    // Handle form submission
    form.addEventListener('submit', (e) => this.handleSubmit(e));

    return form;
  }

  private async handleSubmit(e: Event): Promise<void> {
    e.preventDefault();

    const email = this.emailInput?.getValue() || '';
    const password = this.passwordInput?.getValue() || '';
    const remember = (this.$('#remember') as HTMLInputElement)?.checked || false;

    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    this.submitButton?.setLoading(true);

    try {
      await authStore.login(email, password, remember);
      toast.success('Welcome back!');
      this.navigate('/agents', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      toast.error(message);
    } finally {
      this.submitButton?.setLoading(false);
    }
  }

  protected onUnmount(): void {
    this.emailInput?.unmount();
    this.passwordInput?.unmount();
    this.submitButton?.unmount();
    this.card?.unmount();
  }
}

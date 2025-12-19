/**
 * Register Page
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Input, Card, toast } from '../../components';
import { authStore } from '../../stores/authStore';
import '../login/login.css'; // Reuse login styles

export class RegisterPage extends Page<PageOptions> {
  readonly route = '/register';
  readonly title = 'Register';

  private emailInput: Input | null = null;
  private passwordInput: Input | null = null;
  private confirmPasswordInput: Input | null = null;
  private submitButton: Button | null = null;
  private card: Card | null = null;

  protected render(): string {
    return `
      <div class="login-page">
        <div class="login-container">
          <div class="login-header">
            <h1 class="login-title">WebEDT</h1>
            <p class="login-subtitle">Create your account</p>
          </div>

          <div class="login-card"></div>

          <p class="login-footer">
            Already have an account?
            <a href="#/login" class="login-link">Sign in</a>
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

      <div class="form-group">
        <label for="confirm-password" class="form-label">Confirm Password</label>
        <div class="confirm-password-input"></div>
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
    const emailContainer = form.querySelector('.email-input');
    if (emailContainer) {
      this.emailInput.mount(emailContainer as HTMLElement);
    }

    // Create password input
    this.passwordInput = new Input({
      type: 'password',
      placeholder: 'Create a password',
      required: true,
      autocomplete: 'new-password',
    });
    const passwordContainer = form.querySelector('.password-input');
    if (passwordContainer) {
      this.passwordInput.mount(passwordContainer as HTMLElement);
    }

    // Create confirm password input
    this.confirmPasswordInput = new Input({
      type: 'password',
      placeholder: 'Confirm your password',
      required: true,
      autocomplete: 'new-password',
    });
    const confirmContainer = form.querySelector('.confirm-password-input');
    if (confirmContainer) {
      this.confirmPasswordInput.mount(confirmContainer as HTMLElement);
    }

    // Create submit button
    this.submitButton = new Button('Create Account', {
      variant: 'primary',
      fullWidth: true,
      type: 'submit',
    });
    const submitContainer = form.querySelector('.submit-button');
    if (submitContainer) {
      this.submitButton.mount(submitContainer as HTMLElement);
    }

    // Handle form submission
    form.addEventListener('submit', (e) => this.handleSubmit(e));

    return form;
  }

  private async handleSubmit(e: Event): Promise<void> {
    e.preventDefault();

    const email = this.emailInput?.getValue() || '';
    const password = this.passwordInput?.getValue() || '';
    const confirmPassword = this.confirmPasswordInput?.getValue() || '';

    if (!email || !password || !confirmPassword) {
      toast.error('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    this.submitButton?.setLoading(true);

    try {
      await authStore.register(email, password);
      toast.success('Account created successfully!');
      this.navigate('/agents', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      toast.error(message);
    } finally {
      this.submitButton?.setLoading(false);
    }
  }

  protected onUnmount(): void {
    this.emailInput?.unmount();
    this.passwordInput?.unmount();
    this.confirmPasswordInput?.unmount();
    this.submitButton?.unmount();
    this.card?.unmount();
  }
}

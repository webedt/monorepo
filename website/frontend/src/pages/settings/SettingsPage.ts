/**
 * Settings Page
 */

import { Page, type PageOptions } from '../base/Page';
import { Card, Button, Input, toast } from '../../components';
import { authStore } from '../../stores/authStore';
import { githubApi, userApi } from '../../lib/api';
import type { ClaudeAuth } from '../../types';
import './settings.css';

export class SettingsPage extends Page<PageOptions> {
  readonly route = '/settings';
  readonly title = 'Settings';
  protected requiresAuth = true;

  private displayNameInput: Input | null = null;
  private claudeAuthInput: Input | null = null;
  private cards: Card[] = [];
  private buttons: Button[] = [];

  protected render(): string {
    return `
      <div class="settings-page">
        <header class="settings-header">
          <h1 class="settings-title">Settings</h1>
          <p class="settings-subtitle">Manage your account and preferences</p>
        </header>

        <div class="settings-sections">
          <section class="settings-section">
            <h2 class="section-title">Account</h2>
            <div class="section-card account-card"></div>
          </section>

          <section class="settings-section">
            <h2 class="section-title">Connections</h2>
            <div class="section-card connections-card"></div>
          </section>

          <section class="settings-section">
            <h2 class="section-title">Danger Zone</h2>
            <div class="section-card danger-card"></div>
          </section>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();
    this.renderAccountSection();
    this.renderConnectionsSection();
    this.renderDangerSection();
  }

  private renderAccountSection(): void {
    const container = this.$('.account-card') as HTMLElement;
    if (!container) return;

    const user = authStore.getUser();

    const content = document.createElement('div');
    content.className = 'account-content';
    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Email</label>
        <p class="form-value">${this.escapeHtml(user?.email || '')}</p>
      </div>
      <div class="form-group">
        <label class="form-label">Display Name</label>
        <div class="display-name-input"></div>
      </div>
      <div class="form-actions">
        <div class="save-btn"></div>
      </div>
    `;

    // Create display name input
    this.displayNameInput = new Input({
      type: 'text',
      placeholder: 'Your display name',
      value: user?.displayName || '',
    });
    const inputContainer = content.querySelector('.display-name-input') as HTMLElement;
    if (inputContainer) {
      this.displayNameInput.mount(inputContainer);
    }

    // Create save button
    const saveBtn = new Button('Save Changes', {
      variant: 'primary',
      onClick: () => this.handleSaveAccount(),
    });
    const saveBtnContainer = content.querySelector('.save-btn') as HTMLElement;
    if (saveBtnContainer) {
      saveBtn.mount(saveBtnContainer);
      this.buttons.push(saveBtn);
    }

    const card = new Card();
    const body = card.body();
    body.getElement().appendChild(content);
    card.mount(container);
    this.cards.push(card);
  }

  private renderConnectionsSection(): void {
    const container = this.$('.connections-card') as HTMLElement;
    if (!container) return;

    const user = authStore.getUser();
    const isGitHubConnected = !!user?.githubId;
    const isClaudeConnected = !!user?.claudeAuth;

    const content = document.createElement('div');
    content.className = 'connections-content';
    content.innerHTML = `
      <div class="connection-item">
        <div class="connection-info">
          <span class="connection-name">GitHub</span>
          <span class="connection-status ${isGitHubConnected ? 'connected' : 'disconnected'}">
            ${isGitHubConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div class="connection-action github-action"></div>
      </div>
      <div class="connection-item">
        <div class="connection-info">
          <span class="connection-name">Claude</span>
          <span class="connection-status ${isClaudeConnected ? 'connected' : 'disconnected'}">
            ${isClaudeConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div class="connection-action claude-action"></div>
      </div>
      ${!isClaudeConnected ? `
      <div class="claude-auth-form">
        <p class="connection-help">Paste your Claude auth JSON to connect:</p>
        <div class="claude-auth-input"></div>
        <div class="claude-auth-submit"></div>
      </div>
      ` : ''}
    `;

    // Create GitHub connect/disconnect button
    const githubAction = content.querySelector('.github-action') as HTMLElement;
    if (githubAction) {
      const btn = new Button(isGitHubConnected ? 'Disconnect' : 'Connect', {
        variant: isGitHubConnected ? 'secondary' : 'primary',
        onClick: () => this.handleGitHubAction(isGitHubConnected),
      });
      btn.mount(githubAction);
      this.buttons.push(btn);
    }

    // Create Claude connect/disconnect button
    const claudeAction = content.querySelector('.claude-action') as HTMLElement;
    if (claudeAction) {
      const btn = new Button(isClaudeConnected ? 'Disconnect' : 'Add Auth', {
        variant: isClaudeConnected ? 'secondary' : 'primary',
        onClick: () => this.handleClaudeAction(isClaudeConnected),
      });
      btn.mount(claudeAction);
      this.buttons.push(btn);
    }

    // Create Claude auth input and submit button if not connected
    if (!isClaudeConnected) {
      const claudeAuthInputContainer = content.querySelector('.claude-auth-input') as HTMLElement;
      if (claudeAuthInputContainer) {
        this.claudeAuthInput = new Input({
          type: 'text',
          placeholder: '{"claudeAiOauth":{"accessToken":"...","refreshToken":"..."}}',
        });
        this.claudeAuthInput.mount(claudeAuthInputContainer);
      }

      const claudeAuthSubmit = content.querySelector('.claude-auth-submit') as HTMLElement;
      if (claudeAuthSubmit) {
        const submitBtn = new Button('Save Claude Auth', {
          variant: 'primary',
          onClick: () => this.handleClaudeAuthSubmit(),
        });
        submitBtn.mount(claudeAuthSubmit);
        this.buttons.push(submitBtn);
      }
    }

    const card = new Card();
    const body = card.body();
    body.getElement().appendChild(content);
    card.mount(container);
    this.cards.push(card);
  }

  private renderDangerSection(): void {
    const container = this.$('.danger-card') as HTMLElement;
    if (!container) return;

    const content = document.createElement('div');
    content.className = 'danger-content';
    content.innerHTML = `
      <div class="danger-item">
        <div class="danger-info">
          <span class="danger-title">Sign Out</span>
          <span class="danger-description">Sign out of your account on this device</span>
        </div>
        <div class="logout-btn"></div>
      </div>
    `;

    // Create logout button
    const logoutBtn = new Button('Sign Out', {
      variant: 'danger',
      onClick: () => this.handleLogout(),
    });
    const logoutContainer = content.querySelector('.logout-btn') as HTMLElement;
    if (logoutContainer) {
      logoutBtn.mount(logoutContainer);
      this.buttons.push(logoutBtn);
    }

    const card = new Card();
    const body = card.body();
    body.getElement().appendChild(content);
    card.mount(container);
    this.cards.push(card);
  }

  private async handleSaveAccount(): Promise<void> {
    const displayName = this.displayNameInput?.getValue() || '';

    try {
      await userApi.updateDisplayName(displayName);
      authStore.updateUser({ displayName });
      toast.success('Settings saved');
    } catch (error) {
      toast.error('Failed to save settings');
    }
  }

  private async handleGitHubAction(isConnected: boolean): Promise<void> {
    if (isConnected) {
      try {
        await githubApi.disconnect();
        authStore.updateUser({ githubId: undefined });
        toast.success('GitHub disconnected');
        this.update({});
      } catch (error) {
        toast.error('Failed to disconnect GitHub');
      }
    } else {
      githubApi.connect();
    }
  }

  private async handleClaudeAction(isConnected: boolean): Promise<void> {
    if (isConnected) {
      try {
        await userApi.removeClaudeAuth();
        authStore.updateUser({ claudeAuth: undefined });
        toast.success('Claude disconnected');
        this.update({});
      } catch (error) {
        toast.error('Failed to disconnect Claude');
      }
    }
    // If not connected, the form is already shown
  }

  private async handleClaudeAuthSubmit(): Promise<void> {
    const authJson = this.claudeAuthInput?.getValue() || '';
    if (!authJson.trim()) {
      toast.error('Please paste your Claude auth JSON');
      return;
    }

    try {
      const parsed = JSON.parse(authJson);
      await userApi.updateClaudeAuth(parsed);

      // Update local user state
      authStore.updateUser({ claudeAuth: parsed as ClaudeAuth });
      toast.success('Claude authentication saved');
      this.update({});
    } catch (error) {
      if (error instanceof SyntaxError) {
        toast.error('Invalid JSON format');
      } else {
        toast.error('Failed to save Claude authentication');
      }
    }
  }

  private async handleLogout(): Promise<void> {
    try {
      await authStore.logout();
      this.navigate('/login', { replace: true });
    } catch (error) {
      toast.error('Failed to sign out');
    }
  }

  protected onUnmount(): void {
    this.displayNameInput?.unmount();
    this.claudeAuthInput?.unmount();
    for (const card of this.cards) {
      card.unmount();
    }
    for (const btn of this.buttons) {
      btn.unmount();
    }
    this.cards = [];
    this.buttons = [];
  }
}

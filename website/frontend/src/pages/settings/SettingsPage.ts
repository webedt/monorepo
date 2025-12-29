/**
 * Settings Page
 */

import { Page, type PageOptions } from '../base/Page';
import { Card, Button, Input, toast } from '../../components';
import { authStore } from '../../stores/authStore';
import { editorSettingsStore } from '../../stores/editorSettingsStore';
import { githubApi, userApi, billingApi } from '../../lib/api';
import { router } from '../../lib/router';
import type { ClaudeAuth, CodexAuth, GeminiAuth } from '../../types';
import './settings.css';

export class SettingsPage extends Page<PageOptions> {
  readonly route = '/settings';
  readonly title = 'Settings';
  protected requiresAuth = true;

  private displayNameInput: Input | null = null;
  private claudeAuthInput: Input | null = null;
  private codexAuthInput: Input | null = null;
  private geminiAuthInput: Input | null = null;
  private cards: Card[] = [];
  private buttons: Button[] = [];
  private billingData: {
    tier: string;
    usedBytes: string;
    quotaBytes: string;
    usagePercent: number;
    usedFormatted: string;
    quotaFormatted: string;
  } | null = null;

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
            <h2 class="section-title">Billing & Storage</h2>
            <div class="section-card billing-card"></div>
          </section>

          <section class="settings-section">
            <h2 class="section-title">Editor</h2>
            <div class="section-card editor-card"></div>
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

  async load(): Promise<void> {
    try {
      const billing = await billingApi.getCurrentPlan();
      this.billingData = {
        tier: billing?.tier || 'BASIC',
        usedBytes: billing?.usedBytes || '0',
        quotaBytes: billing?.quotaBytes || '5368709120',
        usagePercent: billing?.usagePercent || 0,
        usedFormatted: billing?.usedFormatted || '0 B',
        quotaFormatted: billing?.quotaFormatted || '5 GB',
      };
    } catch (error) {
      console.error('Failed to load billing data:', error);
      this.billingData = {
        tier: 'BASIC',
        usedBytes: '0',
        quotaBytes: '5368709120',
        usagePercent: 0,
        usedFormatted: '0 B',
        quotaFormatted: '5 GB',
      };
    }
    this.renderBillingSection();
  }

  protected onMount(): void {
    super.onMount();
    this.renderAccountSection();
    this.renderBillingSection();
    this.renderEditorSection();
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

  private renderBillingSection(): void {
    const container = this.$('.billing-card') as HTMLElement;
    if (!container) return;

    // Clear existing content
    container.innerHTML = '';

    const data = this.billingData;
    const tierLabel = this.getTierLabel(data?.tier || 'BASIC');
    const usagePercent = data?.usagePercent || 0;
    const usedFormatted = data?.usedFormatted || '0 B';
    const quotaFormatted = data?.quotaFormatted || '5 GB';

    const content = document.createElement('div');
    content.className = 'billing-content';
    content.innerHTML = `
      <div class="billing-overview">
        <div class="billing-plan">
          <div class="plan-info">
            <span class="plan-label">Current Plan</span>
            <span class="plan-name">${tierLabel}</span>
          </div>
          <div class="plan-action"></div>
        </div>

        <div class="storage-usage">
          <div class="usage-header">
            <span class="usage-label">Storage Usage</span>
            <span class="usage-value">${usedFormatted} / ${quotaFormatted}</span>
          </div>
          <div class="usage-bar">
            <div class="usage-fill" style="width: ${Math.min(usagePercent, 100)}%"></div>
          </div>
          <span class="usage-percent">${usagePercent.toFixed(1)}% used</span>
        </div>
      </div>

      <div class="billing-actions">
        <div class="view-pricing-btn"></div>
      </div>
    `;

    // Create upgrade/manage button
    const planAction = content.querySelector('.plan-action') as HTMLElement;
    if (planAction) {
      const btn = new Button('Manage Plan', {
        variant: 'secondary',
        size: 'sm',
        onClick: () => router.navigate('/pricing'),
      });
      btn.mount(planAction);
      this.buttons.push(btn);
    }

    // Create view pricing button
    const viewPricingBtn = content.querySelector('.view-pricing-btn') as HTMLElement;
    if (viewPricingBtn) {
      const btn = new Button('View All Plans & Pricing', {
        variant: 'ghost',
        onClick: () => router.navigate('/pricing'),
      });
      btn.mount(viewPricingBtn);
      this.buttons.push(btn);
    }

    const card = new Card();
    const body = card.body();
    body.getElement().appendChild(content);
    card.mount(container);
    this.cards.push(card);
  }

  private getTierLabel(tier: string): string {
    const labels: Record<string, string> = {
      FREE: 'Free',
      BASIC: 'Basic',
      PRO: 'Pro',
      ENTERPRISE: 'Enterprise',
    };
    return labels[tier] || tier;
  }

  private renderEditorSection(): void {
    const container = this.$('.editor-card') as HTMLElement;
    if (!container) return;

    const settings = editorSettingsStore.getSettings();

    const content = document.createElement('div');
    content.className = 'editor-content';
    content.innerHTML = `
      <div class="editor-setting-item">
        <div class="setting-info">
          <span class="setting-name">Format on Save</span>
          <span class="setting-description">Automatically format code when saving files</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="format-on-save" ${settings.formatOnSave ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="editor-setting-item">
        <div class="setting-info">
          <span class="setting-name">Tab Size</span>
          <span class="setting-description">Number of spaces for indentation</span>
        </div>
        <select id="tab-size" class="setting-select">
          <option value="2" ${settings.tabSize === 2 ? 'selected' : ''}>2 spaces</option>
          <option value="4" ${settings.tabSize === 4 ? 'selected' : ''}>4 spaces</option>
          <option value="8" ${settings.tabSize === 8 ? 'selected' : ''}>8 spaces</option>
        </select>
      </div>
      <div class="editor-setting-item">
        <div class="setting-info">
          <span class="setting-name">Indent with Tabs</span>
          <span class="setting-description">Use tabs instead of spaces for indentation</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="use-tabs" ${settings.useTabs ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="editor-shortcuts">
        <span class="shortcuts-label">Keyboard Shortcuts:</span>
        <div class="shortcut-item">
          <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd> - Format document
        </div>
        <div class="shortcut-item">
          <kbd>${navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}</kbd> + <kbd>S</kbd> - Save file
        </div>
      </div>
    `;

    // Add event listeners
    const formatOnSaveCheckbox = content.querySelector('#format-on-save') as HTMLInputElement;
    if (formatOnSaveCheckbox) {
      formatOnSaveCheckbox.addEventListener('change', () => {
        editorSettingsStore.setFormatOnSave(formatOnSaveCheckbox.checked);
        toast.success('Editor settings saved');
      });
    }

    const tabSizeSelect = content.querySelector('#tab-size') as HTMLSelectElement;
    if (tabSizeSelect) {
      tabSizeSelect.addEventListener('change', () => {
        editorSettingsStore.setTabSize(parseInt(tabSizeSelect.value, 10));
        toast.success('Editor settings saved');
      });
    }

    const useTabsCheckbox = content.querySelector('#use-tabs') as HTMLInputElement;
    if (useTabsCheckbox) {
      useTabsCheckbox.addEventListener('change', () => {
        editorSettingsStore.setUseTabs(useTabsCheckbox.checked);
        toast.success('Editor settings saved');
      });
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
    const isCodexConnected = !!user?.codexAuth?.apiKey;
    const isGeminiConnected = !!user?.geminiAuth?.accessToken;

    const content = document.createElement('div');
    content.className = 'connections-content';
    content.innerHTML = `
      <div class="connection-item">
        <div class="connection-info">
          <span class="connection-name">GitHub</span>
          <span class="connection-description">Required for repository operations</span>
          <span class="connection-status ${isGitHubConnected ? 'connected' : 'disconnected'}">
            ${isGitHubConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div class="connection-action github-action"></div>
      </div>
      <div class="connection-item">
        <div class="connection-info">
          <span class="connection-name">Claude</span>
          <span class="connection-description">AI assistant for chat and code</span>
          <span class="connection-status ${isClaudeConnected ? 'connected' : 'disconnected'}">
            ${isClaudeConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div class="connection-action claude-action"></div>
      </div>
      ${!isClaudeConnected ? `
      <div class="auth-form claude-auth-form">
        <p class="connection-help">Paste your Claude auth JSON to connect:</p>
        <div class="claude-auth-input"></div>
        <div class="claude-auth-submit"></div>
      </div>
      ` : ''}
      <div class="connection-item">
        <div class="connection-info">
          <span class="connection-name">Codex (OpenAI)</span>
          <span class="connection-description">AI functionality via OpenAI API</span>
          <span class="connection-status ${isCodexConnected ? 'connected' : 'disconnected'}">
            ${isCodexConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div class="connection-action codex-action"></div>
      </div>
      ${!isCodexConnected ? `
      <div class="auth-form codex-auth-form">
        <p class="connection-help">Enter your OpenAI API key:</p>
        <div class="codex-auth-input"></div>
        <div class="codex-auth-submit"></div>
      </div>
      ` : ''}
      <div class="connection-item">
        <div class="connection-info">
          <span class="connection-name">Gemini</span>
          <span class="connection-description">AI functionality via Google Gemini</span>
          <span class="connection-status ${isGeminiConnected ? 'connected' : 'disconnected'}">
            ${isGeminiConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div class="connection-action gemini-action"></div>
      </div>
      ${!isGeminiConnected ? `
      <div class="auth-form gemini-auth-form">
        <p class="connection-help">Paste contents of ~/.gemini/oauth_creds.json (run <code>gemini auth login</code> first):</p>
        <div class="gemini-auth-input"></div>
        <div class="gemini-auth-submit"></div>
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

    // Create Codex connect/disconnect button
    const codexAction = content.querySelector('.codex-action') as HTMLElement;
    if (codexAction) {
      const btn = new Button(isCodexConnected ? 'Disconnect' : 'Add API Key', {
        variant: isCodexConnected ? 'secondary' : 'primary',
        onClick: () => this.handleCodexAction(isCodexConnected),
      });
      btn.mount(codexAction);
      this.buttons.push(btn);
    }

    // Create Codex auth input and submit button if not connected
    if (!isCodexConnected) {
      const codexAuthInputContainer = content.querySelector('.codex-auth-input') as HTMLElement;
      if (codexAuthInputContainer) {
        this.codexAuthInput = new Input({
          type: 'password',
          placeholder: 'sk-...',
        });
        this.codexAuthInput.mount(codexAuthInputContainer);
      }

      const codexAuthSubmit = content.querySelector('.codex-auth-submit') as HTMLElement;
      if (codexAuthSubmit) {
        const submitBtn = new Button('Save Codex API Key', {
          variant: 'primary',
          onClick: () => this.handleCodexAuthSubmit(),
        });
        submitBtn.mount(codexAuthSubmit);
        this.buttons.push(submitBtn);
      }
    }

    // Create Gemini connect/disconnect button
    const geminiAction = content.querySelector('.gemini-action') as HTMLElement;
    if (geminiAction) {
      const btn = new Button(isGeminiConnected ? 'Disconnect' : 'Add Auth', {
        variant: isGeminiConnected ? 'secondary' : 'primary',
        onClick: () => this.handleGeminiAction(isGeminiConnected),
      });
      btn.mount(geminiAction);
      this.buttons.push(btn);
    }

    // Create Gemini auth input and submit button if not connected
    if (!isGeminiConnected) {
      const geminiAuthInputContainer = content.querySelector('.gemini-auth-input') as HTMLElement;
      if (geminiAuthInputContainer) {
        this.geminiAuthInput = new Input({
          type: 'text',
          placeholder: '{"access_token":"...","refresh_token":"...","expiry_date":...}',
        });
        this.geminiAuthInput.mount(geminiAuthInputContainer);
      }

      const geminiAuthSubmit = content.querySelector('.gemini-auth-submit') as HTMLElement;
      if (geminiAuthSubmit) {
        const submitBtn = new Button('Save Gemini Auth', {
          variant: 'primary',
          onClick: () => this.handleGeminiAuthSubmit(),
        });
        submitBtn.mount(geminiAuthSubmit);
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

  private async handleCodexAction(isConnected: boolean): Promise<void> {
    if (isConnected) {
      try {
        await userApi.removeCodexAuth();
        authStore.updateUser({ codexAuth: undefined });
        toast.success('Codex disconnected');
        this.update({});
      } catch (error) {
        toast.error('Failed to disconnect Codex');
      }
    }
    // If not connected, the form is already shown
  }

  private async handleCodexAuthSubmit(): Promise<void> {
    const apiKey = this.codexAuthInput?.getValue() || '';
    if (!apiKey.trim()) {
      toast.error('Please enter your OpenAI API key');
      return;
    }

    try {
      await userApi.updateCodexAuth({ apiKey });

      // Update local user state
      authStore.updateUser({ codexAuth: { apiKey } as CodexAuth });
      toast.success('Codex API key saved');
      this.update({});
    } catch (error) {
      toast.error('Failed to save Codex API key');
    }
  }

  private async handleGeminiAction(isConnected: boolean): Promise<void> {
    if (isConnected) {
      try {
        await userApi.removeGeminiAuth();
        authStore.updateUser({ geminiAuth: undefined });
        toast.success('Gemini disconnected');
        this.update({});
      } catch (error) {
        toast.error('Failed to disconnect Gemini');
      }
    }
    // If not connected, the form is already shown
  }

  private async handleGeminiAuthSubmit(): Promise<void> {
    const authJson = this.geminiAuthInput?.getValue() || '';
    if (!authJson.trim()) {
      toast.error('Please paste your Gemini auth JSON');
      return;
    }

    try {
      const parsed = JSON.parse(authJson);
      await userApi.updateGeminiAuth(parsed);

      // Update local user state
      authStore.updateUser({ geminiAuth: parsed as GeminiAuth });
      toast.success('Gemini authentication saved');
      this.update({});
    } catch (error) {
      if (error instanceof SyntaxError) {
        toast.error('Invalid JSON format');
      } else {
        toast.error('Failed to save Gemini authentication');
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
    this.codexAuthInput?.unmount();
    this.geminiAuthInput?.unmount();
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

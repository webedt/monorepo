/**
 * LintingPanel Component
 * Displays lint errors, warnings, and info messages in a collapsible panel
 */

import { Component } from '../base';
import './linting-panel.css';

import type { LintResult, LintDiagnostic, LintSeverity } from '../../lib/linting';

export interface LintingPanelOptions {
  onDiagnosticClick?: (diagnostic: LintDiagnostic) => void;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  maxHeight?: number;
}

const SEVERITY_ICONS: Record<LintSeverity, string> = {
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
};

export class LintingPanel extends Component<HTMLDivElement> {
  private options: LintingPanelOptions;
  private result: LintResult | null = null;
  private collapsed = false;

  constructor(options: LintingPanelOptions = {}) {
    super('div', { className: 'linting-panel' });
    this.options = {
      collapsible: true,
      defaultCollapsed: false,
      maxHeight: 200,
      ...options,
    };
    this.collapsed = this.options.defaultCollapsed || false;
    this.render();
  }

  /**
   * Update the panel with new lint results
   */
  update(result: LintResult, _filename?: string): this {
    this.result = result;
    this.render();
    return this;
  }

  /**
   * Clear the panel
   */
  clear(): this {
    this.result = null;
    this.render();
    return this;
  }

  /**
   * Toggle collapsed state
   */
  toggle(): this {
    this.collapsed = !this.collapsed;
    this.render();
    return this;
  }

  /**
   * Set collapsed state
   */
  setCollapsed(collapsed: boolean): this {
    this.collapsed = collapsed;
    this.render();
    return this;
  }

  /**
   * Check if panel has any diagnostics
   */
  hasDiagnostics(): boolean {
    return this.result !== null && this.result.diagnostics.length > 0;
  }

  /**
   * Get total diagnostic count
   */
  getTotalCount(): number {
    return this.result?.diagnostics.length || 0;
  }

  render(): this {
    const { result, collapsed } = this;

    // If no results or no diagnostics, hide the panel
    if (!result || result.diagnostics.length === 0) {
      this.addClass('linting-panel--empty');
      this.element.innerHTML = '';
      return this;
    }

    this.removeClass('linting-panel--empty');

    const hasErrors = result.errorCount > 0;
    const hasWarnings = result.warningCount > 0;

    // Determine panel state class
    this.removeClass('linting-panel--error', 'linting-panel--warning', 'linting-panel--info');
    if (hasErrors) {
      this.addClass('linting-panel--error');
    } else if (hasWarnings) {
      this.addClass('linting-panel--warning');
    } else {
      this.addClass('linting-panel--info');
    }

    this.toggleClass('linting-panel--collapsed', collapsed);

    // Build header
    const summaryParts: string[] = [];
    if (result.errorCount > 0) {
      summaryParts.push(`<span class="lint-count lint-count--error">${result.errorCount} error${result.errorCount !== 1 ? 's' : ''}</span>`);
    }
    if (result.warningCount > 0) {
      summaryParts.push(`<span class="lint-count lint-count--warning">${result.warningCount} warning${result.warningCount !== 1 ? 's' : ''}</span>`);
    }
    if (result.infoCount > 0) {
      summaryParts.push(`<span class="lint-count lint-count--info">${result.infoCount} info</span>`);
    }

    const headerIcon = hasErrors ? SEVERITY_ICONS.error : (hasWarnings ? SEVERITY_ICONS.warning : SEVERITY_ICONS.info);

    this.element.innerHTML = `
      <div class="linting-panel-header" data-action="toggle">
        <div class="linting-panel-header-left">
          <span class="linting-panel-icon">${headerIcon}</span>
          <span class="linting-panel-title">Problems</span>
          <span class="linting-panel-summary">${summaryParts.join(' ')}</span>
        </div>
        <div class="linting-panel-header-right">
          ${this.options.collapsible ? `
            <button class="linting-panel-toggle" data-action="toggle" aria-label="${collapsed ? 'Expand' : 'Collapse'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="${collapsed ? '6 9 12 15 18 9' : '18 15 12 9 6 15'}"></polyline>
              </svg>
            </button>
          ` : ''}
        </div>
      </div>
      ${!collapsed ? `
        <div class="linting-panel-content" style="max-height: ${this.options.maxHeight}px">
          <div class="linting-panel-list">
            ${result.diagnostics.map((d, i) => this.renderDiagnostic(d, i)).join('')}
          </div>
        </div>
      ` : ''}
    `;

    // Add event listeners
    this.setupEventListeners();

    return this;
  }

  private renderDiagnostic(diagnostic: LintDiagnostic, index: number): string {
    const icon = SEVERITY_ICONS[diagnostic.severity];
    const location = `${diagnostic.line}:${diagnostic.column}`;
    const rule = diagnostic.rule ? `<span class="lint-item-rule">${diagnostic.rule}</span>` : '';

    return `
      <div class="lint-item lint-item--${diagnostic.severity}" data-index="${index}" data-action="goto">
        <span class="lint-item-icon">${icon}</span>
        <span class="lint-item-location">${location}</span>
        <span class="lint-item-message">${this.escapeHtml(diagnostic.message)}</span>
        ${rule}
      </div>
    `;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private setupEventListeners(): void {
    // Toggle button
    const toggleElements = this.element.querySelectorAll('[data-action="toggle"]');
    toggleElements.forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
    });

    // Diagnostic items
    const items = this.element.querySelectorAll('[data-action="goto"]');
    items.forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt((item as HTMLElement).dataset.index || '0', 10);
        const diagnostic = this.result?.diagnostics[index];
        if (diagnostic && this.options.onDiagnosticClick) {
          this.options.onDiagnosticClick(diagnostic);
        }
      });
    });
  }
}

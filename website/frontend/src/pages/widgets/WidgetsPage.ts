/**
 * Widgets Page
 * Demonstrates and showcases the customizable widget system
 */

import { Page, type PageOptions } from '../base/Page';
import { Button } from '../../components';
import { WidgetContainer, WidgetCustomizer } from '../../components/widget';
import { widgetStore } from '../../stores/widgetStore';
import './widgets.css';

export class WidgetsPage extends Page<PageOptions> {
  readonly route = '/widgets';
  readonly title = 'Widgets';
  protected requiresAuth = true;

  private widgetContainer: WidgetContainer | null = null;
  private customizer: WidgetCustomizer | null = null;
  private buttons: Button[] = [];
  private unsubscribe: (() => void) | null = null;

  protected render(): string {
    const { isCustomizing } = widgetStore.getState();

    return `
      <div class="widgets-page">
        <header class="widgets-header">
          <div class="widgets-header-content">
            <div class="widgets-header-text">
              <h1 class="widgets-title">Customizable Widgets</h1>
              <p class="widgets-subtitle">Personalize your dashboard with drag-and-drop widgets</p>
            </div>
            <div class="widgets-header-actions">
              <div class="customize-btn-container"></div>
              <div class="add-widget-btn-container"></div>
            </div>
          </div>
        </header>

        <div class="widgets-content">
          <div class="widget-container-wrapper"></div>
        </div>

        ${isCustomizing ? `
        <div class="widgets-customize-bar">
          <span class="customize-bar-text">Drag widgets to reorder. Click the menu on each widget to resize or remove.</span>
          <div class="done-btn-container"></div>
        </div>
        ` : ''}
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    this.renderWidgetContainer();
    this.renderHeaderActions();
    this.renderCustomizeBar();

    // Subscribe to customization mode changes
    this.unsubscribe = widgetStore.subscribe((state) => {
      const { isCustomizing } = state;

      // Update container mode
      if (isCustomizing) {
        this.widgetContainer?.enterCustomizationMode();
      } else {
        this.widgetContainer?.exitCustomizationMode();
      }

      // Re-render to show/hide customize bar
      this.update({});
    });
  }

  private renderWidgetContainer(): void {
    const wrapper = this.$('.widget-container-wrapper') as HTMLElement;
    if (!wrapper) return;

    this.widgetContainer = new WidgetContainer();

    this.widgetContainer.mount(wrapper);

    // Apply current customization mode
    if (widgetStore.getState().isCustomizing) {
      this.widgetContainer.enterCustomizationMode();
    }
  }

  private renderHeaderActions(): void {
    const customizeContainer = this.$('.customize-btn-container') as HTMLElement;
    const addWidgetContainer = this.$('.add-widget-btn-container') as HTMLElement;

    if (customizeContainer) {
      const { isCustomizing } = widgetStore.getState();
      const customizeBtn = new Button(isCustomizing ? 'Done' : 'Customize', {
        variant: isCustomizing ? 'primary' : 'secondary',
        onClick: () => {
          if (widgetStore.getState().isCustomizing) {
            widgetStore.stopCustomizing();
          } else {
            widgetStore.startCustomizing();
          }
        },
      });
      customizeBtn.mount(customizeContainer);
      this.buttons.push(customizeBtn);
    }

    if (addWidgetContainer) {
      const addBtn = new Button('Add Widget', {
        variant: 'primary',
        onClick: () => this.openWidgetCustomizer(),
      });
      addBtn.mount(addWidgetContainer);
      this.buttons.push(addBtn);
    }
  }

  private renderCustomizeBar(): void {
    const doneContainer = this.$('.done-btn-container') as HTMLElement;
    if (!doneContainer) return;

    const doneBtn = new Button('Done', {
      variant: 'primary',
      onClick: () => widgetStore.stopCustomizing(),
    });
    doneBtn.mount(doneContainer);
    this.buttons.push(doneBtn);
  }

  private openWidgetCustomizer(): void {
    this.customizer = new WidgetCustomizer({
      onClose: () => {
        this.customizer = null;
      },
    });
    this.customizer.openModal();
  }

  protected onUnmount(): void {
    this.unsubscribe?.();
    this.widgetContainer?.unmount();
    this.customizer?.close();

    for (const btn of this.buttons) {
      btn.unmount();
    }

    this.widgetContainer = null;
    this.customizer = null;
    this.buttons = [];
  }
}

/**
 * Tests for Modal Component
 * Covers modal creation, open/close behavior, accessibility, and events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Modal, confirm } from '../../src/components/modal/Modal';

describe('Modal Component', () => {
  beforeEach(() => {
    // Reset body overflow before each test
    document.body.style.overflow = '';
  });

  afterEach(() => {
    // Clean up any modals
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.style.overflow = '';
  });

  describe('Creation', () => {
    it('should create a modal backdrop element', () => {
      const modal = new Modal();
      const element = modal.getElement();

      expect(element.classList.contains('modal-backdrop')).toBe(true);
    });

    it('should have correct accessibility attributes', () => {
      const modal = new Modal();
      const element = modal.getElement();

      expect(element.getAttribute('role')).toBe('dialog');
      expect(element.getAttribute('aria-modal')).toBe('true');
      expect(element.getAttribute('aria-hidden')).toBe('true');
    });

    it('should create modal with default size md', () => {
      const modal = new Modal();
      const modalEl = modal.getElement().querySelector('.modal');

      expect(modalEl?.classList.contains('modal--md')).toBe(true);
    });

    it('should create modal with custom size', () => {
      const modal = new Modal({ size: 'lg' });
      const modalEl = modal.getElement().querySelector('.modal');

      expect(modalEl?.classList.contains('modal--lg')).toBe(true);
    });

    it('should create full size modal', () => {
      const modal = new Modal({ size: 'full' });
      const modalEl = modal.getElement().querySelector('.modal');

      expect(modalEl?.classList.contains('modal--full')).toBe(true);
    });
  });

  describe('Title', () => {
    it('should create modal with title', () => {
      const modal = new Modal({ title: 'Test Modal' });
      const element = modal.getElement();

      const title = element.querySelector('.modal-title');
      expect(title?.textContent).toBe('Test Modal');
    });

    it('should update title dynamically', () => {
      const modal = new Modal({ title: 'Original' });

      modal.setTitle('Updated Title');

      const title = modal.getElement().querySelector('.modal-title');
      expect(title?.textContent).toBe('Updated Title');
    });

    it('should create header when title is provided', () => {
      const modal = new Modal({ title: 'Test' });
      const element = modal.getElement();

      expect(element.querySelector('.modal-header')).not.toBeNull();
    });
  });

  describe('Close Button', () => {
    it('should show close button by default', () => {
      const modal = new Modal({ title: 'Test' });
      const element = modal.getElement();

      const closeBtn = element.querySelector('.modal-close');
      expect(closeBtn).not.toBeNull();
      expect(closeBtn?.getAttribute('aria-label')).toBe('Close modal');
    });

    it('should hide close button when showClose is false', () => {
      const modal = new Modal({ showClose: false });
      const element = modal.getElement();

      expect(element.querySelector('.modal-close')).toBeNull();
    });

    it('should close modal when close button clicked', () => {
      const modal = new Modal({ title: 'Test' });
      modal.open();

      const closeBtn = modal.getElement().querySelector<HTMLButtonElement>('.modal-close');
      closeBtn?.click();

      expect(modal.getIsOpen()).toBe(false);
    });
  });

  describe('Body', () => {
    it('should have a body element', () => {
      const modal = new Modal();
      const body = modal.getBody();

      expect(body).not.toBeNull();
      expect(body.classList.contains('modal-body')).toBe(true);
    });

    it('should set body content as string', () => {
      const modal = new Modal();

      modal.setBody('<p>Content</p>');

      expect(modal.getBody().innerHTML).toBe('<p>Content</p>');
    });

    it('should set body content as HTMLElement', () => {
      const modal = new Modal();
      const div = document.createElement('div');
      div.textContent = 'Element content';

      modal.setBody(div);

      expect(modal.getBody().firstChild).toBe(div);
    });
  });

  describe('Footer', () => {
    it('should create footer element', () => {
      const modal = new Modal();
      const footer = modal.footer();

      expect(footer.classList.contains('modal-footer')).toBe(true);
    });

    it('should reuse existing footer', () => {
      const modal = new Modal();
      const footer1 = modal.footer();
      const footer2 = modal.footer();

      expect(footer1).toBe(footer2);
    });

    it('should accept align option', () => {
      const modal = new Modal();
      const footer = modal.footer({ align: 'start' });

      expect(footer.classList.contains('modal-footer--start')).toBe(true);
    });
  });

  describe('Open/Close', () => {
    it('should open modal', () => {
      const modal = new Modal();

      modal.open();

      expect(modal.getIsOpen()).toBe(true);
      expect(modal.getElement().classList.contains('modal-backdrop--open')).toBe(true);
      expect(modal.getElement().getAttribute('aria-hidden')).toBe('false');
    });

    it('should close modal', () => {
      const modal = new Modal();
      modal.open();

      modal.close();

      expect(modal.getIsOpen()).toBe(false);
      expect(modal.getElement().classList.contains('modal-backdrop--open')).toBe(false);
      expect(modal.getElement().getAttribute('aria-hidden')).toBe('true');
    });

    it('should toggle modal', () => {
      const modal = new Modal();

      modal.toggle();
      expect(modal.getIsOpen()).toBe(true);

      modal.toggle();
      expect(modal.getIsOpen()).toBe(false);
    });

    it('should prevent body scroll when open', () => {
      const modal = new Modal();

      modal.open();

      expect(document.body.style.overflow).toBe('hidden');

      modal.close();
      expect(document.body.style.overflow).toBe('');
    });

    it('should not re-open if already open', () => {
      const onOpen = vi.fn();
      const modal = new Modal({ onOpen });

      modal.open();
      modal.open();

      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('should not re-close if already closed', () => {
      const onClose = vi.fn();
      const modal = new Modal({ onClose });

      modal.close();

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Event Handlers', () => {
    it('should call onOpen callback', () => {
      const onOpen = vi.fn();
      const modal = new Modal({ onOpen });

      modal.open();

      expect(onOpen).toHaveBeenCalled();
    });

    it('should call onClose callback', () => {
      const onClose = vi.fn();
      const modal = new Modal({ onClose });
      modal.open();

      modal.close();

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Close on Backdrop', () => {
    it('should close on backdrop click by default', () => {
      const modal = new Modal();
      modal.open();

      // Simulate click on backdrop (not modal)
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: modal.getElement() });
      modal.getElement().dispatchEvent(event);

      expect(modal.getIsOpen()).toBe(false);
    });

    it('should not close on modal content click', () => {
      const modal = new Modal();
      modal.open();

      const modalContent = modal.getElement().querySelector('.modal');
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: modalContent });
      modal.getElement().dispatchEvent(event);

      expect(modal.getIsOpen()).toBe(true);
    });

    it('should not close on backdrop when closeOnBackdrop is false', () => {
      const modal = new Modal({ closeOnBackdrop: false });
      modal.open();

      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: modal.getElement() });
      modal.getElement().dispatchEvent(event);

      expect(modal.getIsOpen()).toBe(true);
    });
  });

  describe('Close on Escape', () => {
    it('should close on Escape key by default', () => {
      const modal = new Modal();
      modal.open();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(modal.getIsOpen()).toBe(false);
    });

    it('should not close on Escape when closeOnEscape is false', () => {
      const modal = new Modal({ closeOnEscape: false });
      modal.open();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(modal.getIsOpen()).toBe(true);
    });

    it('should not close on other keys', () => {
      const modal = new Modal();
      modal.open();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(modal.getIsOpen()).toBe(true);
    });
  });

  describe('Method Chaining', () => {
    it('should support method chaining', () => {
      const modal = new Modal({ title: 'Test' });

      const result = modal
        .setTitle('New Title')
        .setBody('Content')
        .open()
        .close();

      expect(result).toBe(modal);
    });
  });
});

describe('Confirm Dialog', () => {
  afterEach(() => {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.style.overflow = '';
  });

  it('should create a confirm dialog with message', async () => {
    const promise = confirm({ message: 'Are you sure?' });

    // Check that modal is created
    const modal = document.querySelector('.modal-backdrop');
    expect(modal).not.toBeNull();

    // Check message
    const body = modal?.querySelector('.modal-body');
    expect(body?.textContent).toBe('Are you sure?');

    // Click cancel to resolve
    const cancelBtn = modal?.querySelector('.btn--secondary') as HTMLButtonElement;
    cancelBtn?.click();

    const result = await promise;
    expect(result).toBe(false);
  });

  it('should resolve true when confirm clicked', async () => {
    const promise = confirm({ message: 'Delete item?' });

    const modal = document.querySelector('.modal-backdrop');
    const confirmBtn = modal?.querySelector('.btn--primary') as HTMLButtonElement;
    confirmBtn?.click();

    const result = await promise;
    expect(result).toBe(true);
  });

  it('should resolve false when cancel clicked', async () => {
    const promise = confirm({ message: 'Delete item?' });

    const modal = document.querySelector('.modal-backdrop');
    const cancelBtn = modal?.querySelector('.btn--secondary') as HTMLButtonElement;
    cancelBtn?.click();

    const result = await promise;
    expect(result).toBe(false);
  });

  it('should use custom button text', async () => {
    const promise = confirm({
      message: 'Test',
      confirmText: 'Yes, do it',
      cancelText: 'No, cancel',
    });

    const modal = document.querySelector('.modal-backdrop');
    const confirmBtn = modal?.querySelector('.btn--primary');
    const cancelBtn = modal?.querySelector('.btn--secondary');

    expect(confirmBtn?.textContent).toBe('Yes, do it');
    expect(cancelBtn?.textContent).toBe('No, cancel');

    (cancelBtn as HTMLButtonElement)?.click();
    await promise;
  });

  it('should use danger variant for confirm button when danger option is true', async () => {
    const promise = confirm({
      message: 'Delete permanently?',
      danger: true,
    });

    const modal = document.querySelector('.modal-backdrop');
    const confirmBtn = modal?.querySelector('.btn--danger');

    expect(confirmBtn).not.toBeNull();

    (confirmBtn as HTMLButtonElement)?.click();
    await promise;
  });
});

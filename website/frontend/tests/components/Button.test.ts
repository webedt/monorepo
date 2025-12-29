/**
 * Tests for Button Component
 * Covers button creation, variants, states, and interactions.
 */

import { describe, it, expect, vi } from 'vitest';
import { Button } from '../../src/components/button/Button';

describe('Button Component', () => {
  describe('Creation', () => {
    it('should create a button element with text', () => {
      const button = new Button('Click me');
      const element = button.getElement();

      expect(element.tagName).toBe('BUTTON');
      expect(element.textContent).toBe('Click me');
    });

    it('should have default type of button', () => {
      const button = new Button('Test');
      const element = button.getElement();

      expect(element.type).toBe('button');
    });

    it('should accept submit type', () => {
      const button = new Button('Submit', { type: 'submit' });
      const element = button.getElement();

      expect(element.type).toBe('submit');
    });

    it('should have base btn class', () => {
      const button = new Button('Test');
      const element = button.getElement();

      expect(element.classList.contains('btn')).toBe(true);
    });
  });

  describe('Variants', () => {
    it('should apply primary variant by default', () => {
      const button = new Button('Test');
      const element = button.getElement();

      expect(element.classList.contains('btn--primary')).toBe(true);
    });

    it('should apply secondary variant', () => {
      const button = new Button('Test', { variant: 'secondary' });
      const element = button.getElement();

      expect(element.classList.contains('btn--secondary')).toBe(true);
    });

    it('should apply ghost variant', () => {
      const button = new Button('Test', { variant: 'ghost' });
      const element = button.getElement();

      expect(element.classList.contains('btn--ghost')).toBe(true);
    });

    it('should apply danger variant', () => {
      const button = new Button('Test', { variant: 'danger' });
      const element = button.getElement();

      expect(element.classList.contains('btn--danger')).toBe(true);
    });

    it('should apply success variant', () => {
      const button = new Button('Test', { variant: 'success' });
      const element = button.getElement();

      expect(element.classList.contains('btn--success')).toBe(true);
    });

    it('should change variant dynamically', () => {
      const button = new Button('Test', { variant: 'primary' });
      button.setVariant('danger');
      const element = button.getElement();

      expect(element.classList.contains('btn--danger')).toBe(true);
      expect(element.classList.contains('btn--primary')).toBe(false);
    });
  });

  describe('Sizes', () => {
    it('should not add size class for default md size', () => {
      const button = new Button('Test', { size: 'md' });
      const element = button.getElement();

      expect(element.classList.contains('btn--md')).toBe(false);
    });

    it('should apply sm size class', () => {
      const button = new Button('Test', { size: 'sm' });
      const element = button.getElement();

      expect(element.classList.contains('btn--sm')).toBe(true);
    });

    it('should apply lg size class', () => {
      const button = new Button('Test', { size: 'lg' });
      const element = button.getElement();

      expect(element.classList.contains('btn--lg')).toBe(true);
    });
  });

  describe('States', () => {
    describe('Disabled', () => {
      it('should set disabled state on creation', () => {
        const button = new Button('Test', { disabled: true });
        const element = button.getElement();

        expect(element.disabled).toBe(true);
        expect(element.getAttribute('aria-disabled')).toBe('true');
      });

      it('should toggle disabled state', () => {
        const button = new Button('Test');

        button.setDisabled(true);
        expect(button.getElement().disabled).toBe(true);
        expect(button.isDisabled()).toBe(true);

        button.setDisabled(false);
        expect(button.getElement().disabled).toBe(false);
        expect(button.isDisabled()).toBe(false);
      });
    });

    describe('Loading', () => {
      it('should set loading state on creation', () => {
        const button = new Button('Test', { loading: true });
        const element = button.getElement();

        expect(element.classList.contains('btn--loading')).toBe(true);
        expect(element.disabled).toBe(true);
      });

      it('should toggle loading state', () => {
        const button = new Button('Test');

        button.setLoading(true);
        expect(button.isLoading()).toBe(true);
        expect(button.getElement().classList.contains('btn--loading')).toBe(true);

        button.setLoading(false);
        expect(button.isLoading()).toBe(false);
        expect(button.getElement().classList.contains('btn--loading')).toBe(false);
      });

      it('should disable button when loading', () => {
        const button = new Button('Test');

        button.setLoading(true);
        expect(button.getElement().disabled).toBe(true);
      });
    });
  });

  describe('Modifiers', () => {
    it('should apply icon modifier', () => {
      const button = new Button('🔍', { icon: true });
      const element = button.getElement();

      expect(element.classList.contains('btn--icon')).toBe(true);
    });

    it('should apply fullWidth modifier', () => {
      const button = new Button('Full Width', { fullWidth: true });
      const element = button.getElement();

      expect(element.classList.contains('btn--full')).toBe(true);
    });
  });

  describe('Label', () => {
    it('should update label text', () => {
      const button = new Button('Original');
      button.setLabel('Updated');

      expect(button.getElement().textContent).toBe('Updated');
    });
  });

  describe('Click Handler', () => {
    it('should call onClick handler when clicked', () => {
      const handler = vi.fn();
      const button = new Button('Test', { onClick: handler });

      button.getElement().click();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should attach onClick handler dynamically', () => {
      const handler = vi.fn();
      const button = new Button('Test');

      button.onClick(handler);
      button.getElement().click();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should programmatically click the button', () => {
      const handler = vi.fn();
      const button = new Button('Test', { onClick: handler });

      button.click();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not call handler when disabled', () => {
      const handler = vi.fn();
      const button = new Button('Test', { onClick: handler, disabled: true });

      button.getElement().click();

      // Native browser behavior prevents click on disabled buttons
      expect(handler).toHaveBeenCalledTimes(0);
    });
  });

  describe('Method Chaining', () => {
    it('should support method chaining', () => {
      const button = new Button('Test');

      const result = button
        .setDisabled(true)
        .setLoading(false)
        .setLabel('Updated')
        .setVariant('danger');

      expect(result).toBe(button);
    });
  });
});

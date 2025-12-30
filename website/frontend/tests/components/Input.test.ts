/**
 * Tests for Input Component
 * Covers input creation, validation, events, and states.
 */

import { describe, it, expect, vi } from 'vitest';
import { Input, TextArea } from '../../src/components/input/Input';

describe('Input Component', () => {
  describe('Creation', () => {
    it('should create an input wrapper with input element', () => {
      const input = new Input();
      const element = input.getElement();

      expect(element.tagName).toBe('DIV');
      expect(element.classList.contains('input-wrapper')).toBe(true);
      expect(input.getInputElement().tagName).toBe('INPUT');
    });

    it('should have text type by default', () => {
      const input = new Input();

      expect(input.getInputElement().type).toBe('text');
    });

    it('should accept custom input types', () => {
      const emailInput = new Input({ type: 'email' });
      const passwordInput = new Input({ type: 'password' });
      const numberInput = new Input({ type: 'number' });

      expect(emailInput.getInputElement().type).toBe('email');
      expect(passwordInput.getInputElement().type).toBe('password');
      expect(numberInput.getInputElement().type).toBe('number');
    });
  });

  describe('Value', () => {
    it('should set initial value', () => {
      const input = new Input({ value: 'initial' });

      expect(input.getValue()).toBe('initial');
    });

    it('should get and set value', () => {
      const input = new Input();

      input.setValue('test value');

      expect(input.getValue()).toBe('test value');
    });

    it('should clear value', () => {
      const input = new Input({ value: 'some value' });

      input.clear();

      expect(input.getValue()).toBe('');
    });
  });

  describe('Label', () => {
    it('should create label element when provided', () => {
      const input = new Input({ label: 'Email Address' });
      const element = input.getElement();

      const label = element.querySelector('label');
      expect(label).not.toBeNull();
      expect(label?.textContent).toBe('Email Address');
    });

    it('should link label to input with for attribute', () => {
      const input = new Input({ label: 'Test Label', id: 'test-input' });
      const element = input.getElement();

      const label = element.querySelector('label');
      const inputEl = input.getInputElement();

      expect(label?.htmlFor).toBe('test-input');
      expect(inputEl.id).toBe('test-input');
    });

    it('should add required indicator to label when required', () => {
      const input = new Input({ label: 'Required Field', required: true });
      const element = input.getElement();

      const label = element.querySelector('label');
      expect(label?.classList.contains('input-label--required')).toBe(true);
    });
  });

  describe('Helper Text', () => {
    it('should create helper text element when provided', () => {
      const input = new Input({ helper: 'Enter your email' });
      const element = input.getElement();

      const helper = element.querySelector('.input-helper');
      expect(helper).not.toBeNull();
      expect(helper?.textContent).toBe('Enter your email');
    });
  });

  describe('Error Handling', () => {
    it('should set error message on creation', () => {
      const input = new Input({ error: 'Invalid input' });
      const element = input.getElement();

      const errorEl = element.querySelector('.input-error');
      expect(errorEl).not.toBeNull();
      expect(errorEl?.textContent).toBe('Invalid input');
      expect(input.getInputElement().classList.contains('input--error')).toBe(true);
    });

    it('should set error message dynamically', () => {
      const input = new Input();

      input.setError('Validation failed');
      const element = input.getElement();

      const errorEl = element.querySelector('.input-error');
      expect(errorEl?.textContent).toBe('Validation failed');
    });

    it('should clear error message', () => {
      const input = new Input({ error: 'Error' });

      input.clearError();
      const element = input.getElement();

      const errorEl = element.querySelector('.input-error');
      expect(errorEl).toBeNull();
      expect(input.getInputElement().classList.contains('input--error')).toBe(false);
    });

    it('should replace existing error when setting new one', () => {
      const input = new Input({ error: 'First error' });

      input.setError('Second error');
      const element = input.getElement();

      const errors = element.querySelectorAll('.input-error');
      expect(errors.length).toBe(1);
      expect(errors[0].textContent).toBe('Second error');
    });
  });

  describe('States', () => {
    describe('Disabled', () => {
      it('should set disabled state on creation', () => {
        const input = new Input({ disabled: true });

        expect(input.getInputElement().disabled).toBe(true);
        expect(input.isDisabled()).toBe(true);
      });

      it('should toggle disabled state', () => {
        const input = new Input();

        input.setDisabled(true);
        expect(input.isDisabled()).toBe(true);

        input.setDisabled(false);
        expect(input.isDisabled()).toBe(false);
      });
    });

    describe('Required', () => {
      it('should set required attribute', () => {
        const input = new Input({ required: true });

        expect(input.getInputElement().required).toBe(true);
      });
    });

    describe('Readonly', () => {
      it('should set readonly attribute', () => {
        const input = new Input({ readonly: true });

        expect(input.getInputElement().readOnly).toBe(true);
      });
    });
  });

  describe('Sizes', () => {
    it('should not add size class for default md size', () => {
      const input = new Input({ size: 'md' });

      expect(input.getInputElement().classList.contains('input--md')).toBe(false);
    });

    it('should apply sm size class', () => {
      const input = new Input({ size: 'sm' });

      expect(input.getInputElement().classList.contains('input--sm')).toBe(true);
    });

    it('should apply lg size class', () => {
      const input = new Input({ size: 'lg' });

      expect(input.getInputElement().classList.contains('input--lg')).toBe(true);
    });
  });

  describe('Attributes', () => {
    it('should set placeholder', () => {
      const input = new Input({ placeholder: 'Enter text...' });

      expect(input.getInputElement().placeholder).toBe('Enter text...');
    });

    it('should set name', () => {
      const input = new Input({ name: 'email' });

      expect(input.getInputElement().name).toBe('email');
    });

    it('should set maxLength', () => {
      const input = new Input({ maxLength: 50 });

      expect(input.getInputElement().maxLength).toBe(50);
    });

    it('should set minLength', () => {
      const input = new Input({ minLength: 5 });

      expect(input.getInputElement().minLength).toBe(5);
    });

    it('should set pattern', () => {
      const input = new Input({ pattern: '[A-Za-z]+' });

      expect(input.getInputElement().pattern).toBe('[A-Za-z]+');
    });

    it('should set autocomplete', () => {
      const input = new Input({ autocomplete: 'email' });

      expect(input.getInputElement().autocomplete).toBe('email');
    });
  });

  describe('Events', () => {
    it('should call onChange handler', () => {
      const handler = vi.fn();
      const input = new Input({ onChange: handler });

      input.getInputElement().value = 'new value';
      input.getInputElement().dispatchEvent(new Event('change'));

      expect(handler).toHaveBeenCalledWith('new value', expect.any(Event));
    });

    it('should call onInput handler', () => {
      const handler = vi.fn();
      const input = new Input({ onInput: handler });

      input.getInputElement().value = 'typing';
      input.getInputElement().dispatchEvent(new Event('input'));

      expect(handler).toHaveBeenCalledWith('typing', expect.any(Event));
    });

    it('should call onBlur handler', () => {
      const handler = vi.fn();
      const input = new Input({ onBlur: handler });

      input.getInputElement().dispatchEvent(new FocusEvent('blur'));

      expect(handler).toHaveBeenCalled();
    });

    it('should call onFocus handler', () => {
      const handler = vi.fn();
      const input = new Input({ onFocus: handler });

      input.getInputElement().dispatchEvent(new FocusEvent('focus'));

      expect(handler).toHaveBeenCalled();
    });

    it('should call onKeyDown handler', () => {
      const handler = vi.fn();
      const input = new Input({ onKeyDown: handler });

      input.getInputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Validation', () => {
    it('should check validity', () => {
      const input = new Input({ required: true });

      // Empty required field should be invalid
      expect(input.isValid()).toBe(false);

      input.setValue('some value');
      expect(input.isValid()).toBe(true);
    });

    it('should set custom validity', () => {
      const input = new Input();

      input.setCustomValidity('Custom error');

      expect(input.isValid()).toBe(false);
    });
  });

  describe('Focus', () => {
    it('should focus the input element', () => {
      const input = new Input();
      document.body.appendChild(input.getElement());

      input.focus();

      expect(document.activeElement).toBe(input.getInputElement());

      input.getElement().remove();
    });

    it('should blur the input element', () => {
      const input = new Input();
      document.body.appendChild(input.getElement());

      input.focus();
      input.blur();

      expect(document.activeElement).not.toBe(input.getInputElement());

      input.getElement().remove();
    });

    it('should select all text', () => {
      const input = new Input({ value: 'select me' });
      document.body.appendChild(input.getElement());

      input.select();

      const inputEl = input.getInputElement();
      expect(inputEl.selectionStart).toBe(0);
      expect(inputEl.selectionEnd).toBe(9);

      input.getElement().remove();
    });
  });

  describe('Method Chaining', () => {
    it('should support method chaining', () => {
      const input = new Input();

      const result = input
        .setValue('test')
        .setDisabled(true)
        .setError('error')
        .clearError()
        .clear();

      expect(result).toBe(input);
    });
  });
});

describe('TextArea Component', () => {
  describe('Creation', () => {
    it('should create a textarea element', () => {
      const textarea = new TextArea();

      expect(textarea.getTextAreaElement().tagName).toBe('TEXTAREA');
    });

    it('should have default rows of 4', () => {
      const textarea = new TextArea();

      expect(textarea.getTextAreaElement().rows).toBe(4);
    });

    it('should accept custom rows', () => {
      const textarea = new TextArea({ rows: 10 });

      expect(textarea.getTextAreaElement().rows).toBe(10);
    });
  });

  describe('Resize', () => {
    it('should have vertical resize by default', () => {
      const textarea = new TextArea();

      expect(textarea.getTextAreaElement().style.resize).toBe('vertical');
    });

    it('should accept custom resize option', () => {
      const textareaNone = new TextArea({ resize: 'none' });
      const textareaBoth = new TextArea({ resize: 'both' });

      expect(textareaNone.getTextAreaElement().style.resize).toBe('none');
      expect(textareaBoth.getTextAreaElement().style.resize).toBe('both');
    });
  });

  describe('Value', () => {
    it('should get and set value', () => {
      const textarea = new TextArea();

      textarea.setValue('multiline\ntext');

      expect(textarea.getValue()).toBe('multiline\ntext');
    });

    it('should clear value', () => {
      const textarea = new TextArea({ value: 'some text' });

      textarea.clear();

      expect(textarea.getValue()).toBe('');
    });
  });

  describe('Submit on Enter', () => {
    it('should call onSubmit when Enter pressed at end of text', () => {
      const handler = vi.fn();
      const textarea = new TextArea({ onSubmit: handler, value: 'test' });
      const textareaEl = textarea.getTextAreaElement();

      // Set cursor at the end
      textareaEl.selectionStart = 4;
      textareaEl.selectionEnd = 4;

      textareaEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(handler).toHaveBeenCalledWith('test');
    });

    it('should not call onSubmit when Shift+Enter pressed', () => {
      const handler = vi.fn();
      const textarea = new TextArea({ onSubmit: handler, value: 'test' });
      const textareaEl = textarea.getTextAreaElement();

      textareaEl.selectionStart = 4;

      textareaEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));

      expect(handler).not.toHaveBeenCalled();
    });
  });
});

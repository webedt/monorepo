import { Component, ComponentOptions } from '../base';
import './card.css';

export interface CardOptions extends ComponentOptions {
  elevated?: boolean;
  interactive?: boolean;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  onClick?: (event: MouseEvent) => void;
}

export class Card extends Component<HTMLDivElement> {
  private headerElement?: HTMLElement;
  private bodyElement?: HTMLElement;
  private footerElement?: HTMLElement;
  private options: CardOptions;

  constructor(options: CardOptions = {}) {
    super('div', {
      className: 'card',
      ...options,
    });

    this.options = options;
    this.applyModifiers();

    if (options.onClick) {
      this.on('click', options.onClick);
    }
  }

  private applyModifiers(): void {
    const { elevated, interactive, size, fullWidth } = this.options;

    if (elevated) {
      this.addClass('card--elevated');
    }

    if (interactive) {
      this.addClass('card--interactive');
      this.setAttribute('role', 'button');
      this.setAttribute('tabindex', '0');
    }

    if (size === 'sm') {
      this.addClass('card--sm');
    }

    if (fullWidth) {
      this.addClass('card--full');
    }
  }

  /**
   * Add or get the card header
   */
  header(options?: CardHeaderOptions): CardHeader {
    if (!this.headerElement) {
      const header = new CardHeader(options);
      this.headerElement = header.getElement();
      this.element.insertBefore(this.headerElement, this.element.firstChild);
      return header;
    }
    // Return existing header wrapped in CardHeader
    return new CardHeader({ element: this.headerElement as HTMLElement });
  }

  /**
   * Add or get the card body
   */
  body(options?: CardBodyOptions): CardBody {
    if (!this.bodyElement) {
      const body = new CardBody(options);
      this.bodyElement = body.getElement();

      // Insert after header if exists, otherwise at start
      if (this.headerElement) {
        this.headerElement.after(this.bodyElement);
      } else {
        this.element.insertBefore(this.bodyElement, this.element.firstChild);
      }
      return body;
    }
    return new CardBody({ element: this.bodyElement as HTMLElement });
  }

  /**
   * Add or get the card footer
   */
  footer(options?: CardFooterOptions): CardFooter {
    if (!this.footerElement) {
      const footer = new CardFooter(options);
      this.footerElement = footer.getElement();
      this.element.appendChild(this.footerElement);
      return footer;
    }
    return new CardFooter({ element: this.footerElement as HTMLElement });
  }

  /**
   * Add media (image) to the top of the card
   */
  media(src: string, alt: string = '', options?: { square?: boolean }): this {
    const img = document.createElement('img');
    img.className = 'card-media';
    img.src = src;
    img.alt = alt;

    if (options?.square) {
      img.classList.add('card-media--square');
    }

    this.element.insertBefore(img, this.element.firstChild);
    return this;
  }
}

export interface CardHeaderOptions extends ComponentOptions {
  title?: string;
  description?: string;
  noBorder?: boolean;
  element?: HTMLElement;
}

export class CardHeader extends Component<HTMLElement> {
  private titleElement?: HTMLHeadingElement;
  private descriptionElement?: HTMLParagraphElement;
  private actionsElement?: HTMLDivElement;

  constructor(options: CardHeaderOptions = {}) {
    if (options.element) {
      // Wrap existing element
      super('header', { className: 'card-header' });
      this.element = options.element as HTMLElement;
    } else {
      super('header', {
        className: 'card-header',
        ...options,
      });

      if (options.noBorder) {
        this.addClass('card-header--no-border');
      }

      if (options.title) {
        this.setTitle(options.title);
      }

      if (options.description) {
        this.setDescription(options.description);
      }
    }
  }

  setTitle(text: string): this {
    if (!this.titleElement) {
      const titleWrapper = document.createElement('div');
      this.titleElement = document.createElement('h3');
      this.titleElement.className = 'card-title';
      titleWrapper.appendChild(this.titleElement);
      this.element.insertBefore(titleWrapper, this.element.firstChild);
    }
    this.titleElement.textContent = text;
    return this;
  }

  setDescription(text: string): this {
    if (!this.descriptionElement) {
      this.descriptionElement = document.createElement('p');
      this.descriptionElement.className = 'card-description';
      // Insert after title
      if (this.titleElement) {
        this.titleElement.parentElement?.appendChild(this.descriptionElement);
      } else {
        this.element.insertBefore(this.descriptionElement, this.element.firstChild);
      }
    }
    this.descriptionElement.textContent = text;
    return this;
  }

  actions(): HTMLDivElement {
    if (!this.actionsElement) {
      this.actionsElement = document.createElement('div');
      this.actionsElement.className = 'card-actions';
      this.element.appendChild(this.actionsElement);
    }
    return this.actionsElement;
  }

  addAction(component: Component | HTMLElement): this {
    const actionsEl = this.actions();
    if (component instanceof Component) {
      actionsEl.appendChild(component.getElement());
    } else {
      actionsEl.appendChild(component);
    }
    return this;
  }
}

export interface CardBodyOptions extends ComponentOptions {
  compact?: boolean;
  noPadding?: boolean;
  element?: HTMLElement;
}

export class CardBody extends Component<HTMLDivElement> {
  constructor(options: CardBodyOptions = {}) {
    if (options.element) {
      super('div', { className: 'card-body' });
      this.element = options.element as HTMLDivElement;
    } else {
      super('div', {
        className: 'card-body',
        ...options,
      });

      if (options.compact) {
        this.addClass('card-body--compact');
      }

      if (options.noPadding) {
        this.addClass('card-body--no-padding');
      }
    }
  }
}

export interface CardFooterOptions extends ComponentOptions {
  align?: 'start' | 'center' | 'end' | 'between';
  noBackground?: boolean;
  element?: HTMLElement;
}

export class CardFooter extends Component<HTMLElement> {
  constructor(options: CardFooterOptions = {}) {
    if (options.element) {
      super('footer', { className: 'card-footer' });
      this.element = options.element as HTMLElement;
    } else {
      super('footer', {
        className: 'card-footer',
        ...options,
      });

      if (options.align && options.align !== 'end') {
        this.addClass(`card-footer--${options.align}`);
      }

      if (options.noBackground) {
        this.addClass('card-footer--no-bg');
      }
    }
  }
}

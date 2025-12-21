import { Link } from 'react-router-dom';
import { useEffect, useRef } from 'react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  isActive?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  navItems: NavItem[];
  title?: string;
  isEditorMode?: boolean;
}

export default function MobileMenu({ isOpen, onClose, navItems, title = 'Menu', isEditorMode = false }: MobileMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement;

      // Don't close if clicking on the hamburger button (has aria-label "Toggle menu")
      if (target.closest('[aria-label="Toggle menu"]')) {
        return;
      }

      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      // Use a small delay to avoid conflict with the toggle button
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
      }, 100);

      // Prevent body scroll when menu is open
      document.body.style.overflow = 'hidden';

      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('touchstart', handleClickOutside);
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-[70] transition-opacity md:hidden ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Slide-in Menu */}
      <div
        ref={menuRef}
        className={`fixed top-0 left-0 h-full w-64 bg-base-100 shadow-xl z-[80] transform transition-transform duration-300 ease-in-out md:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-base-300">
            <span className="font-semibold text-lg">{title}</span>
            <button
              onClick={onClose}
              className="btn btn-sm btn-ghost btn-circle"
              aria-label="Close menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 overflow-y-auto p-2">
            <div className="flex flex-col gap-1">
              {navItems.map((item, index) => (
                item.disabled ? (
                  <button
                    key={index}
                    disabled
                    className="flex items-center gap-3 px-4 py-3 text-sm font-medium rounded transition-colors bg-primary/10 text-primary cursor-not-allowed"
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ) : (
                  <Link
                    key={index}
                    to={item.to}
                    onClick={(e) => {
                      if (item.onClick) {
                        item.onClick(e);
                      }
                      onClose();
                    }}
                    className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded transition-colors ${
                      item.isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-base-content/70 hover:bg-base-200'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                )
              ))}
            </div>

            {/* Mode Toggle Divider */}
            <div className="border-t border-base-300 my-3"></div>

            {/* Mode Toggle - Switch between Hub and Editor */}
            <div className="px-2">
              <Link
                to={isEditorMode ? '/store' : '/sessions'}
                className="flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                {isEditorMode ? (
                  <>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z"/>
                    </svg>
                    <span>Switch to The Hub</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                    </svg>
                    <span>Switch to Editor</span>
                  </>
                )}
              </Link>
            </div>
          </nav>
        </div>
      </div>
    </>
  );
}

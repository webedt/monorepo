/**
 * Vitest Test Setup
 * Sets up the test environment for component, store, and page testing with jsdom.
 */

// Mock the HMR module since it's not available in test environment
vi.mock('../src/lib/hmr', () => ({
  createHmrId: () => 'test-hmr-id',
  registerComponent: () => {},
  unregisterComponent: () => {},
  registerStore: () => {},
  registerPage: () => {},
  unregisterPage: () => {},
  getHmrState: () => undefined,
  saveHmrState: () => {},
}));

// Mock toast notifications for page testing
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('../src/components', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    toast: mockToast,
  };
});

// Extend window with any global variables needed for tests
declare global {
  interface Window {
    __WEBEDT_VERSION__?: string;
  }
}

// Set up mock version for tests
window.__WEBEDT_VERSION__ = '0.0.1 [test] [2024-01-01]';

// Mock matchMedia for theme detection (not available in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver (not available in jsdom)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Mock localStorage and sessionStorage for store tests
const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  };
};

// Install storage mocks
Object.defineProperty(window, 'localStorage', {
  value: createStorageMock(),
  writable: true,
});

Object.defineProperty(window, 'sessionStorage', {
  value: createStorageMock(),
  writable: true,
});

// Clean up after each test
afterEach(() => {
  // Clear the document body
  document.body.innerHTML = '';
  // Clear all mocks
  vi.clearAllMocks();
  // Clear storage
  localStorage.clear();
  sessionStorage.clear();
});

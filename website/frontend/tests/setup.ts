/**
 * Vitest Test Setup
 * Sets up the test environment for component testing with jsdom.
 */

// Mock the HMR module since it's not available in test environment
vi.mock('../src/lib/hmr', () => ({
  createHmrId: () => 'test-hmr-id',
  registerComponent: () => {},
  unregisterComponent: () => {},
}));

// Extend window with any global variables needed for tests
declare global {
  interface Window {
    __WEBEDT_VERSION__?: string;
  }
}

// Set up mock version for tests
window.__WEBEDT_VERSION__ = '0.0.1 [test] [2024-01-01]';

// Clean up after each test
afterEach(() => {
  // Clear the document body
  document.body.innerHTML = '';
});

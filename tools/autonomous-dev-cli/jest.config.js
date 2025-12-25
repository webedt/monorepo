/**
 * Jest Configuration for Autonomous Dev CLI
 *
 * This configuration supports both Node.js native test runner (for development)
 * and Jest (for CI and coverage reporting).
 *
 * To run tests with Node.js native runner:
 *   npm test
 *
 * To run tests with Jest:
 *   npm run test:jest
 *
 * To run tests with coverage:
 *   npm run test:coverage
 */

/** @type {import('jest').Config} */
const config = {
  // Use ts-jest for TypeScript support
  preset: 'ts-jest/presets/default-esm',

  // Test environment
  testEnvironment: 'node',

  // Root directory for tests
  roots: ['<rootDir>/tests'],

  // Test file patterns - matches existing *.test.ts files
  testMatch: [
    '**/*.test.ts',
    '**/__tests__/**/*.ts',
  ],

  // Module resolution for ESM
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // Transform TypeScript files
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.json',
      },
    ],
  },

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/test-utils/**',
    '!src/types/**',
  ],

  // Coverage thresholds - targeting 80% as per issue requirements
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // Critical modules with higher thresholds
    './src/daemon.ts': {
      branches: 70,
      functions: 75,
      lines: 75,
      statements: 75,
    },
    './src/discovery/': {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './src/executor/': {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './src/evaluation/': {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // Coverage reporters
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],

  // Coverage output directory
  coverageDirectory: '<rootDir>/coverage',

  // Setup files (test-utils remains in src as it's shared test infrastructure)
  setupFilesAfterEnv: ['<rootDir>/src/test-utils/jest-setup.ts'],

  // Timeout for long-running tests
  testTimeout: 30000,

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Restore mocks after each test
  restoreMocks: true,

  // Detect open handles for debugging
  detectOpenHandles: true,

  // Force exit after tests complete
  forceExit: true,

  // Module paths
  modulePaths: ['<rootDir>/tests', '<rootDir>/src'],

  // Files to ignore
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
  ],

  // Reporters for CI
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: './reports/junit',
        outputName: 'junit.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' > ',
        usePathForSuiteName: true,
      },
    ],
  ],

  // Snapshot serializers
  snapshotSerializers: [],

  // Global teardown
  globalTeardown: '<rootDir>/src/test-utils/jest-teardown.ts',

  // Maximum workers for parallel execution
  maxWorkers: '50%',

  // Fail on console errors during tests
  errorOnDeprecated: true,

  // Watch plugins
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname',
  ],
};

export default config;

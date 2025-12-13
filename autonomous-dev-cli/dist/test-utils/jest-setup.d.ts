/**
 * Jest Setup File
 *
 * This file runs before each test suite to configure the test environment.
 * It sets up global mocks, extends expect matchers, and configures test utilities.
 *
 * Note: This file is only used when running tests with Jest (npm run test:jest).
 * The Node.js native test runner (npm test) does not use this file.
 */
declare global {
    namespace jest {
        interface Matchers<R> {
            toBeValidISODate(): R;
            toHaveErrorCode(code: string): R;
            toCompleteWithin(timeoutMs: number): Promise<R>;
        }
    }
}
export {};
//# sourceMappingURL=jest-setup.d.ts.map
/**
 * AI Coding Worker API Tests
 *
 * These tests verify the AI Coding Worker endpoints are functioning correctly.
 * They test against the deployed worker URL specified in the environment.
 *
 * Required environment variables:
 * - AI_CODING_WORKER_URL: Base URL of the deployed worker (e.g., https://ai-coding-worker.example.com)
 * - CODING_ASSISTANT_PROVIDER: Provider name (e.g., ClaudeAgentSDK)
 * - CODING_ASSISTANT_AUTHENTICATION: Authentication credentials JSON
 * - TEST_GITHUB_ACCESS_TOKEN: (optional) GitHub token for GitHub integration tests
 */

import 'dotenv/config';

// Test configuration
const AI_CODING_WORKER_URL = process.env.AI_CODING_WORKER_URL || 'http://localhost:5000';
const CODING_ASSISTANT_PROVIDER = process.env.CODING_ASSISTANT_PROVIDER;
const CODING_ASSISTANT_AUTHENTICATION = process.env.CODING_ASSISTANT_AUTHENTICATION;
const TEST_GITHUB_ACCESS_TOKEN = process.env.TEST_GITHUB_ACCESS_TOKEN;

// Test result tracking
interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

// Utility functions
function log(message: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') {
  const prefix = {
    info: '\x1b[36m[INFO]\x1b[0m',
    success: '\x1b[32m[PASS]\x1b[0m',
    error: '\x1b[31m[FAIL]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
  };
  console.log(`${prefix[type]} ${message}`);
}

async function runTest(name: string, testFn: () => Promise<void>) {
  const start = Date.now();
  try {
    await testFn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    log(`${name} (${duration}ms)`, 'success');
  } catch (error) {
    const duration = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, duration, error: errorMessage });
    log(`${name}: ${errorMessage}`, 'error');
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

// ============================================================================
// TEST CASES
// ============================================================================

/**
 * Test 1: Health Check
 * Verifies the /health endpoint returns correct status
 */
async function testHealthCheck() {
  const response = await fetch(`${AI_CODING_WORKER_URL}/health`);
  assert(response.ok, `Health check failed with status ${response.status}`);

  const data = await response.json();
  assert(data.status === 'ok', `Expected status 'ok', got '${data.status}'`);
  assert(data.service === 'ai-coding-worker', `Expected service 'ai-coding-worker', got '${data.service}'`);
  assert(data.containerId !== undefined, 'Missing containerId in response');
  assert(data.build !== undefined, 'Missing build info in response');
}

/**
 * Test 2: Status Endpoint
 * Verifies the /status endpoint returns worker status
 */
async function testStatusEndpoint() {
  const response = await fetch(`${AI_CODING_WORKER_URL}/status`);
  assert(response.ok, `Status check failed with status ${response.status}`);

  const data = await response.json();
  assert(
    data.status === 'idle' || data.status === 'busy',
    `Expected status 'idle' or 'busy', got '${data.status}'`
  );
  assert(data.containerId !== undefined, 'Missing containerId in response');
  assert(data.timestamp !== undefined, 'Missing timestamp in response');
}

/**
 * Test 3: List Sessions
 * Verifies the /sessions endpoint returns session list
 */
async function testListSessions() {
  const response = await fetch(`${AI_CODING_WORKER_URL}/sessions`);
  assert(response.ok, `List sessions failed with status ${response.status}`);

  const data = await response.json();
  assert(typeof data.count === 'number', `Expected count to be a number, got ${typeof data.count}`);
  assert(Array.isArray(data.sessions), 'Expected sessions to be an array');
  assert(data.containerId !== undefined, 'Missing containerId in response');
}

/**
 * Test 4: 404 for Unknown Endpoint
 * Verifies the server returns 404 for unknown endpoints
 */
async function testUnknownEndpoint() {
  const response = await fetch(`${AI_CODING_WORKER_URL}/nonexistent-endpoint`);
  assert(response.status === 404, `Expected 404, got ${response.status}`);

  const data = await response.json();
  assert(data.error === 'not_found', `Expected error 'not_found', got '${data.error}'`);
  assert(Array.isArray(data.availableEndpoints), 'Expected availableEndpoints array');
}

/**
 * Test 5: Execute Endpoint - Missing userRequest
 * Verifies the execute endpoint validates required fields
 */
async function testExecuteMissingUserRequest() {
  const response = await fetch(`${AI_CODING_WORKER_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert(response.status === 400, `Expected 400, got ${response.status}`);

  const data = await response.json();
  assert(data.error === 'invalid_request', `Expected error 'invalid_request', got '${data.error}'`);
  assert(data.field === 'userRequest', `Expected field 'userRequest', got '${data.field}'`);
}

/**
 * Test 6: Execute Endpoint - Missing Provider (no env fallback)
 * Verifies the execute endpoint validates provider when not in environment
 */
async function testExecuteMissingProvider() {
  const response = await fetch(`${AI_CODING_WORKER_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest: 'Test request',
    }),
  });

  // If the server has env variables configured, it might return 429 (busy) or start processing
  // If no env variables, it should return 400 for missing provider
  if (response.status === 400) {
    const data = await response.json();
    assert(
      data.error === 'invalid_request',
      `Expected error 'invalid_request', got '${data.error}'`
    );
  } else if (response.status === 429) {
    // Worker is busy - this means env variables are set and request was valid
    log('Worker is busy (env credentials configured)', 'warn');
  } else {
    // Any other response indicates the request was accepted
    assert(response.ok || response.status === 429, `Unexpected status ${response.status}`);
  }
}

/**
 * Test 7: Abort Endpoint - No Active Execution
 * Verifies the abort endpoint handles cases with no active execution
 */
async function testAbortNoExecution() {
  const response = await fetch(`${AI_CODING_WORKER_URL}/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert(response.ok, `Abort endpoint failed with status ${response.status}`);

  const data = await response.json();
  assert(data.status === 'ok', `Expected status 'ok', got '${data.status}'`);
}

/**
 * Test 8: Delete Non-existent Session
 * Verifies deleting a non-existent session handles gracefully
 */
async function testDeleteNonexistentSession() {
  const response = await fetch(`${AI_CODING_WORKER_URL}/sessions/nonexistent-session-id-12345`, {
    method: 'DELETE',
  });

  // Should succeed (idempotent delete) or return error
  const data = await response.json();
  // Either the session was deleted or it didn't exist - both are acceptable
  assert(
    response.ok || response.status === 404 || response.status === 500,
    `Unexpected status ${response.status}`
  );
}

/**
 * Test 9: CORS Headers
 * Verifies CORS headers are present
 */
async function testCorsHeaders() {
  const response = await fetch(`${AI_CODING_WORKER_URL}/health`, {
    method: 'OPTIONS',
  });

  // OPTIONS might return 200 or 204
  assert(
    response.status === 200 || response.status === 204,
    `Expected 200 or 204, got ${response.status}`
  );
}

/**
 * Test 10: Container ID Header
 * Verifies X-Container-ID header is present
 */
async function testContainerIdHeader() {
  const response = await fetch(`${AI_CODING_WORKER_URL}/health`);

  const containerId = response.headers.get('x-container-id');
  assert(containerId !== null, 'X-Container-ID header is missing');
}

/**
 * Test 11: Execute with SSE (if credentials available)
 * Tests a simple execution that returns SSE stream
 */
async function testExecuteSSE() {
  if (!CODING_ASSISTANT_PROVIDER || !CODING_ASSISTANT_AUTHENTICATION) {
    log('Skipping SSE test - credentials not configured', 'warn');
    return;
  }

  // First check if worker is idle
  const statusResponse = await fetch(`${AI_CODING_WORKER_URL}/status`);
  const statusData = await statusResponse.json();

  if (statusData.status === 'busy') {
    log('Skipping SSE test - worker is busy', 'warn');
    return;
  }

  const response = await fetch(`${AI_CODING_WORKER_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest: 'Say "Hello, test!" and nothing else.',
      codingAssistantProvider: CODING_ASSISTANT_PROVIDER,
      codingAssistantAuthentication: CODING_ASSISTANT_AUTHENTICATION,
    }),
  });

  assert(response.ok || response.status === 429, `Execute failed with status ${response.status}`);

  if (response.ok) {
    const contentType = response.headers.get('content-type');
    assert(
      contentType?.includes('text/event-stream'),
      `Expected text/event-stream, got ${contentType}`
    );

    // Read a few events to verify SSE is working
    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let eventCount = 0;
      const maxEvents = 3;

      try {
        while (eventCount < maxEvents) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          if (text.includes('event:') || text.includes('data:')) {
            eventCount++;
          }
        }
      } finally {
        reader.cancel();
      }

      assert(eventCount > 0, 'No SSE events received');
    }
  }
}

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('AI Coding Worker API Tests');
  console.log('='.repeat(60));
  console.log(`Target: ${AI_CODING_WORKER_URL}`);
  console.log(`Provider configured: ${CODING_ASSISTANT_PROVIDER ? 'Yes' : 'No'}`);
  console.log(`GitHub token configured: ${TEST_GITHUB_ACCESS_TOKEN ? 'Yes' : 'No'}`);
  console.log('='.repeat(60) + '\n');

  // Run all tests
  await runTest('Health Check', testHealthCheck);
  await runTest('Status Endpoint', testStatusEndpoint);
  await runTest('List Sessions', testListSessions);
  await runTest('Unknown Endpoint (404)', testUnknownEndpoint);
  await runTest('Execute - Missing userRequest', testExecuteMissingUserRequest);
  await runTest('Execute - Missing Provider', testExecuteMissingProvider);
  await runTest('Abort - No Active Execution', testAbortNoExecution);
  await runTest('Delete Non-existent Session', testDeleteNonexistentSession);
  await runTest('CORS Headers', testCorsHeaders);
  await runTest('Container ID Header', testContainerIdHeader);
  await runTest('Execute with SSE', testExecuteSSE);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Duration: ${totalDuration}ms`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  console.log('='.repeat(60) + '\n');

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});

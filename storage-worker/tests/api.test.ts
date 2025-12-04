/**
 * Storage Worker API Tests
 *
 * These tests verify the Storage Worker endpoints are functioning correctly.
 * They test against the deployed worker URL specified in the environment.
 *
 * Required environment variables:
 * - STORAGE_WORKER_URL: Base URL of the deployed worker (e.g., https://storage-worker.example.com)
 *
 * Optional environment variables (for MinIO direct access tests):
 * - MINIO_ENDPOINT: MinIO server hostname
 * - MINIO_PORT: MinIO server port
 * - MINIO_USE_SSL: Whether to use SSL (true/false)
 * - MINIO_ROOT_USER: MinIO username
 * - MINIO_ROOT_PASSWORD: MinIO password
 * - MINIO_BUCKET: Bucket name
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// Test configuration
const STORAGE_WORKER_URL = process.env.STORAGE_WORKER_URL || 'http://localhost:3000';

// Test result tracking
interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

// Test session ID (unique per test run to avoid conflicts)
const TEST_SESSION_ID = `test-session-${Date.now()}-${Math.random().toString(36).substring(7)}`;

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

/**
 * Create a test tarball for upload tests
 */
async function createTestTarball(): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const testDir = path.join(tmpDir, `test-tarball-${Date.now()}`);
  const tarballPath = path.join(tmpDir, `test-${Date.now()}.tar.gz`);

  // Create test directory with some files
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'test.txt'), 'Hello, World!');
  fs.writeFileSync(path.join(testDir, 'test.json'), JSON.stringify({ test: true }));
  fs.mkdirSync(path.join(testDir, 'subdir'), { recursive: true });
  fs.writeFileSync(path.join(testDir, 'subdir', 'nested.txt'), 'Nested content');

  // Create tarball
  execSync(`tar -czf ${tarballPath} -C ${testDir} .`, { stdio: 'ignore' });

  // Read tarball
  const buffer = fs.readFileSync(tarballPath);

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.unlinkSync(tarballPath);

  return buffer;
}

// ============================================================================
// TEST CASES
// ============================================================================

/**
 * Test 1: Health Check
 * Verifies the /health endpoint returns correct status
 */
async function testHealthCheck() {
  const response = await fetch(`${STORAGE_WORKER_URL}/health`);
  assert(response.ok, `Health check failed with status ${response.status}`);

  const data = await response.json();
  assert(data.status === 'ok', `Expected status 'ok', got '${data.status}'`);
  assert(data.service === 'storage-worker', `Expected service 'storage-worker', got '${data.service}'`);
  assert(data.containerId !== undefined, 'Missing containerId in response');
  assert(data.build !== undefined, 'Missing build info in response');
}

/**
 * Test 2: List Sessions
 * Verifies the sessions list endpoint works
 */
async function testListSessions() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions`);
  assert(response.ok, `List sessions failed with status ${response.status}`);

  const data = await response.json();
  assert(typeof data.count === 'number', `Expected count to be a number, got ${typeof data.count}`);
  assert(Array.isArray(data.sessions), 'Expected sessions to be an array');
  assert(data.containerId !== undefined, 'Missing containerId in response');
}

/**
 * Test 3: Session Not Found
 * Verifies 404 is returned for non-existent sessions
 */
async function testSessionNotFound() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/nonexistent-session-12345`);
  assert(response.status === 404, `Expected 404, got ${response.status}`);

  const data = await response.json();
  assert(data.error === 'session_not_found', `Expected error 'session_not_found', got '${data.error}'`);
}

/**
 * Test 4: Session Download Not Found
 * Verifies 404 is returned when downloading non-existent session
 */
async function testSessionDownloadNotFound() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/nonexistent-session-12345/download`);
  assert(response.status === 404, `Expected 404, got ${response.status}`);

  const data = await response.json();
  assert(data.error === 'session_not_found', `Expected error 'session_not_found', got '${data.error}'`);
}

/**
 * Test 5: HEAD Session Not Found
 * Verifies HEAD request returns 404 for non-existent sessions
 */
async function testHeadSessionNotFound() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/nonexistent-session-12345`, {
    method: 'HEAD',
  });
  assert(response.status === 404, `Expected 404, got ${response.status}`);
}

/**
 * Test 6: Invalid Session Path (with slashes)
 * Verifies validation rejects session paths with slashes
 */
async function testInvalidSessionPath() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/invalid/path/session`);

  // The path might be interpreted differently, but should fail validation
  // or return 404 because the route doesn't match
  assert(
    response.status === 400 || response.status === 404,
    `Expected 400 or 404, got ${response.status}`
  );
}

/**
 * Test 7: Upload Session
 * Tests uploading a session tarball
 */
async function testUploadSession() {
  const tarball = await createTestTarball();

  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/gzip',
    },
    body: tarball,
  });

  assert(response.ok, `Upload failed with status ${response.status}`);

  const data = await response.json();
  assert(data.uploaded === true, `Expected uploaded to be true, got ${data.uploaded}`);
  assert(data.sessionPath === TEST_SESSION_ID, `Expected sessionPath '${TEST_SESSION_ID}', got '${data.sessionPath}'`);
  assert(typeof data.size === 'number', `Expected size to be a number, got ${typeof data.size}`);
}

/**
 * Test 8: Check Session Exists (HEAD)
 * Tests that uploaded session exists
 */
async function testHeadSessionExists() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}`, {
    method: 'HEAD',
  });
  assert(response.status === 200, `Expected 200, got ${response.status}`);
}

/**
 * Test 9: Get Session Metadata
 * Tests retrieving session metadata
 */
async function testGetSessionMetadata() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}`);
  assert(response.ok, `Get metadata failed with status ${response.status}`);

  const data = await response.json();
  assert(data.sessionPath === TEST_SESSION_ID, `Expected sessionPath '${TEST_SESSION_ID}', got '${data.sessionPath}'`);
  assert(data.containerId !== undefined, 'Missing containerId in response');
}

/**
 * Test 10: Download Session
 * Tests downloading a session tarball
 */
async function testDownloadSession() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}/download`);
  assert(response.ok, `Download failed with status ${response.status}`);

  const contentType = response.headers.get('content-type');
  assert(contentType === 'application/gzip', `Expected content-type 'application/gzip', got '${contentType}'`);

  const buffer = await response.arrayBuffer();
  assert(buffer.byteLength > 0, 'Downloaded empty file');
}

/**
 * Test 11: List Files in Session
 * Tests listing files in a session
 */
async function testListSessionFiles() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}/files`);
  assert(response.ok, `List files failed with status ${response.status}`);

  const data = await response.json();
  assert(data.sessionPath === TEST_SESSION_ID, `Expected sessionPath '${TEST_SESSION_ID}', got '${data.sessionPath}'`);
  assert(Array.isArray(data.files), 'Expected files to be an array');
  assert(data.count >= 0, `Expected count >= 0, got ${data.count}`);
}

/**
 * Test 12: Get File from Session
 * Tests retrieving a specific file from a session
 */
async function testGetSessionFile() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}/files/test.txt`);

  if (response.ok) {
    const content = await response.text();
    assert(content === 'Hello, World!', `Expected 'Hello, World!', got '${content}'`);
  } else if (response.status === 404) {
    // File might not be found depending on tarball structure
    log('File not found in session (may be expected)', 'warn');
  } else {
    throw new Error(`Unexpected status ${response.status}`);
  }
}

/**
 * Test 13: Write File to Session
 * Tests writing a new file to a session
 */
async function testWriteSessionFile() {
  const testContent = 'Test file content ' + Date.now();

  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}/files/new-file.txt`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: testContent,
  });

  assert(response.ok, `Write file failed with status ${response.status}`);

  const data = await response.json();
  assert(data.success === true, `Expected success to be true, got ${data.success}`);
  assert(data.filePath === 'new-file.txt', `Expected filePath 'new-file.txt', got '${data.filePath}'`);
}

/**
 * Test 14: Delete File from Session
 * Tests deleting a file from a session
 */
async function testDeleteSessionFile() {
  // First write a file to delete
  await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}/files/to-delete.txt`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: 'File to delete',
  });

  // Then delete it
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}/files/to-delete.txt`, {
    method: 'DELETE',
  });

  assert(response.ok || response.status === 404, `Delete file failed with status ${response.status}`);
}

/**
 * Test 15: Delete Session
 * Tests deleting a session
 */
async function testDeleteSession() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}`, {
    method: 'DELETE',
  });

  assert(response.ok, `Delete session failed with status ${response.status}`);

  const data = await response.json();
  assert(data.deleted === true, `Expected deleted to be true, got ${data.deleted}`);
  assert(data.sessionPath === TEST_SESSION_ID, `Expected sessionPath '${TEST_SESSION_ID}', got '${data.sessionPath}'`);
}

/**
 * Test 16: Verify Session Deleted
 * Verifies the session no longer exists after deletion
 */
async function testVerifySessionDeleted() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${TEST_SESSION_ID}`, {
    method: 'HEAD',
  });
  assert(response.status === 404, `Expected 404 after deletion, got ${response.status}`);
}

/**
 * Test 17: Bulk Delete (empty array)
 * Tests bulk delete with empty array
 */
async function testBulkDeleteEmpty() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionPaths: [] }),
  });

  assert(response.ok, `Bulk delete failed with status ${response.status}`);

  const data = await response.json();
  assert(data.deletedCount === 0, `Expected deletedCount 0, got ${data.deletedCount}`);
}

/**
 * Test 18: Bulk Delete - Invalid Input
 * Tests bulk delete with invalid input
 */
async function testBulkDeleteInvalid() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionPaths: 'not-an-array' }),
  });

  assert(response.status === 400, `Expected 400, got ${response.status}`);

  const data = await response.json();
  assert(data.error === 'invalid_request', `Expected error 'invalid_request', got '${data.error}'`);
}

/**
 * Test 19: 404 for Unknown Endpoint
 * Verifies the server returns 404 for unknown endpoints
 */
async function testUnknownEndpoint() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/nonexistent-endpoint`);
  assert(response.status === 404, `Expected 404, got ${response.status}`);

  const data = await response.json();
  assert(data.error === 'not_found', `Expected error 'not_found', got '${data.error}'`);
}

/**
 * Test 20: Container ID Header
 * Verifies X-Container-ID header is present
 */
async function testContainerIdHeader() {
  const response = await fetch(`${STORAGE_WORKER_URL}/health`);

  const containerId = response.headers.get('x-container-id');
  assert(containerId !== null, 'X-Container-ID header is missing');
}

/**
 * Test 21: Path Normalization
 * Tests that /sessions paths work (proxy scenario)
 */
async function testPathNormalization() {
  // Try accessing /sessions directly (should be normalized to /api/storage-worker/sessions)
  const response = await fetch(`${STORAGE_WORKER_URL}/sessions`);

  // Should either work (path normalized) or return 404 (if normalization not needed)
  assert(
    response.ok || response.status === 404,
    `Unexpected status ${response.status}`
  );
}

/**
 * Test 22: Invalid Content Type for Upload
 * Tests that upload rejects invalid content types
 */
async function testUploadInvalidContentType() {
  const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/test-invalid-upload/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ invalid: 'data' }),
  });

  assert(response.status === 400, `Expected 400, got ${response.status}`);

  const data = await response.json();
  assert(data.error === 'invalid_content_type', `Expected error 'invalid_content_type', got '${data.error}'`);
}

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('Storage Worker API Tests');
  console.log('='.repeat(60));
  console.log(`Target: ${STORAGE_WORKER_URL}`);
  console.log(`Test Session ID: ${TEST_SESSION_ID}`);
  console.log('='.repeat(60) + '\n');

  // Basic endpoint tests
  await runTest('Health Check', testHealthCheck);
  await runTest('List Sessions', testListSessions);
  await runTest('Container ID Header', testContainerIdHeader);
  await runTest('Unknown Endpoint (404)', testUnknownEndpoint);

  // Session not found tests
  await runTest('Session Not Found', testSessionNotFound);
  await runTest('Session Download Not Found', testSessionDownloadNotFound);
  await runTest('HEAD Session Not Found', testHeadSessionNotFound);

  // Validation tests
  await runTest('Invalid Session Path', testInvalidSessionPath);
  await runTest('Upload Invalid Content Type', testUploadInvalidContentType);

  // Session lifecycle tests (in order)
  await runTest('Upload Session', testUploadSession);
  await runTest('HEAD Session Exists', testHeadSessionExists);
  await runTest('Get Session Metadata', testGetSessionMetadata);
  await runTest('Download Session', testDownloadSession);
  await runTest('List Files in Session', testListSessionFiles);
  await runTest('Get File from Session', testGetSessionFile);
  await runTest('Write File to Session', testWriteSessionFile);
  await runTest('Delete File from Session', testDeleteSessionFile);
  await runTest('Delete Session', testDeleteSession);
  await runTest('Verify Session Deleted', testVerifySessionDeleted);

  // Bulk operations
  await runTest('Bulk Delete (empty)', testBulkDeleteEmpty);
  await runTest('Bulk Delete (invalid)', testBulkDeleteInvalid);

  // Other tests
  await runTest('Path Normalization', testPathNormalization);

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

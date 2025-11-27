import { promises as fs } from 'fs';
import * as path from 'path';
import { getPreviewUrl, hasWebedtFile, readWebedtConfig } from './previewUrlHelper';

/**
 * Test suite for preview URL helper
 * These are example tests - run with your test framework
 */

async function testDefaultPreviewUrl() {
  console.log('\n=== Test: Default Preview URL ===');

  // Create a temporary directory without .webedt file
  const tempDir = '/tmp/test-no-webedt';
  await fs.mkdir(tempDir, { recursive: true });

  const previewUrl = await getPreviewUrl(
    tempDir,
    'testowner',
    'testrepo',
    'main'
  );

  console.log('Preview URL:', previewUrl);
  console.log('Expected: https://github.etdofresh.com/testowner/testrepo/main/');
  console.log('Match:', previewUrl === 'https://github.etdofresh.com/testowner/testrepo/main/');

  // Cleanup
  await fs.rmdir(tempDir);
}

async function testCustomPreviewUrl() {
  console.log('\n=== Test: Custom Preview URL from .webedt ===');

  // Create a temporary directory with .webedt file
  const tempDir = '/tmp/test-with-webedt';
  await fs.mkdir(tempDir, { recursive: true });

  const webedtConfig = {
    preview_url: 'https://custom-preview.example.com/my-app/'
  };

  const webedtPath = path.join(tempDir, '.webedt');
  await fs.writeFile(webedtPath, JSON.stringify(webedtConfig, null, 2));

  const previewUrl = await getPreviewUrl(
    tempDir,
    'testowner',
    'testrepo',
    'feature-branch'
  );

  console.log('Preview URL:', previewUrl);
  console.log('Expected: https://custom-preview.example.com/my-app/');
  console.log('Match:', previewUrl === 'https://custom-preview.example.com/my-app/');

  // Cleanup
  await fs.unlink(webedtPath);
  await fs.rmdir(tempDir);
}

async function testWebedtFileExists() {
  console.log('\n=== Test: Check .webedt File Existence ===');

  // Create a temporary directory with .webedt file
  const tempDir = '/tmp/test-webedt-exists';
  await fs.mkdir(tempDir, { recursive: true });

  const webedtPath = path.join(tempDir, '.webedt');
  await fs.writeFile(webedtPath, JSON.stringify({ preview_url: 'test' }));

  const exists = await hasWebedtFile(tempDir);
  console.log('File exists:', exists);
  console.log('Expected: true');
  console.log('Match:', exists === true);

  // Cleanup
  await fs.unlink(webedtPath);
  await fs.rmdir(tempDir);

  // Test when file doesn't exist
  const tempDir2 = '/tmp/test-no-webedt-2';
  await fs.mkdir(tempDir2, { recursive: true });

  const notExists = await hasWebedtFile(tempDir2);
  console.log('File exists (should be false):', notExists);
  console.log('Expected: false');
  console.log('Match:', notExists === false);

  // Cleanup
  await fs.rmdir(tempDir2);
}

async function testReadWebedtConfig() {
  console.log('\n=== Test: Read .webedt Config ===');

  // Create a temporary directory with .webedt file
  const tempDir = '/tmp/test-read-webedt';
  await fs.mkdir(tempDir, { recursive: true });

  const webedtConfig = {
    preview_url: 'https://example.com/preview/',
    custom_field: 'custom_value'
  };

  const webedtPath = path.join(tempDir, '.webedt');
  await fs.writeFile(webedtPath, JSON.stringify(webedtConfig, null, 2));

  const config = await readWebedtConfig(tempDir);
  console.log('Config:', config);
  console.log('Expected preview_url:', webedtConfig.preview_url);
  console.log('Match:', config?.preview_url === webedtConfig.preview_url);

  // Cleanup
  await fs.unlink(webedtPath);
  await fs.rmdir(tempDir);
}

async function testWebedtWithoutPreviewUrl() {
  console.log('\n=== Test: .webedt File Without preview_url Field ===');

  // Create a temporary directory with .webedt file but no preview_url
  const tempDir = '/tmp/test-webedt-no-preview';
  await fs.mkdir(tempDir, { recursive: true });

  const webedtConfig = {
    other_field: 'some_value'
  };

  const webedtPath = path.join(tempDir, '.webedt');
  await fs.writeFile(webedtPath, JSON.stringify(webedtConfig, null, 2));

  const previewUrl = await getPreviewUrl(
    tempDir,
    'testowner',
    'testrepo',
    'develop'
  );

  console.log('Preview URL:', previewUrl);
  console.log('Expected (default):', 'https://github.etdofresh.com/testowner/testrepo/develop/');
  console.log('Match:', previewUrl === 'https://github.etdofresh.com/testowner/testrepo/develop/');

  // Cleanup
  await fs.unlink(webedtPath);
  await fs.rmdir(tempDir);
}

// Run all tests
async function runTests() {
  console.log('====================================');
  console.log('Preview URL Helper - Test Suite');
  console.log('====================================');

  try {
    await testDefaultPreviewUrl();
    await testCustomPreviewUrl();
    await testWebedtFileExists();
    await testReadWebedtConfig();
    await testWebedtWithoutPreviewUrl();

    console.log('\n====================================');
    console.log('All tests completed!');
    console.log('====================================\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

export { runTests };

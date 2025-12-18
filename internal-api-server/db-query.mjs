// Quick database query script - also queries Anthropic API to compare
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Client } = pg;

async function queryAnthropicSession(accessToken, sessionId) {
  const url = `https://api.anthropic.com/v1/sessions/${sessionId}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'ccr-byoc-2025-07-29',
        'Content-Type': 'application/json',
      }
    });
    if (!response.ok) {
      const text = await response.text();
      console.log(`  Anthropic API error: ${response.status} ${response.statusText}`);
      console.log(`  Response: ${text.substring(0, 200)}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.log(`  Anthropic API error: ${error.message}`);
    return null;
  }
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // Get Claude auth token for the user
    const userResult = await client.query(`
      SELECT id, email, claude_auth FROM users WHERE claude_auth IS NOT NULL LIMIT 1
    `);

    let accessToken = null;
    if (userResult.rows.length > 0 && userResult.rows[0].claude_auth) {
      accessToken = userResult.rows[0].claude_auth.accessToken;
      console.log(`Found Claude auth for user: ${userResult.rows[0].email}\n`);
    }

    // Find running sessions to compare
    const runningResult = await client.query(`
      SELECT
        id,
        user_request,
        status,
        provider,
        remote_session_id,
        created_at
      FROM chat_sessions
      WHERE status = 'running'
        AND remote_session_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.log('=== RUNNING sessions in DB vs Anthropic API ===\n');
    if (runningResult.rows.length === 0) {
      console.log('No running sessions with remote_session_id found.');
    } else {
      for (const row of runningResult.rows) {
        console.log(`DB Session: ${row.id}`);
        console.log(`  Request: ${row.user_request?.substring(0, 50)}...`);
        console.log(`  DB Status: ${row.status}`);
        console.log(`  Remote Session ID: ${row.remote_session_id}`);
        console.log(`  Created: ${row.created_at}`);

        if (accessToken && row.remote_session_id) {
          const anthropicSession = await queryAnthropicSession(accessToken, row.remote_session_id);
          if (anthropicSession) {
            console.log(`  Anthropic Status: ${anthropicSession.session_status}`);
            console.log(`  Anthropic Title: ${anthropicSession.title}`);
            console.log(`  Anthropic Updated: ${anthropicSession.updated_at}`);

            if (row.status !== anthropicSession.session_status &&
                (anthropicSession.session_status === 'idle' || anthropicSession.session_status === 'completed' || anthropicSession.session_status === 'failed')) {
              console.log(`  ⚠️ STATUS MISMATCH! DB says "running" but Anthropic says "${anthropicSession.session_status}"`);
            }
          }
        }
        console.log('');
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();

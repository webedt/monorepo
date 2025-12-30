#!/usr/bin/env tsx
/**
 * Backfill Event UUIDs Script
 *
 * Populates the uuid column for existing events that have a uuid in their eventData.
 * This is a one-time migration to support the optimized deduplication queries.
 *
 * Usage: npx tsx src/scripts/backfill-event-uuids.ts
 *
 * The script:
 * 1. Finds all events where uuid column is NULL but eventData contains a uuid
 * 2. Updates each event to extract the uuid from eventData into the uuid column
 * 3. Reports progress and results
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

async function main(): Promise<void> {
  console.log('');
  console.log('🔄 Backfill Event UUIDs');
  console.log('═'.repeat(60));
  console.log('');

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Check connection
    console.log('📡 Connecting to database...');
    const client = await pool.connect();
    console.log('✅ Connected successfully');
    console.log('');

    // Count events needing backfill
    console.log('📊 Analyzing events table...');
    const countResult = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE uuid IS NULL) as null_uuid,
             COUNT(*) FILTER (WHERE uuid IS NULL AND event_data->>'uuid' IS NOT NULL AND event_data->>'uuid' != '') as needs_backfill
      FROM events
    `);

    const { total, null_uuid, needs_backfill } = countResult.rows[0];
    console.log(`   Total events: ${total}`);
    console.log(`   Events with NULL uuid column: ${null_uuid}`);
    console.log(`   Events needing backfill: ${needs_backfill}`);
    console.log('');

    if (parseInt(needs_backfill) === 0) {
      console.log('✅ No events need backfilling. All done!');
      client.release();
      await pool.end();
      return;
    }

    // Perform the backfill (excluding empty strings to match extractEventUuid behavior)
    console.log('🔄 Backfilling uuid column from eventData...');
    const updateResult = await client.query(`
      UPDATE events
      SET uuid = event_data->>'uuid'
      WHERE uuid IS NULL
        AND event_data->>'uuid' IS NOT NULL
        AND event_data->>'uuid' != ''
    `);

    console.log(`✅ Updated ${updateResult.rowCount} events`);
    console.log('');

    // Verify the results
    console.log('📊 Verifying results...');
    const verifyResult = await client.query(`
      SELECT COUNT(*) FILTER (WHERE uuid IS NULL AND event_data->>'uuid' IS NOT NULL AND event_data->>'uuid' != '') as remaining
      FROM events
    `);

    const remaining = parseInt(verifyResult.rows[0].remaining);
    if (remaining === 0) {
      console.log('✅ Backfill complete! All events with UUIDs are now indexed.');
    } else {
      console.log(`⚠️  ${remaining} events still need backfilling (unexpected)`);
    }

    client.release();
    await pool.end();
    console.log('');
    console.log('Done!');
  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

main();

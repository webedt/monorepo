#!/usr/bin/env tsx
/**
 * Seed Default Community Channels
 *
 * Creates the default platform channels (#general, #announcements) if they don't exist.
 * Usage: npm run db:seed-channels
 */

import 'dotenv/config';
import {
  db,
  communityChannels,
  eq,
} from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

interface DefaultChannel {
  name: string;
  slug: string;
  description: string;
  isDefault: boolean;
  isReadOnly: boolean;
  sortOrder: number;
}

const DEFAULT_CHANNELS: DefaultChannel[] = [
  {
    name: 'announcements',
    slug: 'announcements',
    description: 'Official platform updates and announcements',
    isDefault: true,
    isReadOnly: true,
    sortOrder: 0,
  },
  {
    name: 'general',
    slug: 'general',
    description: 'General discussion',
    isDefault: true,
    isReadOnly: false,
    sortOrder: 1,
  },
];

async function seedChannels(): Promise<void> {
  console.log('');
  console.log('Seeding default community channels...');
  console.log('═'.repeat(50));
  console.log('');

  let created = 0;
  let skipped = 0;

  for (const channel of DEFAULT_CHANNELS) {
    // Check if channel already exists
    const [existing] = await db
      .select()
      .from(communityChannels)
      .where(eq(communityChannels.slug, channel.slug))
      .limit(1);

    if (existing) {
      console.log(`  [skip] #${channel.slug} already exists`);
      skipped++;
    } else {
      // Create the channel
      await db.insert(communityChannels).values({
        id: uuidv4(),
        name: channel.name,
        slug: channel.slug,
        description: channel.description,
        gameId: null,
        isDefault: channel.isDefault,
        isReadOnly: channel.isReadOnly,
        sortOrder: channel.sortOrder,
        status: 'active',
      });
      console.log(`  [created] #${channel.slug} - ${channel.description}`);
      created++;
    }
  }

  console.log('');
  console.log('═'.repeat(50));
  console.log(`Done! Created: ${created}, Skipped: ${skipped}`);
  console.log('');
}

async function main(): Promise<void> {
  try {
    await seedChannels();
    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('Failed to seed channels:', error);
    process.exit(1);
  }
}

main();

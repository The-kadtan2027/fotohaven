/**
 * Seed script — creates or updates the admin photographer account.
 * 
 * Usage:
 *   1. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env.local
 *   2. Run: npm run seed
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually (no dotenv dependency needed)
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../src/lib/db';
import { photographers } from '../src/lib/schema';
import { eq } from 'drizzle-orm';

async function seed() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.error('❌ ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env.local');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Check if photographer already exists
  const existing = db
    .select()
    .from(photographers)
    .where(eq(photographers.username, username))
    .get();

  if (existing) {
    // Update password hash
    db.update(photographers)
      .set({ passwordHash })
      .where(eq(photographers.username, username))
      .run();
    console.log(`✅ Updated password for photographer "${username}"`);
  } else {
    // Insert new photographer
    db.insert(photographers)
      .values({
        id: uuidv4(),
        username,
        passwordHash,
        createdAt: new Date(),
      })
      .run();
    console.log(`✅ Created photographer "${username}"`);
  }
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});

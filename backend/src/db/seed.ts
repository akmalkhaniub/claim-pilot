import bcrypt from 'bcryptjs';
import { pool, query } from '../config/db.js';

async function seed() {
  console.log('[Seed]: Starting database seeding...');
  
  try {
    // Clear existing users
    await query('DELETE FROM users');
    console.log('[Seed]: Cleared existing users.');

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('password123', salt);

    // Seed Claimant
    const claimantResult = await query(
      `INSERT INTO users (email, password_hash, role, full_name) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, email, role`,
      ['claimant@claimpilot.com', passwordHash, 'claimant', 'John Doe (Claimant)']
    );
    console.log('[Seed]: Created claimant:', claimantResult.rows[0]);

    // Seed Adjuster
    const adjusterResult = await query(
      `INSERT INTO users (email, password_hash, role, full_name) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, email, role`,
      ['adjuster@claimpilot.com', passwordHash, 'adjuster', 'Alice Smith (Adjuster)']
    );
    console.log('[Seed]: Created adjuster:', adjusterResult.rows[0]);

    console.log('[Seed]: Database seeding completed successfully.');
  } catch (error) {
    console.error('[Seed]: Seeding failed:', error);
  } finally {
    await pool.end();
    console.log('[Seed]: Database pool closed.');
  }
}

seed();

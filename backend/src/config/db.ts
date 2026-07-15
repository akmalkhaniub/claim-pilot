import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is missing.');
}

export const pool = new Pool({
  connectionString,
  // Adjust pool limits for production/development usage
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  // Optional query logging for development
  if (process.env.NODE_ENV !== 'production') {
    console.log('Executed query', { text, duration, rows: res.rowCount });
  }
  return res;
};

// Run database schema migrations
const runMigrations = async () => {
  try {
    await pool.query(`
      ALTER TABLE claims ADD COLUMN IF NOT EXISTS human_takeover BOOLEAN DEFAULT FALSE;
    `);
    console.log('[Database]: Migrations completed successfully (human_takeover column verified).');
  } catch (err) {
    console.error('[Database]: Migrations failed:', err);
  }
};
runMigrations();


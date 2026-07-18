import 'dotenv/config';
import { createDatabase } from '@applypilot/database';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

export const db = createDatabase(connectionString);

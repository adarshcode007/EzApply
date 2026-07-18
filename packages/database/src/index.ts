import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from './schema/index.js';

export * from './schema/index.js';

export const createDatabase = (connectionString: string) => {
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
};

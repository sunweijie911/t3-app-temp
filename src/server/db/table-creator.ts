import { pgTableCreator } from 'drizzle-orm/pg-core';

// Business tables use a "pg-drizzle_" prefix to avoid naming conflicts.
export const createTable = pgTableCreator((name) => `pg-drizzle_${name}`);

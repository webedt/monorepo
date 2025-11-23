// Database configuration
export const USE_SQLITE = !process.env.DATABASE_URL || process.env.USE_SQLITE === 'true';

console.log(`Using ${USE_SQLITE ? 'SQLite (in-memory)' : 'PostgreSQL'} database`);

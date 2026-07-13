/**
 * Shared schema for the Mercury apps. Import these tables into an app's drizzle client and
 * foreign-key your own tables to `user`. mercury-core owns the migrations for them.
 */
export * from './schema.js';

import { defineConfig } from 'vitest/config';

// Tests live next to the source they cover (src/**/*.test.ts) and import from vitest explicitly
// (no globals), so the build tsconfig can exclude them and keep dist/ free of test code.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			// schema.ts is declarative table data (its only "functions" are drizzle's lazy default/FK
			// callbacks, never invoked here), and db/cardano index files are pure re-export barrels;
			// neither holds branching logic, so they're regression-tested for shape but kept out of the
			// coverage denominator. auth/index.ts is real logic and stays in.
			exclude: ['src/db/index.ts', 'src/cardano/index.ts', 'src/db/schema.ts', 'src/**/*.test.ts'],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100
			}
		}
	}
});

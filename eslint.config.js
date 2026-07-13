import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Flat config. Formatting is Prettier's job (eslint-config-prettier turns off any rule that would
// fight it), so ESLint here is purely about correctness/quality rules. The @typescript-eslint
// recommended set is what makes the `no-explicit-any` disable directives in the source meaningful.
export default tseslint.config(
	{ ignores: ['dist', 'coverage', 'node_modules'] },
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		files: ['**/*.ts'],
		// TypeScript already resolves globals (Buffer, fetch, setTimeout, ...) and undefined
		// identifiers, so no-undef is redundant and misfires on TS-only syntax.
		rules: { 'no-undef': 'off' }
	},
	{
		// The bin entry point is plain Node ESM, not TypeScript, so nothing else teaches ESLint that
		// `process` and `console` exist here.
		files: ['bin/**/*.js'],
		languageOptions: {
			globals: { process: 'readonly', console: 'readonly' }
		}
	},
	prettier
);

import { describe, it, expect } from 'vitest';
import { formatAda, LOVELACE_PER_ADA } from './money';

describe('LOVELACE_PER_ADA', () => {
	it('is one million lovelace', () => {
		expect(LOVELACE_PER_ADA).toBe(1_000_000n);
	});
});

describe('formatAda', () => {
	// Happy path: the defaults a display caller relies on (6 decimals, grouped thousands).
	it('formats a whole-ADA amount with six decimals and grouping by default', () => {
		expect(formatAda(1_000_000n)).toBe('1.000000');
		expect(formatAda(1_234_567_000_000n)).toBe('1,234,567.000000');
	});

	it('keeps the fractional lovelace, padded to six places', () => {
		expect(formatAda(1_500_000n)).toBe('1.500000');
		expect(formatAda(1n)).toBe('0.000001');
		expect(formatAda(0n)).toBe('0.000000');
	});

	it('honours a custom decimals count', () => {
		expect(formatAda(1_234_567n, { decimals: 2 })).toBe('1.23');
		expect(formatAda(1_000_000n, { decimals: 0 })).toBe('1');
	});

	it('omits grouping separators when group is false (for CSV cells)', () => {
		expect(formatAda(1_234_567_000_000n, { group: false })).toBe('1234567.000000');
	});

	// Unhappy path: negative balances (e.g. a net-outflow row) keep a single leading sign.
	it('formats negative amounts with a single leading minus', () => {
		expect(formatAda(-1_500_000n)).toBe('-1.500000');
		expect(formatAda(-1_234_567_000_000n)).toBe('-1,234,567.000000');
		expect(formatAda(-1n)).toBe('-0.000001');
	});

	// Regression: the fraction is truncated, never rounded — locking this so a "tidy up" refactor
	// that swaps in rounding can't silently change reported balances.
	it('truncates the fraction rather than rounding it', () => {
		// 0.999999 ADA shown to 2 places is 0.99, not 1.00.
		expect(formatAda(999_999n, { decimals: 2 })).toBe('0.99');
		expect(formatAda(1_234_567n, { decimals: 4 })).toBe('1.2345');
	});

	// Regression: asking for more precision than lovelace carries pads with trailing zeros rather
	// than inventing digits.
	it('pads with trailing zeros when more than six decimals are requested', () => {
		expect(formatAda(1_234_567n, { decimals: 8 })).toBe('1.23456700');
	});
});

export const LOVELACE_PER_ADA = 1_000_000n;

/**
 * Format a lovelace amount as ADA. Defaults to 6 decimals with thousands separators for display;
 * pass `group: false` for CSV cells so the separators don't fight the delimiter.
 */
export function formatAda(
	lovelace: bigint,
	opts: { decimals?: number; group?: boolean } = {}
): string {
	const decimals = opts.decimals ?? 6;
	const group = opts.group ?? true;

	const negative = lovelace < 0n;
	const abs = negative ? -lovelace : lovelace;
	const whole = abs / LOVELACE_PER_ADA;
	const frac = abs % LOVELACE_PER_ADA;

	let wholeStr = whole.toString();
	if (group) wholeStr = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

	let out = wholeStr;
	if (decimals > 0) {
		const fracStr = frac.toString().padStart(6, '0').slice(0, decimals).padEnd(decimals, '0');
		out = `${wholeStr}.${fracStr}`;
	}
	return negative ? `-${out}` : out;
}

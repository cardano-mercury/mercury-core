import { resolveRewardAddress } from '@meshsdk/core';

const cache = new Map<string, string | null>();

/**
 * The bech32 reward (stake) address for a payment address, or null if it has no staking part
 * (enterprise/script/byron addresses) or can't be parsed. Cached, since transactions reuse the
 * same addresses heavily. This is how we tell whether a UTxO belongs to a wallet: a base address
 * is ours when its reward address matches the wallet's stake key, regardless of which payment
 * address it is.
 */
export function rewardAddressOf(address: string): string | null {
	const cached = cache.get(address);
	if (cached !== undefined) return cached;

	let result: string | null = null;
	try {
		result = resolveRewardAddress(address);
	} catch {
		result = null;
	}
	cache.set(address, result);
	return result;
}

/**
 * Build an ownership predicate for a wallet: an address is ours if it is the exact tracked address
 * or shares the wallet's stake key.
 */
export function makeOwnershipTest(bech32: string, stakeKey: string | null) {
	return (address: string): boolean =>
		address === bech32 || (stakeKey !== null && rewardAddressOf(address) === stakeKey);
}

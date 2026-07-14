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

	let result: string | null;
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
 * or shares the wallet's stake key. Use it to answer **membership** — "is this address ours?" — which
 * is what internal-versus-external classification needs.
 *
 * It does **not** answer **attribution**: "which bucket, account or wallet does this address belong
 * to?" Those are different questions and a stake key does not settle the second one. A treasury
 * commonly runs one stake key across several payment addresses, one per bucket or per account, so
 * matching an undeclared sibling address to a label by its stake key can merge things that were
 * deliberately kept apart — and the total still balances, so a test of the total will not catch it.
 *
 * Attribution belongs to the caller, which knows what it declared. The rule tokenomics settled on,
 * and the one to copy: an undeclared sibling resolves to a label only when that stake key has exactly
 * one label behind it, and is left unassigned otherwise. Unassigned is the honest answer when the
 * declarations say the key spans several; guessing is not.
 */
export function makeOwnershipTest(bech32: string, stakeKey: string | null) {
	return (address: string): boolean =>
		address === bech32 || (stakeKey !== null && rewardAddressOf(address) === stakeKey);
}

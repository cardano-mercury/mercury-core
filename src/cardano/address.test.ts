import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rewardAddressOf, makeOwnershipTest } from './address';

// resolveRewardAddress is the one piece of @meshsdk/core these helpers lean on; mock it so the
// tests are deterministic and don't pull in the full Cardano serialisation stack.
const { resolveRewardAddress } = vi.hoisted(() => ({ resolveRewardAddress: vi.fn() }));
vi.mock('@meshsdk/core', () => ({ resolveRewardAddress }));

beforeEach(() => {
	resolveRewardAddress.mockReset();
});

// The module under test keeps a process-wide cache keyed by address, so every test uses a unique
// address string to stay isolated from the others.
let n = 0;
const freshAddress = () => `addr_test_${n++}`;

describe('rewardAddressOf', () => {
	// Happy path: a base address resolves to its bech32 stake address.
	it('returns the resolved reward address', () => {
		const addr = freshAddress();
		resolveRewardAddress.mockReturnValue('stake1_resolved');
		expect(rewardAddressOf(addr)).toBe('stake1_resolved');
		expect(resolveRewardAddress).toHaveBeenCalledWith(addr);
	});

	// Unhappy path: enterprise/script/byron addresses (no staking part) or junk make mesh throw;
	// we swallow that and report "no stake key" as null rather than propagating.
	it('returns null when resolution throws', () => {
		const addr = freshAddress();
		resolveRewardAddress.mockImplementation(() => {
			throw new Error('no staking part');
		});
		expect(rewardAddressOf(addr)).toBeNull();
	});

	// Regression: results are cached so paging a wallet's history doesn't re-resolve the same
	// address thousands of times.
	it('caches a successful lookup and does not re-resolve', () => {
		const addr = freshAddress();
		resolveRewardAddress.mockReturnValue('stake1_cached');
		expect(rewardAddressOf(addr)).toBe('stake1_cached');
		expect(rewardAddressOf(addr)).toBe('stake1_cached');
		expect(resolveRewardAddress).toHaveBeenCalledTimes(1);
	});

	// Regression: null is a real cached value, not a cache miss — a non-staking address must not be
	// retried on every UTxO it appears in.
	it('caches a null result too', () => {
		const addr = freshAddress();
		resolveRewardAddress.mockImplementation(() => {
			throw new Error('no staking part');
		});
		expect(rewardAddressOf(addr)).toBeNull();
		expect(rewardAddressOf(addr)).toBeNull();
		expect(resolveRewardAddress).toHaveBeenCalledTimes(1);
	});
});

describe('makeOwnershipTest', () => {
	// Happy path: the exact tracked address is always ours, even with no known stake key.
	it('matches the exact tracked address regardless of stake key', () => {
		const isOurs = makeOwnershipTest('addr_tracked', null);
		expect(isOurs('addr_tracked')).toBe(true);
	});

	// Happy path: a different payment address under the same wallet is ours via its stake key.
	it('matches any address sharing the wallet stake key', () => {
		const other = freshAddress();
		resolveRewardAddress.mockReturnValue('stake1_wallet');
		const isOurs = makeOwnershipTest('addr_tracked', 'stake1_wallet');
		expect(isOurs(other)).toBe(true);
	});

	// Unhappy path: an address with a different stake key is not ours.
	it('rejects an address with a different stake key', () => {
		const other = freshAddress();
		resolveRewardAddress.mockReturnValue('stake1_someone_else');
		const isOurs = makeOwnershipTest('addr_tracked', 'stake1_wallet');
		expect(isOurs(other)).toBe(false);
	});

	// Regression: with a null wallet stake key, ownership collapses to exact-address only — a
	// non-tracked address must never be claimed just because its reward address is also null.
	it('never matches by stake key when the wallet stake key is null', () => {
		const other = freshAddress();
		resolveRewardAddress.mockImplementation(() => {
			throw new Error('no staking part');
		});
		const isOurs = makeOwnershipTest('addr_tracked', null);
		expect(isOurs(other)).toBe(false);
	});
});

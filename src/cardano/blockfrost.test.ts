import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	BlockfrostClient,
	BlockfrostError,
	ADA_HANDLE_POLICY,
	type Network
} from './blockfrost.js';

// A minimal fetch double. Each queued response describes one HTTP reply; the mock shifts through
// them call by call so a test can script "429, then 200".
interface FakeResponse {
	ok?: boolean;
	status?: number;
	json?: unknown;
	text?: string;
	headers?: Record<string, string>;
}

function queueFetch(responses: FakeResponse[]) {
	const calls: URL[] = [];
	const fetchMock = vi.fn(async (url: URL) => {
		calls.push(url);
		const r = responses.shift();
		if (!r) throw new Error(`unexpected fetch call to ${url}`);
		const status = r.status ?? (r.ok === false ? 500 : 200);
		return {
			ok: r.ok ?? (status >= 200 && status < 300),
			status,
			json: async () => r.json,
			text: async () => r.text ?? '',
			headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null }
		};
	});
	vi.stubGlobal('fetch', fetchMock);
	return { calls, fetchMock };
}

beforeEach(() => {
	vi.unstubAllGlobals();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('BlockfrostError', () => {
	it('carries status/path and builds a descriptive message', () => {
		const err = new BlockfrostError(404, '/addresses/x', 'not found');
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe('BlockfrostError');
		expect(err.status).toBe(404);
		expect(err.path).toBe('/addresses/x');
		expect(err.message).toBe('Blockfrost 404 on /addresses/x: not found');
	});
});

describe('BlockfrostClient constructor', () => {
	it('accepts each supported network', () => {
		for (const network of ['mainnet', 'preview', 'preprod'] as Network[]) {
			expect(() => new BlockfrostClient(network, 'proj')).not.toThrow();
		}
	});

	// Unhappy path: a bad network (only reachable by callers ignoring the type) fails loudly.
	it('rejects an unsupported network', () => {
		expect(() => new BlockfrostClient('testnet' as Network, 'proj')).toThrow(
			'Unsupported Blockfrost network: testnet'
		);
	});

	// Unhappy path: an empty project id would 403 on every call, so reject it up front.
	it('rejects a missing project id', () => {
		expect(() => new BlockfrostClient('mainnet', '')).toThrow(
			'Blockfrost project id is required'
		);
	});
});

describe('BlockfrostClient.get (via getAddress)', () => {
	it('returns parsed JSON on success and sends auth headers to the right URL', async () => {
		const { fetchMock } = queueFetch([{ json: { address: 'addr1', amount: [] } }]);
		const client = new BlockfrostClient('mainnet', 'proj_id');
		const info = await client.getAddress('addr1');

		expect(info).toEqual({ address: 'addr1', amount: [] });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
		expect(url.toString()).toBe('https://cardano-mainnet.blockfrost.io/api/v0/addresses/addr1');
		expect(init.headers).toMatchObject({ project_id: 'proj_id', accept: 'application/json' });
	});

	// Unhappy path: a 4xx other than 429 is terminal — surface it as a BlockfrostError immediately.
	it('throws BlockfrostError on a non-retryable status without retrying', async () => {
		const { fetchMock } = queueFetch([{ status: 404, text: 'not found' }]);
		const client = new BlockfrostClient('preprod', 'proj');
		await expect(client.getAddress('missing')).rejects.toMatchObject({
			name: 'BlockfrostError',
			status: 404,
			message: 'Blockfrost 404 on /addresses/missing: not found'
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	// Happy-ish path: a 429 is retried after backoff and then succeeds.
	it('retries on 429 and succeeds, backing off exponentially without a retry-after header', async () => {
		vi.useFakeTimers();
		const { fetchMock } = queueFetch([
			{ status: 429, text: 'slow down' },
			{ json: { ok: true } }
		]);
		const client = new BlockfrostClient('mainnet', 'proj');
		const promise = client.getAddress('addr1');
		// First attempt (0) failed; default backoff is min(500 * 2**0, 10000) = 500ms.
		await vi.advanceTimersByTimeAsync(500);
		await expect(promise).resolves.toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('retries on a 5xx server error', async () => {
		vi.useFakeTimers();
		const { fetchMock } = queueFetch([{ status: 503, text: 'down' }, { json: { ok: true } }]);
		const client = new BlockfrostClient('mainnet', 'proj');
		const promise = client.getAddress('addr1');
		await vi.advanceTimersByTimeAsync(500);
		await expect(promise).resolves.toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	// Regression: a numeric retry-after header (seconds) drives the delay instead of the backoff.
	it('honours the retry-after header in seconds', async () => {
		vi.useFakeTimers();
		const { fetchMock } = queueFetch([
			{ status: 429, headers: { 'retry-after': '2' }, text: 'slow down' },
			{ json: { ok: true } }
		]);
		const client = new BlockfrostClient('mainnet', 'proj');
		const promise = client.getAddress('addr1');
		// Still pending one millisecond before the 2s the server asked for.
		await vi.advanceTimersByTimeAsync(1999);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		await expect(promise).resolves.toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	// Unhappy path: persistent failure gives up after the attempt cap and throws the last error.
	it('gives up after the maximum number of attempts', async () => {
		vi.useFakeTimers();
		const { fetchMock } = queueFetch(
			Array.from({ length: 6 }, () => ({ status: 500, text: 'still down' }))
		);
		const client = new BlockfrostClient('mainnet', 'proj');
		const promise = client.getAddress('addr1');
		const assertion = expect(promise).rejects.toMatchObject({ status: 500 });
		// Drain every backoff window; delays cap at 10s.
		await vi.advanceTimersByTimeAsync(10_000 * 6);
		await assertion;
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});
});

describe('query parameter handling', () => {
	it('sends from/to when provided and omits them otherwise', async () => {
		const { calls } = queueFetch([{ json: [] }, { json: [] }]);
		const client = new BlockfrostClient('mainnet', 'proj');

		await client.getAddressTransactions('addr1', { from: '123', to: 456 });
		expect(calls[0].searchParams.get('from')).toBe('123');
		expect(calls[0].searchParams.get('to')).toBe('456');

		await client.getAddressTransactions('addr1');
		expect(calls[1].searchParams.has('from')).toBe(false);
		expect(calls[1].searchParams.has('to')).toBe(false);
	});

	// Regression: empty-string params are treated as "unset", not sent as `?x=`.
	it('drops empty-string parameters', async () => {
		const { calls } = queueFetch([{ json: [] }]);
		const client = new BlockfrostClient('mainnet', 'proj');
		await client.getAddressTransactions('addr1', { from: '', to: undefined });
		expect(calls[0].searchParams.has('from')).toBe(false);
		expect(calls[0].searchParams.has('to')).toBe(false);
	});
});

describe('endpoint methods hit the documented paths', () => {
	it.each([
		['getAddress', (c: BlockfrostClient) => c.getAddress('a'), '/addresses/a'],
		['getTransaction', (c: BlockfrostClient) => c.getTransaction('h'), '/txs/h'],
		[
			'getTransactionWithdrawals',
			(c: BlockfrostClient) => c.getTransactionWithdrawals('h'),
			'/txs/h/withdrawals'
		],
		[
			'getTransactionUtxos',
			(c: BlockfrostClient) => c.getTransactionUtxos('h'),
			'/txs/h/utxos'
		],
		[
			'getAssetAddresses',
			(c: BlockfrostClient) => c.getAssetAddresses('asset1'),
			'/assets/asset1/addresses'
		],
		[
			'getAddressTransactions',
			(c: BlockfrostClient) => c.getAddressTransactions('a'),
			'/addresses/a/transactions'
		]
	])('%s', async (_name, call, expectedPath) => {
		const { calls } = queueFetch([{ json: {} }]);
		const client = new BlockfrostClient('mainnet', 'proj');
		await call(client);
		expect(calls[0].pathname).toBe(`/api/v0${expectedPath}`);
	});
});

describe('resolveHandle', () => {
	// Happy path: strips $, lowercases, hex-encodes the name onto the policy id, returns the holder.
	it('resolves a handle to the holding address', async () => {
		const { calls } = queueFetch([{ json: [{ address: 'addr_holder', quantity: '1' }] }]);
		const client = new BlockfrostClient('mainnet', 'proj');
		const address = await client.resolveHandle('$Alice');

		expect(address).toBe('addr_holder');
		const expectedAssetName = Buffer.from('alice', 'utf8').toString('hex');
		expect(calls[0].pathname).toBe(
			`/api/v0/assets/${ADA_HANDLE_POLICY}${expectedAssetName}/addresses`
		);
	});

	it('works without a leading $', async () => {
		const { calls } = queueFetch([{ json: [{ address: 'addr_holder', quantity: '1' }] }]);
		const client = new BlockfrostClient('mainnet', 'proj');
		await client.resolveHandle('bob');
		const expectedAssetName = Buffer.from('bob', 'utf8').toString('hex');
		expect(calls[0].pathname).toContain(expectedAssetName);
	});

	// Unhappy path: an unminted/unheld handle has no holders, so report it clearly.
	it('throws when no address holds the handle', async () => {
		queueFetch([{ json: [] }]);
		const client = new BlockfrostClient('mainnet', 'proj');
		await expect(client.resolveHandle('$ghost')).rejects.toThrow(
			'No address holds the handle $ghost'
		);
	});
});

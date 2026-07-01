/**
 * Thin Blockfrost REST client. Framework-agnostic: network and project id are passed in, so each
 * app supplies them from its own environment. Amounts are returned as the raw strings Blockfrost
 * sends; callers parse them to BigInt.
 */

export type Network = 'mainnet' | 'preview' | 'preprod';

const ENDPOINTS: Record<Network, string> = {
	mainnet: 'https://cardano-mainnet.blockfrost.io/api/v0',
	preview: 'https://cardano-preview.blockfrost.io/api/v0',
	preprod: 'https://cardano-preprod.blockfrost.io/api/v0'
};

/** Mainnet ADA Handle policy id. */
export const ADA_HANDLE_POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';

export interface Amount {
	unit: string;
	quantity: string;
}

export interface AddressInfo {
	address: string;
	stake_address: string | null;
	type: string;
	amount: Amount[];
}

export interface AddressTransaction {
	tx_hash: string;
	tx_index: number;
	block_height: number;
	block_time: number;
}

export interface TransactionDetail {
	hash: string;
	block: string;
	block_height: number;
	block_time: number;
	slot: number;
	index: number;
	output_amount: Amount[];
	fees: string;
	deposit: string;
	size: number;
	invalid_before: string | null;
	invalid_hereafter: string | null;
	utxo_count: number;
	withdrawal_count: number;
	mir_cert_count: number;
	delegation_count: number;
	stake_cert_count: number;
	pool_update_count: number;
	pool_retire_count: number;
	asset_mint_or_burn_count: number;
	redeemer_count: number;
	valid_contract: boolean;
}

export interface TransactionWithdrawal {
	address: string;
	amount: string;
}

export interface UtxoInput {
	address: string;
	amount: Amount[];
	tx_hash: string;
	output_index: number;
	collateral: boolean;
	reference: boolean;
}

export interface UtxoOutput {
	address: string;
	amount: Amount[];
	output_index: number;
	collateral: boolean;
}

export interface TransactionUtxos {
	hash: string;
	inputs: UtxoInput[];
	outputs: UtxoOutput[];
}

export class BlockfrostError extends Error {
	constructor(
		public status: number,
		public path: string,
		message: string
	) {
		super(`Blockfrost ${status} on ${path}: ${message}`);
		this.name = 'BlockfrostError';
	}
}

export class BlockfrostClient {
	private readonly endpoint: string;
	private readonly projectId: string;

	constructor(network: Network, projectId: string) {
		const endpoint = ENDPOINTS[network];
		if (!endpoint) throw new Error(`Unsupported Blockfrost network: ${network}`);
		if (!projectId) throw new Error('Blockfrost project id is required');
		this.endpoint = endpoint;
		this.projectId = projectId;
	}

	private async get<T>(
		path: string,
		query?: Record<string, string | number | undefined>
	): Promise<T> {
		const url = new URL(`${this.endpoint}${path}`);
		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== undefined && value !== null && value !== '') {
				url.searchParams.set(key, String(value));
			}
		}

		// Retry on rate limits (429) and transient server errors with exponential backoff, since
		// paging a wallet's full history makes many calls and will brush against Blockfrost limits.
		const maxAttempts = 6;
		for (let attempt = 0; ; attempt++) {
			const res = await fetch(url, {
				headers: { project_id: this.projectId, accept: 'application/json' }
			});

			if (res.ok) return (await res.json()) as T;

			const retryable = res.status === 429 || res.status >= 500;
			if (!retryable || attempt >= maxAttempts - 1) {
				throw new BlockfrostError(res.status, path, await res.text());
			}

			const retryAfter = Number(res.headers.get('retry-after'));
			const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(500 * 2 ** attempt, 10000);
			await new Promise((r) => setTimeout(r, delay));
		}
	}

	getAddress(address: string): Promise<AddressInfo> {
		return this.get<AddressInfo>(`/addresses/${address}`);
	}

	/**
	 * One page (up to 100) of an address's transactions, oldest first within the block range. Pass
	 * `from` as a block height (or `height:txindex`) to fetch only what is newer than the last sync.
	 */
	getAddressTransactions(
		address: string,
		opts: { from?: string | number; to?: string | number } = {}
	): Promise<AddressTransaction[]> {
		return this.get<AddressTransaction[]>(`/addresses/${address}/transactions`, {
			from: opts.from,
			to: opts.to
		});
	}

	getTransaction(hash: string): Promise<TransactionDetail> {
		return this.get<TransactionDetail>(`/txs/${hash}`);
	}

	getTransactionWithdrawals(hash: string): Promise<TransactionWithdrawal[]> {
		return this.get<TransactionWithdrawal[]>(`/txs/${hash}/withdrawals`);
	}

	getTransactionUtxos(hash: string): Promise<TransactionUtxos> {
		return this.get<TransactionUtxos>(`/txs/${hash}/utxos`);
	}

	getAssetAddresses(asset: string): Promise<{ address: string; quantity: string }[]> {
		return this.get<{ address: string; quantity: string }[]>(`/assets/${asset}/addresses`);
	}

	/** Resolve an ADA Handle (with or without the leading $) to the address that currently holds it. */
	async resolveHandle(handle: string): Promise<string> {
		const name = handle.replace(/^\$/, '').toLowerCase();
		const assetName = Buffer.from(name, 'utf8').toString('hex');
		const holders = await this.getAssetAddresses(`${ADA_HANDLE_POLICY}${assetName}`);
		if (!holders.length) throw new Error(`No address holds the handle $${name}`);
		return holders[0].address;
	}
}

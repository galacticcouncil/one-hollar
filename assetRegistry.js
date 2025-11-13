import { AssetClient } from '@galacticcouncil/sdk';
import { strict as assert } from 'node:assert';

export class AssetRegistry {
	#api;
	#assets;

	constructor(api) {
		this.#api = new AssetClient(api);
		this.#assets = {};
	}

	decimals(assetId) {
		assert.ok(this.#assets, "asset registry is undefined");
		const asset = this.#assets[assetId];
		assert.ok(asset, `missing asset=${assetId}`);
		assert.ok(asset.decimals && asset.decimals > 0, `invalid asset decimals, asset=${assetId}, decimals=${asset.decimals}`);

		return asset.decimals;
	}
	
	symbol(assetId) {
		assert.ok(this.#assets, "asset registry is undefined");
		const asset = this.#assets[assetId];
		assert.ok(asset, `missing asset=${assetId}`);
		assert.ok(asset.symbol && asset.symbol != "", `invalid asset symbol, asset=${assetId}, symbol=${asset.symbol}`);

		return asset.symbol;
	}

	async update() {
		const assets = await this.#api.getOnChainAssets();
		assets.forEach(a => {
			this.#assets[a.id] = a;
		});
	}
}

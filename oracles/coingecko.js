import assert from 'node:assert';
import Big from 'big.js';
import { min } from '../utils.js';

// ~0.01$ pre week(100_800 blocks)
const PRICE_UPDATE = new Big("0.0000001");

//TODO: implement pro-api with api-key
export class CoinGecko {
	_url;
	_cooldown;
	_updatedAt = 0;
	_lastPrices = {};
	_precission;

	_coinGeckoSusdeId;
	_coinGeckoSusdsId;

	// assets ids used as a keys(hydration's asset ids)
	_SUSDE;
	_SUSDS;
	_USDT;
	_USDC;

	//Oracle providing prices for sUSDe and sUSDS
	constructor(config)	 {
		this._url = config.coinGecko.url;
		this._cooldown = config.coinGecko.cooldown;
		this._precission = config.coinGecko.precission;

		this._coinGeckoSusdeId = config.coinGecko.sUSDe;
		this._coinGeckoSusdsId = config.coinGecko.sUSDS;

		this._SUSDE = config.assets.sUSDe.assetId;
		this._SUSDS = config.assets.sUSDS.assetId;
		this._USDT = config.assets.USDT.assetId;
		this._USDC = config.assets.USDC.assetId;

		this._lastPrices[this._USDT] = new Big("1.0");
		this._lastPrices[this._USDC] = new Big("1.0");
		this._lastPrices[this._SUSDS] = new Big(0);
		this._lastPrices[this._SUSDE] = new Big(0);
	}

	// Function pull prices from CoinGEcko and initialize oracle's internal state.
	// This function should be called before using oracle.
	async init(currentBlock) {
		const data = await this._pullOracleData(currentBlock);

		const susdsPrice = new Big(data[this._coinGeckoSusdsId].usd.toFixed(this._precission));
		const susdePrice = new Big(data[this._coinGeckoSusdeId].usd.toFixed(this._precission));

		this._lastPrices[this._SUSDE] = susdePrice;
		this._lastPrices[this._SUSDS] = susdsPrice;

		this._updatedAt = currentBlock;
	}

	//Function pulls prices from coinGecko for sUSDe and sUSDS and updates internal state.
	//Update happen only after cooldown period.
	async updateUSDPrices(currentBlock) {
		if ((currentBlock - this._updatedAt) < this._cooldown) {
			return;
		}

		const data = await this._pullOracleData();
		this._updateOracleData(data, currentBlock);
	}

	async _pullOracleData() {
		const res = await fetch(`${this._url}/price?vs_currencies=usd&ids=${this._coinGeckoSusdeId}%2C${this._coinGeckoSusdsId}&precision=${this._precission}`, { method: "GET" });
		if (!res.ok) {
			console.error(`ERROR: to pull pricess from CoinGecko. status_code=${res.status}, data=${JSON.Stringify(await res.json())}`)
			throw new Error("request failed");
		}

		return await res.json();
	}

	_updateOracleData(data, blockNumber) {
		const elapsedBlocks = new Big(blockNumber - this._updatedAt);
		const maxPriceChange = PRICE_UPDATE.mul(elapsedBlocks);

		const susdsPrice = new Big(new Big(data[this._coinGeckoSusdsId].usd).toFixed(this._precission));
		if (susdsPrice.gt(this._lastPrices[this._SUSDS])) {
			const priceDiff = (this._lastPrices[this._SUSDS].minus(susdsPrice)).abs();

			this._lastPrices[this._SUSDS] = this._lastPrices[this._SUSDS].plus(min(priceDiff, maxPriceChange));
		} else {
			console.log(`INFO(sUSDS): price mismatch, last_price=${this._lastPrices[this._SUSDS].toFixed(8)}, oracle_price=${susdsPrice.toFixed(8)}`);
		}

		const susdePrice = new Big(new Big(data[this._coinGeckoSusdeId].usd).toFixed(this._precission));
		if (susdePrice.gt(this._lastPrices[this._SUSDE])) {
			const priceDiff = (this._lastPrices[this._SUSDE].minus(susdePrice)).abs();

			this._lastPrices[this._SUSDE] = this._lastPrices[this._SUSDE].plus(min(priceDiff, maxPriceChange));
		} else {
			console.log(`INFO(sUSDe): price mismatch, last_price=${this._lastPrices[this._SUSDE].toFixed(8)}, oracle_price=${susdePrice.toFixed(8)}`);
		}

		this._updatedAt = blockNumber
	}

	getUSDPrice(assetId) {
		const p = this._lastPrices[assetId];
		assert.ok(p, `unknown price for asset: ${assetId}`);

		return p
	}
}

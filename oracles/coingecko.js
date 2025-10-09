import assert from 'node:assert';
import Big from 'big.js';
import { min } from '../utils.js';

// ~0.01$ pre week(100_800 blocks)
const PRICE_UPDATE_SPEED = new Big("0.0000001");
const REQ_FAILED_ERR_MSG = "request failed";
//Max. amount of consecutive failed request.
const MAX_FAILED_REQ = 3;

//TODO: implement pro-api with api-key
export class CoinGecko {
	_url;
	_cooldown;
	_updatedAt = 0;
	_lastPrices = {};
	_precision;
	_failedReqCount = 0;

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
		this._precision = config.coinGecko.precision;

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

	// Function pulls prices from CoinGecko and initialize oracle's internal state.
	// This function should be called before oracle is used.
	// This function doesn't do prices smoothing.
	async init(currentBlock) {
		//NOTE: we want to panic here as we can't run strategy with 0 prices
		const data = await this._pullOracleData();

		const susdsPrice = new Big(data[this._coinGeckoSusdsId].usd.toFixed(this._precision));
		const susdePrice = new Big(data[this._coinGeckoSusdeId].usd.toFixed(this._precision));

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

		let data;
		try {
			data = await this._pullOracleData();
		} catch(err) {
			if (err.message == REQ_FAILED_ERR_MSG) {
				this._failedReqCount += 1;
				if (this._failedReqCount <= MAX_FAILED_REQ) {
					return;
				}
			}

			throw err;
		}
		this._failedReqCount = 0
		this._updateOracleData(data, currentBlock);
	}

	async _pullOracleData() {
		const res = await fetch(`${this._url}/price?vs_currencies=usd&ids=${this._coinGeckoSusdeId}%2C${this._coinGeckoSusdsId}&precision=${this._precision}`, { method: "GET" });
		if (!res.ok) {
			console.error(`ERROR: to pull prices from CoinGecko. status_code=${res.status}, data=${JSON.stringify(await res.json())}`)
			throw new Error(REQ_FAILED_ERR_MSG);
		}

		return await res.json();
	}

	_updateOracleData(data, blockNumber) {
		const elapsedBlocks = new Big(blockNumber - this._updatedAt);
		const maxPriceChange = PRICE_UPDATE_SPEED.mul(elapsedBlocks);

		const susdsPrice = new Big(data[this._coinGeckoSusdsId].usd.toFixed(this._precision));
		if (susdsPrice.gt(this._lastPrices[this._SUSDS])) {
			const priceDiff = susdsPrice.minus(this._lastPrices[this._SUSDS]);

			this._lastPrices[this._SUSDS] = this._lastPrices[this._SUSDS].plus(min(priceDiff, maxPriceChange));
		} else {
			console.log(`INFO(sUSDS): coinGecko price is lower, last_price=${this._lastPrices[this._SUSDS].toFixed(this._precision)}, oracle_price=${susdsPrice.toFixed(8)}`);
		}

		const susdePrice = new Big(data[this._coinGeckoSusdeId].usd.toFixed(this._precision));
		if (susdePrice.gt(this._lastPrices[this._SUSDE])) {
			const priceDiff = susdePrice.minus(this._lastPrices[this._SUSDE]);

			this._lastPrices[this._SUSDE] = this._lastPrices[this._SUSDE].plus(min(priceDiff, maxPriceChange));
		} else {
			console.log(`INFO(sUSDe): coinGecko price is lower, last_price=${this._lastPrices[this._SUSDE].toFixed(this._precision)}, oracle_price=${susdePrice.toFixed(8)}`);
		}

		this._updatedAt = blockNumber
	}

	getUSDPrice(assetId) {
		const p = this._lastPrices[assetId];
		assert.ok(p, `unknown price for asset=${assetId}`);

		return p
	}
}

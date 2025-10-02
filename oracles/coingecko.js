import assert from 'node:assert';
import Big from 'big.js';

//TODO: implement pro-api with api-key
export class CoinGecko {
	#url;
	#cooldown;
	#updatedAt = 0;
	#lastPrices = {};
	#precission;

	#coinGeckoSusdeId;
	#coinGeckoSusdsId;

	// assets ids used as a keys(hydration's asset ids)
	#SUSDE;
	#SUSDS;
	#USDT;
	#USDC;

	//Oracle providing prices for sUSDe and sUSDS
	constructor(config)	 {
		this.#url = config.coinGecko.url;
		this.#cooldown = config.coinGecko.cooldown;
		this.#precission = config.coinGecko.precission;

		this.#coinGeckoSusdeId = config.coinGecko.sUSDe;
		this.#coinGeckoSusdsId = config.coinGecko.sUSDS;

		this.#SUSDE = config.assets.sUSDe.assetId;
		this.#SUSDS = config.assets.sUSDS.assetId;
		this.#USDT = config.assets.USDT.assetId;
		this.#USDC = config.assets.USDC.assetId;

		this.#lastPrices[this.#USDT] = new Big("1.0");
		this.#lastPrices[this.#USDC] = new Big("1.0");
		this.#lastPrices[this.#SUSDS] = new Big(0);
		this.#lastPrices[this.#SUSDE] = new Big(0);
	}

	//Function pulls prices from coinGecko for sUSDe and sUSDS and updates internal state.
	//Update happen only after cooldown period.
	async updateUSDPrices(currentBlock) {
		if ((currentBlock - this.#updatedAt) < this.#cooldown) {
			return;
		}

		const res = await fetch(`${this.#url}/price?vs_currencies=usd&ids=${this.#coinGeckoSusdeId}%2C${this.#coinGeckoSusdsId}&precision=${this.#precission}`, { method: "GET" });
		if (!res.ok) {
			console.error(`ERROR: to pull pricess from CoinGecko. status_code=${res.status}, data=${await res.json()}`)
			return
		}

		const data = await res.json();
		const susdsPrice = new Big(data[this.#coinGeckoSusdsId].usd.toFixed(this.#precission));
		const susdePrice = new Big(data[this.#coinGeckoSusdeId].usd.toFixed(this.#precission));

		if (susdsPrice.gt(this.#lastPrices[this.#SUSDS])) {
			this.#lastPrices[this.#SUSDS] = susdsPrice;
		} else {
			console.log(`INFO(sUSDS): price mismatch, last_price=${this.#lastPrices[this.#SUSDS].toFixed(8)}, oracle_price=${susdsPrice.toFixed(8)}`);
		}

		if (susdePrice.gt(this.#lastPrices[this.#SUSDE])) {
				this.#lastPrices[this.#SUSDE] = susdePrice;
		} else {
			console.log(`INFO(sUSDe): price mismatch, last_price=${this.#lastPrices[this.#SUSDE].toFixed(8)}, oracle_price=${susdePrice.toFixed(8)}`);
		}

		return;
	}

	getUSDPrice(assetId) {
		const p = this.#lastPrices[assetId];
		assert.ok(p, `unknown price for asset: ${assetId}`);

		return p
	}
}

import { createSdkContext, MmOracleClient} from '@galacticcouncil/sdk';
import { big } from '@galacticcouncil/sdk-next';
import { ApiPromise } from '@polkadot/api';
import assert from 'node:assert';
import Big from 'big.js';

const ZERO = new Big(0)
const ONE = new Big(1.0)

export class Strategy {
	#sdk
	#config 
	#hollar
	#mmOracle

	constructor(sdk, evm, config, hollar) {
		this.#sdk = sdk	
		this.#config = config
		this.#hollar = hollar
		this.#mmOracle = new MmOracleClient(evm)
	}

	async findOpportunities() {
		const pairs = []
		
		Object.keys(this.#config).forEach(k => {
				pairs.push({id:k, assets:[this.#hollar, this.#config[k].assetId]});
		})

		const prices = await this.getHollarPrices(pairs)

		const opps = []
		for (const p of prices) {
			const cfg = this.#config[p.id]
			const aId = cfg.assetId
			assert.ok(aId, `config not for assetId=${p.id}`)

			const usdPrice = await this.#getUSDPrice(aId)
			const targetPrice = ONE.div(usdPrice)
			const sellAt = ONE.div(usdPrice.sub(usdPrice.mul(cfg.sell.priceDiff)))
			const buyAt = ONE.div(usdPrice.add(usdPrice.mul(cfg.buy.priceDiff)))
			console.log(`INFO: id: ${p.id}, price=${p.price.toFixed(3)}[${p.id}/H], target_usd_price=${usdPrice.toFixed(3)}[$/${p.id}], target_price=${targetPrice.toFixed(3)}[${p.id}/H], buy_at=${buyAt.toFixed(3)}[${p.id}/H], sell_at=${sellAt.toFixed(3)}[${p.id}/H]`)

			if (p.price.gte(sellAt)) {
				opps.push(this.#newHollarOpp("sell", cfg.assetId, cfg.sell.minAmount, cfg.sell.maxAmount, p.price.toString(), sellAt));
			} else if (p.price.lte(buyAt)) {
				opps.push(this.#newHollarOpp("buy", cfg.assetId, cfg.buy.minAmount, cfg.buy.maxAmount, p.price.toString(), buyAt));
			}
		}

		return opps
	}

	async getHollarPrices(pairs) {
		const rawPrices = []
		pairs.forEach(pair => {
			rawPrices.push(this.#sdk.api.router.getBestSpotPrice(...pair.assets));
		});	

		const results = await Promise.allSettled(rawPrices) 

		const prices = []
		for (let i = 0, l = results.length; i < l; i++) {
			let r = results[i]

			prices.push({
				id: pairs[i].id,
				price: (r.status == 'fulfilled') ? toDecimal(r.value.amount, r.value.decimals) : null
			});
		}

		return prices
	}

	async #getUSDPrice(assetId) {
		let oracleEntry
		switch (assetId) {
			case "1000745": //sUSDS
				oracleEntry = await this.#mmOracle.getData("0x4b32bffc6acd751446e79e8687ef3815fd7924fd")
				return toDecimal(new Big(oracleEntry.price.toString()), oracleEntry.decimals)
			case "1000625": //sUSDe
				oracleEntry = await this.#mmOracle.getData("0x22cdea305cee63d082e79f8c5db939eecd0265d0")
				return toDecimal(new Big(oracleEntry.price.toString()), oracleEntry.decimals)
			default:
				return ONE	
		}
	}

	#newHollarOpp(type, assetId, minAmount, maxAmount, price, targetPrice) {
		assert.ok(type == "buy" || type == "sell", `"type" parameter must be one of ["buy", "sell"], type="${type}"`)
		if (type == "sell") {
			//TODO: rename targetPriceUSD -> targetPriceHollar
			return { trade: "sell", assets: [this.#hollar, assetId], minAmount: minAmount, maxAmount: maxAmount, price: price, targetPriceUSD: targetPrice };
		} else {
			return { trade: "buy",  assets: [assetId, this.#hollar], minAmount: minAmount, maxAmount: maxAmount, price: price, targetPriceUSD: targetPrice };
		}
	}
}

function toDecimal(num, decimals) {
  const divisor = Big(10).pow(decimals);
  return num.div(divisor);
}


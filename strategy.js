import { createSdkContext, MmOracleClient} from '@galacticcouncil/sdk';
import { big } from '@galacticcouncil/sdk-next';
import { ApiPromise } from '@polkadot/api';
import assert from 'node:assert';
import Big from 'big.js';

const BIN_SEARCH_ITER = 20;
const ZERO = new Big("0")
const ONE = new Big("1.0")
const TWO = new Big("2.0")
const PRECISSION = new Big("0.0001")

export class Strategy {
	#sdk
	#config 
	#hollar
	#mmOracle
	#registry
	#router

	constructor(sdk, evm, config, hollar, reg) {
		this.#sdk = sdk	
		this.#config = config
		this.#hollar = hollar
		this.#mmOracle = new MmOracleClient(evm)
		this.#registry = reg
		this.#router = sdk.api.router
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
			console.log(`INFO: id: ${p.id}, price=${p.price.toFixed(5)}[${p.id}/H], target_usd_price=${usdPrice.toFixed(5)}[$/${p.id}], target_price=${targetPrice.toFixed(5)}[${p.id}/H], buy_at_limit=${buyAt.toFixed(5)}[${p.id}/H], sell_at_limit=${sellAt.toFixed(5)}[${p.id}/H]`)

			let trade 
			if (p.price.gte(sellAt)) {
				let [t, execPrice] = await this.findSellTrade([this.#hollar, cfg.assetId], cfg.sell.minAmount, cfg.sell.maxAmount, sellAt)
				trade = t
			} else if (p.price.lte(buyAt)) {
				let [t, execPrice] = await this.findBuyTrade([cfg.assetId, this.#hollar], cfg.sell.minAmount, cfg.sell.maxAmount, buyAt)
				trade = t 
			}

			if (trade) {
				opps.push(trade);
				console.log(trade.toHuman())
				process.exit(1)
			}
		}

		return opps
	}

	async getHollarPrices(pairs) {
		const rawPrices = []
		pairs.forEach(pair => {
			rawPrices.push(this.#router.getBestSpotPrice(...pair.assets));
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



	async findSellTrade(assets, minAmt, maxAmount, price) {
		console.log(`--> findSellTrade: assets=[${assets}], ${minAmt}, ${maxAmount}, ${price}`)
		const limitPrice = new Big(price)
		let trade
		let execPrice = new Big(0)
		let amtHigh = new Big(maxAmount)
		let amtLow = new Big(minAmt)
		let amt = new Big(0)
		for (let i = 0; i< BIN_SEARCH_ITER; i++) {
			amt = amtLow.add((amtHigh.sub(amtLow)).div(TWO))
			console.log(`${i}: amt=${amt.toFixed(5)}, amtLow=${amtLow.toFixed(5)}, amtHigh=${amtHigh.toFixed(5)}`)
			if (amtLow.eq(amtHigh)) {
				break
			}

			let t = await this.#router.getBestSell(...assets, amt)
			const amtIn = new Big(toDecimal(t.amountIn, this.#registry.decimals(assets[0])))
			const amtOut = new Big(toDecimal(t.amountOut, this.#registry.decimals(assets[1])))
			const tPrice = amtOut.div(amtIn) //[a]/[H]

			console.log(`amt_in=${amtIn}, amtOut=${amtOut}, price=${tPrice.toFixed(5)}, limit_price=${limitPrice.toFixed(5)}`)
			if (tPrice.gte(limitPrice) && amountOut.gt(ONE)) {
				amtLow = amt
				trade = t
				execPrice = tPrice

				if (tPrice.minus(limitPrice).abs().lte(PRECISSION)) {
					//NOTE: close enough
					break
				}
			} else {
				amtHigh = amt
			}
		}

		console.log("-- find sell end --")
		return [trade, execPrice]
	}

	async findBuyTrade(assets, minAmt, maxAmount, price) {
		console.log(`---> findBuyTrade: assets=[${assets}], ${minAmt}, ${maxAmount}, ${price}`)
		const limitPrice = new Big(price)
		let trade
		let execPrice = new Big(0)
		let amtHigh = new Big(maxAmount)
		let amtLow = new Big(minAmt)
		let amt = new Big(0)
		for(let i = 0; i< BIN_SEARCH_ITER; i++) {
			amt = amtLow.add((amtHigh.sub(amtLow)).div(TWO))
			console.log(`amt=${amt.toFixed(5)}, amtLow=${amtLow.toFixed(5)}, amtHigh=${amtHigh.toFixed(5)}`)
			if (amtLow.eq(amtHigh)) {
				break
			}

			let t = await this.#router.getBestBuy(...assets, amt)
			const amtIn = new Big(toDecimal(t.amountIn, this.#registry.decimals(assets[0])))
			const amtOut = new Big(toDecimal(t.amountOut, this.#registry.decimals(assets[1])))
			console.log(`---> amtIn=${t.amountIn}, amtOut=${amtOut}`)
			let tPrice = amtIn.div(amtOut) //[a]/[H]

			console.log(`---> trade_price=${tPrice.toFixed(6)}, price=${limitPrice.toFixed(5)}`)
			if (tPrice.lte(limitPrice) && amtIn.gt(ONE)) {
				amtLow = amt
				trade = t
				execPrice = tPrice

				if (tPrice.minus(limitPrice).abs().lte(PRECISSION)) {
					//NOTE: close enough
					break
				}
			} else {
				amtHigh = amt
			}
		}

		return [trade, execPrice]
	}
}

function toDecimal(num, decimals) {
	const divisor = Big(10).pow(decimals);
	return num.div(divisor);
}


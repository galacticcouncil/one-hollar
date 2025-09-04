import { createSdkContext, MmOracleClient} from '@galacticcouncil/sdk';
import { big } from '@galacticcouncil/sdk-next';
import { ApiPromise } from '@polkadot/api';
import assert from 'node:assert';
import Big from 'big.js';

const SEARCH_ITER = 20;
const [ZERO, ONE, TWO, HUNDRED] = [new Big("0"), new Big("1"), new Big("2"), new Big("100")]
const PRECISSION = new Big("0.0001")
const PEEK_MULTIPLIER = new Big("0.1") //10%


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
			const [cfg, assetId] = [this.#config[p.id], this.#config[p.id].assetId]
			assert.ok(assetId, `config not for assetId=${p.id}`)

			const usdPrice = await this.#getUSDPrice(assetId)
			const targetPrice = ONE.div(usdPrice)
			const sellAt = ONE.div(usdPrice.sub(usdPrice.mul(cfg.sell.priceDiff)))
			const buyAt = ONE.div(usdPrice.add(usdPrice.mul(cfg.buy.priceDiff)))

			console.log(`INFO: id: ${p.id}, price=${p.price.toFixed(5)}[${p.id}/H], target_usd_price=${usdPrice.toFixed(5)}[$/${p.id}], target_price=${targetPrice.toFixed(5)}[${p.id}/H], buy_at_limit=${buyAt.toFixed(5)}[${p.id}/H], sell_at_limit=${sellAt.toFixed(5)}[${p.id}/H]`)

			let trade, profit, profitUSD
			if (p.price.gte(sellAt)) {
				[trade, profit, profitUSD] = await this.findTrade([this.#hollar, assetId], cfg.sell.minAmount, cfg.sell.maxAmount, usdPrice,
					(assetIn, assetOut, amount ) =>  { return this.#router.getBestSell(assetIn, assetOut, amount)})
			} else if (p.price.lte(buyAt)) {
				[trade, profit, profitUSD] = await this.findTrade([assetId, this.#hollar], cfg.sell.minAmount, cfg.sell.maxAmount, usdPrice,
					(assetIn, assetOut, amount ) =>  { return this.#router.getBestBuy(assetIn, assetOut, amount)})
			}

			if (trade) {
				opps.push(trade);
				console.log(trade.toHuman())
				console.log(`profit=${(profit.mul(HUNDRED)).toFixed(5)}[%], profitUSD=${profitUSD.toFixed(5)}[$]`)
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
		//TODO: load oracles' addresses from chain
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

	#calcProfit(assetIn, assetOut, trade, oraclePrice) {
		const amtIn = new Big(toDecimal(trade.amountIn, this.#registry.decimals(assetIn)))
		const amtOut = new Big(toDecimal(trade.amountOut, this.#registry.decimals(assetOut)))

		let amtInUSD, amtOutUSD, profit, profitUSD
		if (trade.type == "Sell") {
			//assetIn is Hollar which is always 1$
			[amtInUSD, amtOutUSD] = [amtIn, amtOut.mul(oraclePrice)]
		} else {
			//assetOut is Hollar which is always 1$
			[amtInUSD, amtOutUSD] = [amtIn.mul(oraclePrice), amtOut]
		}

		profit = (amtOutUSD.minus(amtInUSD)).div(amtInUSD)
		profitUSD = amtOutUSD.minus(amtInUSD)

		return [amtIn, amtOut, amtInUSD, amtOutUSD, profit, profitUSD]
	}

	async findTrade(assets, minAmount, maxAmount, oraclePrice, getBestTradeFn) {
		let trade
		let oPrice = new Big(oraclePrice) //$ price for non-Hollar asset
		let [profitUSD, profit] = [new Big(0), new Big(0)]
		let [amt, amtLow, amtHigh] = [new Big(minAmount), new Big(minAmount), new Big(maxAmount)]
		let [minTrade, maxTrade] = [new Big(minAmount), new Big(maxAmount)]

		//TODO: optimize so it won't always do all `SEARCH_ITER`
		for (let i = 0; i< SEARCH_ITER; i++) {
			let t = await getBestTradeFn(...assets, amt)
			let [_tAmtIn, _tAmtOut, _tAmtInUSD, _tAmtOutUSD, tProfit, tProfitUSD] = this.#calcProfit(...assets, t, oPrice)

			if (tProfitUSD.gt(profitUSD)) {
				trade = t
				profit = tProfit
				profitUSD = tProfitUSD
			}

			//NOTE: peek which direction to go
			const peek = amt.mul(PEEK_MULTIPLIER)
			const tmpAmt1 = min(amt.plus(peek), maxTrade)
			const tmpAmt2 = max(amt.minus(peek), minTrade)

			let t1 = await getBestTradeFn(...assets, tmpAmt1)
			let [_t1AmtIn, _t1AmtOut, _t1AmtInUSD, _t1AmtOutUSD, t1Profit, t1ProfitUSD] = this.#calcProfit(...assets, t1, oPrice)

			let t2 = await getBestTradeFn(...assets, tmpAmt2)
			let [_t2AmtIn, _t2AmtOut, _t2AmtInUSD, _t2AmtOutUSD, t2Profit, t2ProfitUSD] = this.#calcProfit(...assets, t2, oPrice)

			if (t1ProfitUSD.gt(t2ProfitUSD)) {
				amtLow = amt
			} else {
				amtHigh = amt
			}
			amt = amtLow.plus((amtHigh.sub(amtLow)).div(TWO))
		}

		return [trade, profit, profitUSD]
	}
}

function min(a, b) {
	if (a.lt(b)) {
		return a
	}

	return b
}

function max(a, b) {
	if (a.gt(b)) {
		return a
	}

	return b
}

function toDecimal(num, decimals) {
	const divisor = Big(10).pow(decimals);
	return num.div(divisor);
}


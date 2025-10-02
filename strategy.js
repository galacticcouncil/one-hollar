import { big } from '@galacticcouncil/sdk-next';
import { ApiPromise } from '@polkadot/api';
import assert from 'node:assert';
import Big from 'big.js';
import { toDecimal } from './utils.js';

const SEARCH_ITER = 20;
const [ZERO, ONE, TWO, HUNDRED] = [new Big("0"), new Big("1"), new Big("2"), new Big("100")];
//Percentage increase/decrease used when we are peekig for direction in trade's amount search
const PEEK_SIZE = new Big("0.1"); //10%
const SLIPPAGE = new Big("0.5"); //1/2 of profit

//99.5% of agent balance will be used for trades
const MAX_BALANCE_USED = new Big("0.995");


export class Strategy {
	#config 
	#hollar
	#oracle
	#registry
	#router
	#agent

	// Creates a `Strategy`.
	constructor(sdk, config, hollar, assetRegistry, agent, oracle) {
		this.#config = config;
		this.#hollar = hollar;
		this.#oracle = oracle;
		this.#registry = assetRegistry;
		this.#agent = agent;
		this.#router = sdk.api.router;
	}

	// Function returns array of `Opportunity` for current block.
	// `Strategy` takes into account `Agent` balances when looking for opportunities.
	// Function returns `[]` if `Agent` balance is too low.
	async findOpportunities() {
		const pairs = [];

		for (const [k, v] of Object.entries(this.#config)) {
			pairs.push({id: k, assets: [ this.#hollar, v.assetId]})
		}

		const prices = await this.getHollarPrices(pairs); //[A/H]

		const opps = [];
		for (const price of prices) {
			const [cfg, assetId] = [this.#config[price.id], this.#config[price.id].assetId];
			assert.ok(assetId, `config not found for assetId=${price.id}`);

			const priceUSD = this.#oracle.getUSDPrice(assetId);	//[$/A]
			const targetPrice = ONE.div(priceUSD);	// 1H == 1$ => 1/[$/A] == [A/$] == [A/H]
			const sellAt = ONE.div(priceUSD.mul(cfg.sell.threshold)); //[A/H]
			const buyAt = ONE.div(priceUSD.mul(cfg.buy.threshold));	//[A/H]

			console.log(`INFO(${price.id}): price=${price.val.toFixed(5)}[${price.id}/H], target_usd_price=${priceUSD.toFixed(5)}[$/${price.id}], target_price=${targetPrice.toFixed(5)}[${price.id}/H], buy_at_limit=${buyAt.toFixed(5)}[${price.id}/H], sell_at_limit=${sellAt.toFixed(5)}[${price.id}/H]`);

			let trade, profit, profitUSD, assets;
			if (price.val.gte(sellAt)) {
				let minTrade = new Big(cfg.sell.minAmount);
				let maxTrade = min(new Big(cfg.sell.maxAmount), this.#agent.balanceDec(this.#hollar).multipliedBy(MAX_BALANCE_USED));

				assets = [this.#hollar, assetId];
				[trade, profit, profitUSD] = await this.findTrade(assets, minTrade, maxTrade, priceUSD,
					(assetIn, assetOut, amount ) =>  { return this.#router.getBestSell(assetIn, assetOut, amount)});
			} else if (price.val.lte(buyAt)) {
				const t = await this.#router.getBestSell(assetId, this.#hollar, min(new Big(cfg.sell.maxAmount), this.#agent.balanceDec(assetId).multipliedBy(MAX_BALANCE_USED)));
				const amtOut = new Big(toDecimal(t.amountOut, this.#registry.decimals(this.#hollar)));

				let minTrade = new Big(cfg.buy.minAmount);
				let maxTrade = min(new Big(cfg.buy.maxAmount), amtOut);

				assets = [assetId, this.#hollar];
				[trade, profit, profitUSD] = await this.findTrade(assets, minTrade, maxTrade, priceUSD,
					(assetIn, assetOut, amount ) =>  { return this.#router.getBestBuy(assetIn, assetOut, amount)});
			}

			if (trade) {
				const slippage = min(profit.mul(SLIPPAGE), new Big("0.005"));
				opps.push(new Opportunity(assets, trade, profit, profitUSD, slippage));
			}
		}

		return opps;
	}

	// Function returns array of spot prices(`[]{id: string, val: Big}`) for given `pairs`.
	async getHollarPrices(pairs) {
		const rawPrices = [];
		pairs.forEach(pair => {
			rawPrices.push(this.#router.getBestSpotPrice(...pair.assets));
		});	

		const results = await Promise.allSettled(rawPrices);

		const prices = [];
		for (let i = 0, l = results.length; i < l; i++) {
			let r = results[i];

			prices.push({
				id: pairs[i].id,
				val: (r.status == 'fulfilled') ? toDecimal(r.value.amount, r.value.decimals) : null
			});
		}

		return prices;
	}

	// Function calculates profit for give params.
	// Returns `[amount in[Asset], amount out[Asset], amount in[USD], amount out[USD], profit[%](1==100%), profit[USD]]`
	#calcProfit(assetIn, assetOut, trade, oraclePrice) {
		const amtIn = new Big(toDecimal(trade.amountIn, this.#registry.decimals(assetIn)));
		const amtOut = new Big(toDecimal(trade.amountOut, this.#registry.decimals(assetOut)));

		let amtInUSD, amtOutUSD, profit, profitUSD;
		if (trade.type == "Sell") {
			//assetIn is Hollar == 1$
			[amtInUSD, amtOutUSD] = [amtIn, amtOut.mul(oraclePrice)];
		} else {
			//assetOut is Hollar == 1$
			[amtInUSD, amtOutUSD] = [amtIn.mul(oraclePrice), amtOut];
		}

		profit = (amtOutUSD.minus(amtInUSD)).div(amtInUSD);
		profitUSD = amtOutUSD.minus(amtInUSD);

		return [amtIn, amtOut, amtInUSD, amtOutUSD, profit, profitUSD];
	}

	// Function find best trage for given params or return `[]` if trade not found.
	// Returns `[trade data, profit[%](1==100%), profit[USD]]`
	async findTrade(assets, minTrade, maxTrade, oraclePrice, getBestTradeFn) {
		if (maxTrade.lt(minTrade)) {
			return [];
		}

		let trade;
		let assetPrice = new Big(oraclePrice); //non-Hollar asset [$/A]
		let [profitUSD, profit] = [new Big(0), new Big(0)];
		let [amt, amtLow, amtHigh] = [new Big(minTrade), new Big(minTrade), new Big(maxTrade)];

		//TODO: optimize so it won't always do all `SEARCH_ITER`
		for (let i = 0; i< SEARCH_ITER; i++) {
			let t = await getBestTradeFn(...assets, amt);
			let [_tAmtIn, _tAmtOut, _tAmtInUSD, _tAmtOutUSD, tProfit, tProfitUSD] = this.#calcProfit(...assets, t, assetPrice);

			if (tProfitUSD.gt(profitUSD)) {
				trade = t;
				profit = tProfit;
				profitUSD = tProfitUSD;
			}

			//NOTE: peek which direction to go
			const peek = amt.mul(PEEK_SIZE);
			const tmpAmt1 = min(amt.plus(peek), maxTrade);
			const tmpAmt2 = max(amt.minus(peek), minTrade);

			let t1 = await getBestTradeFn(...assets, tmpAmt1);
			let [_t1AmtIn, _t1AmtOut, _t1AmtInUSD, _t1AmtOutUSD, t1Profit, t1ProfitUSD] = this.#calcProfit(...assets, t1, assetPrice);

			let t2 = await getBestTradeFn(...assets, tmpAmt2);
			let [_t2AmtIn, _t2AmtOut, _t2AmtInUSD, _t2AmtOutUSD, t2Profit, t2ProfitUSD] = this.#calcProfit(...assets, t2, assetPrice);

			if (t1ProfitUSD.gt(t2ProfitUSD)) {
				amtLow = amt;
			} else {
				amtHigh = amt;
			}
			amt = amtLow.plus((amtHigh.sub(amtLow)).div(TWO));
		}

		return [trade, profit, profitUSD];
	}
}

function min(a, b) {
	if (a.lt(b)) {
		return a;
	}

	return b;
}

function max(a, b) {
	if (a.gt(b)) {
		return a;
	}

	return b;
}

class Opportunity {
	assets
	trade
	profit
	profitUSD
	slippage

	constructor(assets, trade, profit, profitUSD, slippage) {
		this.assets = assets;
		this.trade = trade;
		this.profit = profit;
		this.profitUSD = profitUSD;
		this.slippage = slippage
	}
}

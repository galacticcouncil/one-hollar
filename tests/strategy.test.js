import { describe , it } from 'node:test';
import assert from 'node:assert';
import Big from 'big.js';

import { Strategy } from '../strategy.js';
import { Config } from '../config.js';

const cfg = new Config(`./tests/config.json`);
const dummyRegistry = {
	decimals: (aId) => {
		switch (aId) {
			case "1000625":
				return 18;
			case "1000745":
				return 18;
			case "10":
				return 6;
			case "22":
				return 6;
			case "222":
				return 18;
			default:
				throw new Error(`asset: ${aId} not found in registry`);
		}
	}
};

const PRECISSION = 12;

const hollar = "222";
const USDT = "10";

//NOTE: dummy xyk pool for testing
class DummyPool {
	reserveA;
	reserveH;

	constructor(amountA, amountHollar) {
		this.reserveA = amountA;
		this.reserveH = amountHollar;
	}

	//out = (reserveA * amt)/(reserveH + amt)
	//amt is amount to sell
	calcSellHollar(amt) {
		return (this.reserveA.mul(amt)).div(this.reserveH.plus(amt))
	}

	// in = (reserveA + amt) / (reserveH - amt)
	// amt is amount to buy
	calcBuyHollar(amt) {
		return (this.reserveA.mul(amt)).div(this.reserveH.minus(amt))
	}
}


const dummySDK = {
	api: {
		router: {}
	}
};

class DummySellTrade {
	type = "Sell";
	amountIn;
	amountOut;

	constructor(amountIn, amountOut) {
		this.amountIn = amountIn;
		this.amountOut = amountOut;
	}
}

class DummyBuyTrade {
	type = "Buy";
	amountIn;
	amountOut;

	constructor(amountIn, amountOut) {
		this.amountIn = amountIn;
		this.amountOut = amountOut;
	}
}

function toInt(amt, assetId) {
	const m = Big(10).pow(dummyRegistry.decimals(assetId));

	return (amt.mul(m)).round();
}

describe("strategy.findTrade()", {only: true},async () => {
	it("sell Hollar should work when arb opprtunity exists", async () => {
		let s = new Strategy(dummySDK, null, hollar, dummyRegistry, null, null);
		const USDTPrice = new Big("1.0"); //[$/USDT]
		const pool = new DummyPool(new Big("110000.0"), new Big("108374.3842"));
		const [actTrade, actProfit, actProfitUSD] = await s.findTrade([hollar, USDT], new Big("200.0"), new Big("5000.0"), USDTPrice, async (inId, outId, amount) => {
			//NOTE: this is mock of router.getBestSell()	

			const amountOut = pool.calcSellHollar(amount);

			return new DummySellTrade(toInt(amount, hollar), toInt(amountOut, USDT));
		});

		const expTrade = new DummySellTrade(new Big("809796142578125000000"), new Big("815846906"));
		const expProfit = new Big("0.007471958810");
		const expProfitUSD = new Big("6.050763421875");

		assert.deepStrictEqual(actTrade, expTrade);
		assert.deepStrictEqual(actProfit.toFixed(PRECISSION), expProfit.toFixed(PRECISSION));
		assert.deepStrictEqual(actProfitUSD.toFixed(PRECISSION), expProfitUSD.toFixed(PRECISSION));
	});

	it("buy Hollar should work when arb opprotunity exists", async () => {
		let s = new Strategy(dummySDK, null, hollar, dummyRegistry, null, null);
		const USDTPrice = new Big("1.0"); //[$/USDT]
		const pool = new DummyPool(new Big("110000.0"), new Big("115000.0"));
		const [actTrade, actProfit, actProfitUSD] = await s.findTrade([USDT, hollar], new Big("200.0"), new Big("5000.0"), USDTPrice, async (inId, outId, amount) => {
			//NOTE: this is mock of router.getBestBuy()	

			const amountIn = pool.calcBuyHollar(amount);

			return new DummyBuyTrade(toInt(amountIn, USDT), toInt(amount, hollar));
		});

		const expTrade = new DummyBuyTrade(new Big("2472074303"), new Big("2527636718750000000000"));
		const expProfit = new Big("0.022476029819");
		const expProfitUSD = new Big("55.562415750000");
	
		assert.deepStrictEqual(actTrade, expTrade);
		assert.deepStrictEqual(actProfit.toFixed(PRECISSION), expProfit.toFixed(PRECISSION));
		assert.deepStrictEqual(actProfitUSD.toFixed(PRECISSION), expProfitUSD.toFixed(PRECISSION));
	});
	//
	// it("sell Hollar should find no trade when no opportunity exists", () => {
	// 	assert.ok(false, 'not implemented')
	// });
	//
	// it("buy Hollar should find no trade when no opportunity exists", () => {
	// 	assert.ok(false, 'not implemented')
	// });
	//
	// it("sell Hollar should find no trade when opportunity is smaller than minAmount", () => {
	// 	assert.ok(false, 'not implemented')
	// });
	//
	// it("buy Hollar should find no trade when opportunity is smalle then minAmount", () => {
	// 	assert.ok(false, 'not implemented')
	// });
	//
	// it("buy Hollar should sell maxAmount when opportunity is bigger than maxAmount", () => {
	// 	assert.ok(false, 'not implemented')
	// });
	//
	// it("sell Hollar should sell maxAmount when opportunity is bigger then maxAmount", () => {
	// 	assert.ok(false, 'not implemented')
	// });
	//
	// it("buy Hollar should sell whole balance when both opportunity and maxAmount is bigger than agent's balance", () => {
	// 	assert.ok(false, 'not implemented')
	// });
	//
	// it("sell Hollar should sell whole balance when both opportunity and maxAmount is bigger than agent's balance", () => {
	// 	assert.ok(false, 'not implemented')
	// });
});

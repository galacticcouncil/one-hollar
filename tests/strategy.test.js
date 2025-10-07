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
				throw new Error(`asset ${aId} not found in registry`);
		}
	}
};

const PRECISSION = 12;

const hollar = "222";
const USDT = "10";

const USDT_USD_PRICE = new Big("1.0"); //[$/USDT]

//NOTE: dummy xyk pool for testing
class DummyPool {
	reserveA;
	reserveH;

	constructor(amountA, amountHollar) {
		this.reserveA = amountA;
		this.reserveH = amountHollar;
	}

	// out = (reserveA * amt)/(reserveH + amt)
	// amt is amount to sell
	// calculates amountOut
	calcSellHollar(amt) {
		return (this.reserveA.mul(amt)).div(this.reserveH.plus(amt))
	}

	// in = (reserveA * amt) / (reserveH - amt)
	// amt is amount to buy
	// calculates amountIn
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

function createGetBestSellFn(pool) {
	return (inId, outId, amount) => {
			const amountOut = pool.calcSellHollar(amount);
			return Promise.resolve(new DummySellTrade(toInt(amount, hollar), toInt(amountOut, USDT)));
		};
}

function createGetBestBuyFn(pool) {
	return (inId, outId, amount) => {
			const amountIn = pool.calcBuyHollar(amount);
			return Promise.resolve(new DummyBuyTrade(toInt(amountIn, USDT), toInt(amount, hollar)));
		};
}

describe("strategy.findTrade()", async () => {
	it("sell Hollar should work when arb opprtunity exists", async () => {
		let s = new Strategy(dummySDK, null, hollar, dummyRegistry, null, null);
		const routerGetBestSellFn = createGetBestSellFn(new DummyPool(new Big("110000.0"), new Big("108374.3842")));

		const [actTrade, actProfit, actProfitUSD] = await s.findTrade([hollar, USDT], new Big("200.0"), new Big("5000.0"), USDT_USD_PRICE, routerGetBestSellFn);

		const expTrade = new DummySellTrade(new Big("809796142578125000000"), new Big("815846906"));
		const expProfit = new Big("0.007471958810");
		const expProfitUSD = new Big("6.050763421875");

		assert.deepStrictEqual(actTrade, expTrade);
		assert.deepStrictEqual(actProfit.toFixed(PRECISSION), expProfit.toFixed(PRECISSION));
		assert.deepStrictEqual(actProfitUSD.toFixed(PRECISSION), expProfitUSD.toFixed(PRECISSION));
	});

	it("buy Hollar should work when arb opprotunity exists", async () => {
		let s = new Strategy(dummySDK, null, hollar, dummyRegistry, null, null);
		const routerGetBestBuyFn = createGetBestBuyFn(new DummyPool(new Big("110000.0"), new Big("115000.0")));

		const [actTrade, actProfit, actProfitUSD] = await s.findTrade([USDT, hollar], new Big("200.0"), new Big("5000.0"), USDT_USD_PRICE, routerGetBestBuyFn);

		const expTrade = new DummyBuyTrade(new Big("2472074303"), new Big("2527636718750000000000"));
		const expProfit = new Big("0.022476029819");
		const expProfitUSD = new Big("55.562415750000");
	
		assert.deepStrictEqual(actTrade, expTrade);
		assert.deepStrictEqual(actProfit.toFixed(PRECISSION), expProfit.toFixed(PRECISSION));
		assert.deepStrictEqual(actProfitUSD.toFixed(PRECISSION), expProfitUSD.toFixed(PRECISSION));
	});

	it("should find no trade when no opportunity exists", async () => {
		let s = new Strategy(dummySDK, null, hollar, dummyRegistry, null, null);
		const routerGetBestSellFn = createGetBestSellFn(new DummyPool(new Big("110000.0"), new Big("110000.0")));
		const routerGetBestBuyFn = createGetBestBuyFn(new DummyPool(new Big("110000.0"), new Big("110000.0")));

		const [actSellTrade, actSellProfit, actSellProfitUSD] = await s.findTrade([hollar, USDT], new Big("200.0"), new Big("5000.0"), USDT_USD_PRICE, routerGetBestSellFn);

		assert.deepStrictEqual(actSellTrade, undefined);
		assert.deepStrictEqual(actSellProfit, new Big(0));
		assert.deepStrictEqual(actSellProfitUSD, new Big(0));

		const [actBuyTrade, actBuyProfit, actBuyProfitUSD] = await s.findTrade([USDT, hollar], new Big("200.0"), new Big("5000.0"), USDT_USD_PRICE, routerGetBestBuyFn);

		assert.strictEqual(actBuyTrade, undefined);
		assert.deepStrictEqual(actBuyProfit, new Big(0));
		assert.deepStrictEqual(actBuyProfitUSD, new Big(0));
	});

	it("sell Hollar should find no trade when opportunity is smaller than minAmount", async () => {
		let s = new Strategy(dummySDK, null, hollar, dummyRegistry, null, null);
		const routerGetBestSellFn = createGetBestSellFn(new DummyPool(new Big("110000.0"), new Big("109800.0")));

		const [actTrade, actProfit, actProfitUSD] = await s.findTrade([hollar, USDT], new Big("200.0"), new Big("5000.0"), USDT_USD_PRICE, routerGetBestSellFn);

		assert.deepStrictEqual(actTrade, undefined);
		assert.deepStrictEqual(actProfit, new Big(0));
		assert.deepStrictEqual(actProfitUSD, new Big(0));
	});

	it("buy Hollar should find no trade when opportunity is smaller then minAmount", async () => {
		let s = new Strategy(dummySDK, null, hollar, dummyRegistry, null, null);
		const routerGetBestBuyFn = createGetBestBuyFn(new DummyPool(new Big("110000.0"), new Big("110200.0")));

		const [actTrade, actProfit, actProfitUSD] = await s.findTrade([USDT, hollar], new Big("200.0"), new Big("5000.0"), USDT_USD_PRICE, routerGetBestBuyFn);

		assert.deepStrictEqual(actTrade, undefined);
		assert.deepStrictEqual(actProfit, new Big(0));
		assert.deepStrictEqual(actProfitUSD, new Big(0));
	});

	it("buy Hollar should buy maxAmount of Hollar when opportunity is bigger than maxAmount", async () => {
		let s = new Strategy(dummySDK, null, hollar, dummyRegistry, null, null);
		const routerGetBestBuyFn = createGetBestBuyFn(new DummyPool(new Big("110000.0"), new Big("140000.0")));

		const [actTrade, actProfit, actProfitUSD] = await s.findTrade([USDT, hollar], new Big("200.0"), new Big("5000.0"), USDT_USD_PRICE, routerGetBestBuyFn);

		//NOTE: not 5k because of imprecission in calculations
		const expTrade = new DummyBuyTrade(new Big("4074066338"), new Big("4999990844726562500000"));
		const expProfit = new Big("0.22727281048180185524");
		const expProfitUSD = new Big("925.9245067265625");

		assert.deepStrictEqual(actTrade, expTrade);
		assert.deepStrictEqual(actProfit.toFixed(PRECISSION), expProfit.toFixed(PRECISSION));
		assert.deepStrictEqual(actProfitUSD.toFixed(PRECISSION), expProfitUSD.toFixed(PRECISSION));
	});

	it("sell Hollar should sell maxAmount when opportunity is bigger then maxAmount", async () => {
		let s = new Strategy(dummySDK, null, hollar, dummyRegistry, null, null);
		const routerGetBestSellFn = createGetBestSellFn(new DummyPool(new Big("150000.0"), new Big("110000")));

		const [actTrade, actProfit, actProfitUSD] = await s.findTrade([hollar, USDT], new Big("200.0"), new Big("5000.0"), USDT_USD_PRICE, routerGetBestSellFn);

		const expTrade = new DummySellTrade(new Big("4999990844726562500000"), new Big("6521727708"));
		const expProfit = new Big("0.30434792993239123363");
		const expProfitUSD = new Big("1521.7368632734375");

		assert.deepStrictEqual(actTrade, expTrade);
		assert.deepStrictEqual(actProfit.toFixed(PRECISSION), expProfit.toFixed(PRECISSION));
		assert.deepStrictEqual(actProfitUSD.toFixed(PRECISSION), expProfitUSD.toFixed(PRECISSION));
	});
});

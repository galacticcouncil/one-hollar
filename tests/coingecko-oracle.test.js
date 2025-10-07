import { describe , it } from 'node:test';
import assert from 'node:assert';
import Big from 'big.js';

import { CoinGecko } from '../oracles/coingecko.js';
import { Config } from '../config.js';

const cfg = new Config('./tests/config.json');

const sUSDe = "1000625";
const sUSDS = "1000745";
const USDT = "10";
const USDC = "22";

describe("oracles/coinGecko", () => {
	describe("new CoinGecko(config)", () => {
		it("should initialize class from config", () => {
			const expected = {
				_url: cfg.coinGecko.url,
				_cooldown:  cfg.coinGecko.cooldown,
				_updatedAt: 0,
				_lastPrices: {
					"10":  new Big("1.0"),
					"22":  new Big("1.0"),
					"1000745": new Big(0),
					"1000625": new Big(0),
				},
				_precission: cfg.coinGecko.precission,

				_coinGeckoSusdeId: "ethena-staked-usde",
				_coinGeckoSusdsId: "susds",

				_SUSDE: "1000625",
				_SUSDS: "1000745",
				_USDT: "10",
				_USDC: "22",
			};
			
			const act = new CoinGecko(cfg);

			assert.deepStrictEqual(Object.assign({}, act), expected);
		});
	});

	describe("init(currentBlock)", async() => {
		it("should pull pricess from CoinGecko and inititialize prices from CoinGecko", async() => {
			const cg = new CoinGecko(cfg);
			const now = 1000;

			assert.deepStrictEqual(cg._lastPrices[sUSDe], new Big(0), "SUSDE last price is not zero.");
			assert.deepStrictEqual(cg._lastPrices[sUSDS], new Big(0), "SUSDS last price is not zero.");
			assert.deepStrictEqual(cg._lastPrices[USDT], new Big("1.0"), "USDT last price is not 1.0.");
			assert.deepStrictEqual(cg._lastPrices[USDC], new Big("1.0"), "USDC last price is not 1.0.");
			assert.deepStrictEqual(Object.keys(cg._lastPrices).length, 4, "last prices is not length of 4.");
			assert.deepStrictEqual(cg._updatedAt, 0);

			await cg.init(now);

			assert.notStrictEqual(cg._lastPrices[sUSDe], new Big(0), "SUSDE wasn't updatedl");
			assert.notStrictEqual(cg._lastPrices[sUSDS], new Big(0), "SUSDS wasn't updated.");
			assert.deepStrictEqual(cg._lastPrices[USDT], new Big("1.0"), "USDT price shouldn't change.");
			assert.deepStrictEqual(cg._lastPrices[USDC], new Big("1.0"), "USDC price shouldn't change.");
			assert.deepStrictEqual(Object.keys(cg._lastPrices).length, 4, "last prices is not length of 4.");
			assert.deepStrictEqual(cg._updatedAt, now);
		});
	});

	describe("_updateOracleData(data, blockNumber)", async () => {
		it("should update prices up to PRICE_UPDATE speed per block if CoinGecko's price is bigger than last stored", async () => {
			const cg = new CoinGecko(cfg);

			cg._lastPrices[sUSDS] = new Big("1.07");
			cg._lastPrices[sUSDe] = new Big("1.20");
			cg._updatedAt = 1000;

			const now = 2200;
			const maxUpdate = (new Big("0.0000001")).mul(new Big(now - cg._updatedAt));

			const coinGeckoSUSDsPrice = (new Big("1.07").plus(maxUpdate)).plus(new Big("0.005"));
			const coinGeckoSUSDePrice = (new Big("1.20").plus(maxUpdate)).plus(new Big("0.01"));

			const data = { 'ethena-staked-usde': { usd: coinGeckoSUSDePrice.toFixed(6) }, susds: { usd: coinGeckoSUSDsPrice.toFixed(6)} };
			cg._updateOracleData(data, now);

			assert.deepStrictEqual(cg._lastPrices[sUSDS], new Big("1.07").plus(maxUpdate));
			assert.deepStrictEqual(cg._lastPrices[sUSDe], new Big("1.20").plus(maxUpdate));
			assert.deepStrictEqual(cg._lastPrices[USDT], new Big("1.0"));
			assert.deepStrictEqual(cg._lastPrices[USDC], new Big("1.0"));
			assert.deepStrictEqual(cg._updatedAt, now);

		});

		it("should update up to CoinGecko's price if CoinGecko's price is bigger than last stored and price diff is smaller than PRICE_UPDATE per block change", () => {
			const cg = new CoinGecko(cfg);

			cg._lastPrices[sUSDS] = new Big("1.07");
			cg._lastPrices[sUSDe] = new Big("1.20");
			cg._updatedAt = 1000;

			const now = 15400;
			const maxUpdate = (new Big("0.0000001")).mul(new Big(now - cg._updatedAt)); //0.001444

			const coinGeckoSUSDsPrice = (new Big("1.07")).plus(new Big("0.0012"));
			const coinGeckoSUSDePrice = (new Big("1.20")).plus(new Big("0.0009"));

			const data = { 'ethena-staked-usde': { usd: coinGeckoSUSDePrice.toFixed(6) }, susds: { usd: coinGeckoSUSDsPrice.toFixed(6)} };
			cg._updateOracleData(data, now);

			assert.deepStrictEqual(cg._lastPrices[sUSDS], coinGeckoSUSDsPrice);
			assert.deepStrictEqual(cg._lastPrices[sUSDe], coinGeckoSUSDePrice);
			assert.deepStrictEqual(cg._lastPrices[USDT], new Big("1.0"));
			assert.deepStrictEqual(cg._lastPrices[USDC], new Big("1.0"));
			assert.deepStrictEqual(cg._updatedAt, now);
		});

		it("should not update price if CoinGecko's price is lower than last stored price", () => {
			const cg = new CoinGecko(cfg);

			cg._lastPrices[sUSDS] = new Big("1.07");
			cg._lastPrices[sUSDe] = new Big("1.20");
			cg._updatedAt = 1000;

			const now = 2000;
			const coinGeckoSUSDsPrice = (new Big("1.07")).minus(new Big("0.0002"));
			const coinGeckoSUSDePrice = (new Big("1.20")).minus(new Big("0.0005"));

			const data = { 'ethena-staked-usde': { usd: coinGeckoSUSDePrice.toFixed(6) }, susds: { usd: coinGeckoSUSDsPrice.toFixed(6)} };
			cg._updateOracleData(data, now);

			assert.deepStrictEqual(cg._lastPrices[sUSDS], new Big("1.07"));
			assert.deepStrictEqual(cg._lastPrices[sUSDe], new Big("1.20"));
			assert.deepStrictEqual(cg._lastPrices[USDT], new Big("1.0"));
			assert.deepStrictEqual(cg._lastPrices[USDC], new Big("1.0"));
			assert.deepStrictEqual(cg._updatedAt, now);
		});
	});

	describe("updateUSDPrices(blockNumber)", async () => {
		it("should update sUSDe and sUSDS prices after cooldown", async () => {
			const cg = new CoinGecko(cfg);
			const now = cfg.coinGecko.cooldown;

			//NOTE: init() is not called intentinally so we can assert price changes.
			assert.deepStrictEqual(cg._lastPrices["1000625"], new Big(0), "SUSDE last price is not zero.");
			assert.deepStrictEqual(cg._lastPrices["1000745"], new Big(0), "SUSDS last price is not zero.");
			assert.deepStrictEqual(cg._lastPrices["10"], new Big("1.0"), "USDT last price is not 1.0.");
			assert.deepStrictEqual(cg._lastPrices["22"], new Big("1.0"), "USDC last price is not 1.0.");
			assert.deepStrictEqual(Object.keys(cg._lastPrices).length, 4, "last prices is not length of 4.");
			assert.deepStrictEqual(cg._updatedAt, 0);

			await cg.updateUSDPrices(now);

			assert.notStrictEqual(cg._lastPrices["1000625"], new Big(0), "SUSDE wasn't updatedl");
			assert.notStrictEqual(cg._lastPrices["1000745"], new Big(0), "SUSDS wasn't updated.");
			assert.deepStrictEqual(cg._lastPrices["10"], new Big("1.0"), "USDT price shouldn't change.");
			assert.deepStrictEqual(cg._lastPrices["22"], new Big("1.0"), "USDC price shouldn't change.");
			assert.deepStrictEqual(Object.keys(cg._lastPrices).length, 4, "last prices is not length of 4.");
			assert.deepStrictEqual(cg._updatedAt, now);
		});
		
		it("should not update before cooldown", async () => {
			const cg = new CoinGecko(cfg);
			const now = cfg.coinGecko.cooldown - 1;

			//NOTE: init() is not called intentinally so we can assert price changes.
			assert.deepStrictEqual(cg._lastPrices["1000625"], new Big(0), "SUSDE last price is not zero.");
			assert.deepStrictEqual(cg._lastPrices["1000745"], new Big(0), "SUSDS last price is not zero.");
			assert.deepStrictEqual(cg._lastPrices["10"], new Big("1.0"), "USDT last price is not 1.0.");
			assert.deepStrictEqual(cg._lastPrices["22"], new Big("1.0"), "USDC last price is not 1.0.");
			assert.deepStrictEqual(Object.keys(cg._lastPrices).length, 4, "last prices is not length of 4.");
			assert.deepStrictEqual(cg._updatedAt, 0);

			await cg.updateUSDPrices(now);

			assert.deepStrictEqual(cg._lastPrices["1000625"], new Big(0), "SUSDE last price is not zero.");
			assert.deepStrictEqual(cg._lastPrices["1000745"], new Big(0), "SUSDS last price is not zero.");
			assert.deepStrictEqual(cg._lastPrices["10"], new Big("1.0"), "USDT last price is not 1.0.");
			assert.deepStrictEqual(cg._lastPrices["22"], new Big("1.0"), "USDC last price is not 1.0.");
			assert.deepStrictEqual(Object.keys(cg._lastPrices).length, 4, "last prices is not length of 4.");
			assert.deepStrictEqual(cg._updatedAt, 0);
		});
	});
});


import { createSdkContext, AssetClient, EvmClient  } from '@galacticcouncil/sdk';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Strategy } from './strategy.js'
import { Agent } from './agent.js'
import { strict as assert } from 'node:assert';
import Big from 'big.js';
import fs from 'fs';
const cfgDir = `./configs`
const cfg = loadConfig(`${cfgDir}/config.json`)

const wsProvider = new WsProvider(cfg.endpoint, 2_500, {}, 60_000, 102400, 10 * 60_000);

const api = await ApiPromise.create({
  provider: wsProvider,
});
const sdk = await createSdkContext(api);
const HOLLAR = "222"

const BIN_SEARCH_ITER = 20;
const ZERO = new Big("0")
const TWO = new Big("2.0")
const PRECISSION = new Big("0.0001")

class AssetRegistry {
	#api
	#assets

	constructor(api) {
		this.#api = new AssetClient(api)
		this.#assets = {}
	}

	decimals(assetId) {
		assert.ok(this.#assets, "asset registry is undefined")
		const asset = this.#assets[assetId]
		assert.ok(asset, `missing asset=${assetId}`)
		assert.ok(asset.decimals && asset.decimals > 0, `invalid asset's decimals, asset=${assetId}, decimals=${asset.decimals}`)

		return asset.decimals
	}
	
	symbol(assetId) {
		assert.ok(this.#assets, "asset registry is undefined")
		const asset = this.#assets[assetId]
		assert.ok(asset, `missing asset=${assetId}`)
		assert.ok(asset.symbol && asset.symbol != "", `invalid asset's symbol, asset=${assetId}, symbol=${asset.symbol}`)

		return asset.symbol
	}

	async update() {
		const assets = await this.#api.getOnChainAssets()
		assets.forEach(a => {
			this.#assets[a.id] = a
		});
	}
}

async function findSellTrade(assets, minAmt, maxAmount, price) {
	console.log(`--> findSellTrade: assets=[${assets}], ${minAmt}, ${maxAmount}, ${price}`)
	const router = sdk.api.router

	let trade
	let execPrice = new Big(0)
	let amtHigh = new Big(maxAmount)
	let amtLow = new Big(minAmt)
	let amt = new Big(minAmt)
	for(let i = 0; i< BIN_SEARCH_ITER; i++) {
		console.log(`${i}: amt=${amt.toFixed(5)}, amtLow=${amtLow.toFixed(5)}, amtHigh=${amtHigh.toFixed(5)}`)
		if (amtLow.eq(amtHigh)) {
			break
		}
		let t = await router.getBestSell(...assets, amt)
		let tPrice = (new Big(t.amountOut)).div(new Big(t.amountIn))

		console.log(`${t.amountIn}, ${t.amountOut}`)
		console.log(`in=${t.amountOut}, out=${t.amountIn}`)
		console.log(`inBig=${(new Big(t.amountIn)).toFixed(5)}, outBig=${(new Big(t.amountOut)).toFixed(5)}`)
		console.log(t.toHuman())
		console.log(`${i}: trade_price=${tPrice.toFixed(5)}, target_price=${price}`)
		if (tPrice.minus(price).abs().lte(PRECISSION)) {
			//NOTE: close enough
			break
		}

		if (tPrice.gt(price) && !trade.amountOut.eq(ZERO)) {
			amtLow = amt
			trade = t
			execPrice = tprice

		} else {
			amtHigh = amt
		}

		//NOTE: make sure this doesn't have to be int
		amt = amtLow.add((amtHigh.sub(amtLow)).div(TWO))
	}

	return [trade, execPrice]
}

async function findBuyTrade(assets, minAmt, maxAmount, price) {
	console.log(`---> findBuyTrade: assets=[${assets}], ${minAmt}, ${maxAmount}, ${price}`)
	const router = sdk.api.router

	let trade
	let execPrice = new Big(0)
	let amtHigh = new Big(maxAmount)
	let amtLow = new Big(minAmt)
	let amt = new Big(minAmt)
	for(let i = 0; i< BIN_SEARCH_ITER; i++) {
		console.log(`amt=${amt.toFixed(5)}, amtLow=${amtLow.toFixed(5)}, amtHigh=${amtHigh.toFixed(5)}`)
		if (amtLow.eq(amtHigh)) {
			break
		}

		let t = await router.getBestBuy(...assets, amt)
		let tPrice = (new Big(t.amountIn)).div(new Big(t.amountOut))

		console.log(`${t.amountIn}, ${t.amountOut}`)
		console.log(`---> trade_price=${tPrice.toFixed(6)}, price=${price.toFixed(5)}`)
		if (tPrice.minus(price).abs().lte(PRECISSION)) {
			//NOTE: close enough
			break
		}

		if (tPrice.gt(price) && !t.amountIn.eq(ZERO)) {
			amtHigh = amt
		} else {
			amtLow = amt
			trade = t
			execPrice = tPrice
		}

		//NOTE: make sure this doesn't have to be int
		amt = amtLow.add((amtHigh.sub(amtLow)).div(TWO))
	}

	return [trade, execPrice]
}

async function findTrade(opp, ag) {
	console.log(opp)
	if (opp.trade == "sell") {
		const [t, execPrice] =await findSellTrade(opp.assets, opp.minAmount, opp.maxAmount, opp.targetPriceUSD)
		if (!t) {
			console.log("no sell trade found")
		} else {
			console.log("-- found sell trade --") 
			console.log(`${t.toHuman()}`)
			console.log(`exec_price=${execPrice.toFixed(5)}, target_price=${opp.targetPriceUSD.toFixed(5)}`)
			console.log("-- end --") 
		}
	} else {
		const [t, execPrice] = await findBuyTrade(opp.assets, opp.minAmount, opp.maxAmount, opp.targetPriceUSD)
		if (!t) {
			console.log("no buy trade found")
		} else {
			console.log("-- found buy trade --") 
			console.log(`${t.toHuman()}`)
			console.log(`exec_price=${execPrice.toFixed(5)}, target_price=${opp.targetPriceUSD.toFixed(5)}`)
			console.log("-- end --") 
		}
	}

	// const p = [...opp.assets, opp.amount]
	// const router = sdk.api.router
	// const trade = (opp.trade == "sell") ? await router.getBestSell(...p) : await router.getBestBuy(...p)
	//
	// const agentInAmt = ag.balanceInt(opp.assets[0]);
	// if (agentInAmt.lte(trade.amountIn)) {
	// 	console.log(`WARN: blance too low, asset=${opp.assets[0]}, amount=${ag.balanceDec(opp.assets[0]).toString()}`)
	// 	return
	// }
	//
	// console.log(trade.toHuman())
	//
	// return trade
}


(async function main(cfg) {
	const secretPwd = process.env.SECRET_PASSWORD
	if (!secretPwd) {
		console.error(`ERROR: missing SECRET_PWD env variable to decrypt acount.json file`);
		process.exit(1)
	}
	const secretPath = `${cfgDir}/account.json`

	const reg = new AssetRegistry(api)
	await reg.update()	

	const evm = new EvmClient(api)
	const s = new Strategy(sdk, evm, cfg.assets, HOLLAR, reg)
	const agAssets = Object.values(cfg.assets).map(v => v.assetId);
	agAssets.push(HOLLAR);
	const ag = new Agent(api, secretPath, secretPwd, agAssets, reg)

	api.derive.chain.subscribeNewHeads(async (header) => {
		await ag.updateBalances()
		const opps = await s.findOpportunities()
		
		console.log(`INFO: START processing block=${header.number}`)


		for (const opp of opps) {
			console.log(opp.toHuman())
		}

		const trades = []
		// for (const opp of opps ) {
		// 	console.log(`INFO: opportunity=${opp.trade}, assets=[${opp.assets}], price=${opp.price}, amount=${opp.amount}`)
		// 	const trade = await findTrade(opp, ag)
		// 	if (trade) {
		// 		trades.push(trade);
		// 	}
		// }

		if (header.number % cfg.cooldown == 0) {
			if (trades.length == 0) {
				// console.log(`INFO: no trades found in block=${header.number}`)
			} else {
				// await executeTrades(ag, trades)
				console.log(`INFO: trades submitted`)
			}
		} else {
			console.log(`INFO: chilling...`)
		}
		console.log(`INFO: opportunities=${(opps) ? opps.length : 0}, trades=${trades.length}`)
		console.log(`INFO: DONE processing block=${header.number}`)
	});
})(cfg)

async function executeTrades(ag, trades) {
	let nonce = await api.rpc.system.accountNextIndex(ag.address);

	const txs = []
	for (const t of trades)	{
		txs.push((await sdk.tx.trade(t[0])
				.withBeneficiary(ag.address)
				.withSlippage(0)
				.build())
			.get())
	}

	// const unsub = await api.tx.utility.forceBatch(txs).signAndSend(ag.signer, { nonce: nonce}, ({status, event, dispatchError}) => {
	// 	if (dispatchError) {
	// 		console.log(`ERROR: failed to execute transaction, ${dispatchError.toString()}`)
	// 		process.exit(1)
	// 	}
	//
	// 	if (status.isInBlock) {
	// 		unsub();
	// 	}
	// })
}

function loadConfig(path) {
	const cfg = JSON.parse(fs.readFileSync(path))

	for (const [_, val] of Object.entries(cfg.assets))	{
		val.buy.priceDiff = new Big(val.buy.priceDiff)
		val.sell.priceDiff = new Big(val.sell.priceDiff)
	}

	return cfg
}

//TODO: tmp, refactor out
function toDecimal(num, decimals) {
  const divisor = Big(10).pow(decimals);
  return num.div(divisor);
}

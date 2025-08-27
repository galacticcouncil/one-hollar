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

async function findTrade(opp, ag) {
	const p = [...opp.assets, opp.amount]
	const router = sdk.api.router
	console.log(opp)
	const trade = (opp.trade == "sell") ? await router.getBestSell(...p) : await router.getBestBuy(...p)

	const agentInAmt = ag.balanceInt(opp.assets[0]);
	if (agentInAmt.lte(trade.amountIn)) {
		console.log(`WARN: blance too low, asset=${opp.assets[0]}, amount=${ag.balanceDec(opp.assets[0]).toString()}`)
		return 
	}

	return trade
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
	const s = new Strategy(sdk, evm, cfg.assets, HOLLAR)
	const agAssets = Object.values(cfg.assets).map(v => v.assetId);
	agAssets.push(HOLLAR);
	const ag = new Agent(api, secretPath, secretPwd, agAssets, reg)

	api.derive.chain.subscribeNewHeads(async (header) => {
		await ag.updateBalances()
		const opps = await s.findOpportunities()
		console.log(`INFO: START processing block=${header.number}`)

		const trades = []
		for (const opp of opps ) {
			console.log(`INFO: opportunity=${opp.trade}, assets=[${opp.assets}], price=${opp.price}, amount=${opp.amount}`)
			const trade = await findTrade(opp, ag)
			if (trade) {
				trades.push([trade, opp.slippage]);
			}
		}

		if (header.number % cfg.cooldown == 0) {
			if (trades.length == 0) {
				console.log(`INFO: no trades foun in block=${header.number}`)
			} else {
				await executeTrades(ag, trades)
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
	let nonce = (await api.query.system.account(ag.address)).nonce * 1 + 1;

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

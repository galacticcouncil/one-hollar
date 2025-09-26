import { createSdkContext, EvmClient  } from '@galacticcouncil/sdk';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Strategy } from './strategy.js'
import { Agent } from './agent.js'
import { AssetRegistry } from './assetRegisty.js'
import Big from 'big.js';
import fs from 'fs';
const cfgDir = `./configs`
const cfg = loadConfig(`${cfgDir}/config.json`)

const wsProvider = new WsProvider(cfg.endpoint, 2_500, {}, 60_000, 102400, 10 * 60_000);

const api = await ApiPromise.create({
  provider: wsProvider,
});
const sdk = await createSdkContext(api);
const HOLLAR = "222";

const HUNDRED = new Big("100");

(async function main(cfg) {
	const secretPwd = process.env.SECRET_PASSWORD;
	if (!secretPwd) {
		console.error(`ERROR: missing SECRET_PWD env variable to decrypt acount.json file`);
		process.exit(1)
	}
	const secretPath = `${cfgDir}/account.json`;

	const reg = new AssetRegistry(api);
	await reg.update();

	const evm = new EvmClient(api);
	const agAssets = Object.values(cfg.assets).map(v => v.assetId);
	agAssets.push(HOLLAR);
	const ag = new Agent(api, secretPath, secretPwd, agAssets, reg);
	const s = new Strategy(sdk, evm, cfg.assets, HOLLAR, reg, ag);
	await s.initialize()


	api.derive.chain.subscribeNewHeads(async (header) => {
		console.log(`INFO: START processing block=${header.number}`)
		await ag.updateBalances();
		const opps = await s.findOpportunities();

		opps.sort((a, b) => (a.profitUSD.cmp(b.profitUSD) * -1));
		const trades = [];
		for (const opp of opps) {
			const t = opp.trade.toHuman();
			console.log(`INFO(opportunity): asset=[${opp.assets}], type=${opp.trade.type}, amount_in=${t.amountIn}, amount_out=${t.amountOut}, profit=${opp.profit.mul(HUNDRED).toFixed(5)}, profit_usd=${opp.profitUSD.toFixed(5)}`);

			const assetIn = opp.assets[0];
			if (ag.balanceInt(assetIn).gte(opp.trade.amountIn)) {
				//NOTE: we don't track received amount intentionally. We don't want to count with received amount from previous trades
				ag.sub(assetIn, opp.trade.amountIn);
				trades.push([opp.trade, opp.slippage])
			} else {
				console.log(`INFO: not enough balance to execute opportunity`);
			}

		}

		if (header.number % cfg.cooldown == 0) {
			if (trades.length != 0) {
				await executeTrades(ag, trades);
				console.log(`INFO: trades submitted`);
			}
		} else {
			console.log(`INFO: chilling...`);
		}
		console.log(`INFO: opportunities=${(opps) ? opps.length : 0}, trades=${trades.length}`);
		console.log(`INFO: DONE processing block=${header.number}`);
	});
})(cfg)

async function executeTrades(ag, trades) {
	let nonce = await api.rpc.system.accountNextIndex(ag.address);

	const txs = []
	for (const tData of trades)	{
		txs.push((await sdk.tx.trade(tData[0])
				.withBeneficiary(ag.address)
				.withSlippage(tData[1])
				.build())
			.get())
	}

	const unsub = await api.tx.utility.forceBatch(txs).signAndSend(ag.signer, { nonce: nonce}, ({status, event, dispatchError}) => {
		if (dispatchError) {
			console.log(`ERROR: failed to execute transaction, ${dispatchError.toString()}`)
			process.exit(1)
		}

		if (status.isInBlock) {
			unsub();
		}
	})
}

function loadConfig(path) {
	const cfg = JSON.parse(fs.readFileSync(path))

	for (const [_, val] of Object.entries(cfg.assets))	{
		val.buy.threshold = new Big(val.buy.threshold)
		val.sell.threshold = new Big(val.sell.threshold)
	}

	return cfg
}

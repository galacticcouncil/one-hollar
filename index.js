import { createSdkContext, EvmClient  } from '@galacticcouncil/sdk';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Strategy } from './strategy.js'
import { Agent, loadSigner } from './agent.js'
import { AssetRegistry } from './assetRegisty.js'
import { CoinGecko } from './oracles/coingecko.js'
import Big from 'big.js';
import fs from 'fs';
import { Config } from './config.js';

const cfgDir = "./configs"
const cfg = new Config(`${cfgDir}/config.json`)

const wsProvider = new WsProvider(cfg.url, 2_500, {}, 60_000, 102400, 10 * 60_000);

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

	const agAssets = Object.values(cfg.assets).map(v => v.assetId);
	agAssets.push(HOLLAR);
	let signer = loadSigner(secretPath, secretPwd);
	const ag = new Agent(api, agAssets, reg, signer);

	const oracle = new CoinGecko(cfg);
	const now = (await api.rpc.chain.getHeader()).number.toNumber();
	await oracle.updateUSDPrices(now);

	const s = new Strategy(sdk, cfg.assets, HOLLAR, reg, ag, oracle);

	api.derive.chain.subscribeNewHeads(async (header) => {
		console.log(`INFO: START processing block=${header.number}`)
		await ag.updateBalances();
		const opps = await s.findOpportunities();

		opps.sort((a, b) => (a.profitUSD.cmp(b.profitUSD) * -1));
		const txs = [];
		for (const opp of opps) {
			const t = opp.trade.toHuman();
			console.log(`INFO(opportunity): asset=[${opp.assets}], type=${opp.trade.type}, amount_in=${t.amountIn}, amount_out=${t.amountOut}, profit=${opp.profit.mul(HUNDRED).toFixed(5)}, profit_usd=${opp.profitUSD.toFixed(5)}`);

			const assetIn = opp.assets[0];
			if (ag.balanceInt(assetIn).gte(opp.trade.amountIn)) {
				const tx = await sdk.tx.trade(opp.trade)
					.withBeneficiary(ag.address)
					.withSlippage(opp.slippage.mul(HUNDRED))
					.build();

				const res = await tx.dryRun(ag.address);
				if (!res.isOk) {
					console.warn(`WARN: skipping, failed to dryRun transaction, tx=${tx.hex}, reason=${res.asErr.toHuman()}`);
					continue;
				}

				//NOTE: we don't track received amount intentionally. We don't want to count with received amount from previous trades.
				ag.sub(assetIn, opp.trade.amountIn);
				txs.push(tx.get())
			} else {
				console.log(`INFO: not enough balance to execute opportunity`);
			}

		}

		if (header.number % cfg.cooldown == 0) {
			if (txs.length != 0) {
				await executeTransactions(ag, txs);
				console.log(`INFO: trades submitted`);
			}
		} else {
			console.log(`INFO: chilling...`);
		}
		console.log(`INFO: opportunities=${(opps) ? opps.length : 0}, trades=${txs.length}`);
		console.log(`INFO: DONE processing block=${header.number}`);
	});
})(cfg)

async function executeTransactions(ag, txs) {
	let nonce = await api.rpc.system.accountNextIndex(ag.address);

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

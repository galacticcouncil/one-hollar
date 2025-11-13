
import { BalanceClient } from '@galacticcouncil/sdk';
import { Keyring } from '@polkadot/keyring';
import assert from 'node:assert';
import fs from 'fs';
import Big from 'big.js';
import { toDecimal } from './utils.js';

const ZERO = new Big("0.0");

export class Agent {
	#api
	#signer
	#assets
	#registry

	constructor(api, assets, assetRegistry, signer) {
		this.#api = new BalanceClient(api);
		this.#registry = assetRegistry;
		this.#signer = signer;

		this.#assets = {};
		assets.forEach(a => {
			this.#assets[a] = new Big(0);
		});

	}

	get address() {
		return this.#signer.address;
	}

	get signer() {
		return this.#signer;
	}

	sub(assetId, amount) {
		let balanceNow = this.balanceInt(assetId);

		assert.ok(balanceNow.gte(amount), `balance too low, balance_now=${balanceNow}, amount=${amount}`);

		this.#assets[assetId] = balanceNow.minus(amount);
	}

	async updateBalances() {
		const rawBalances = [];
		Object.keys(this.#assets).forEach(key => {
			rawBalances.push(this.#api.getBalance(this.address, key));
		});

		const res = await Promise.allSettled(rawBalances);
		let i = 0;
		Object.keys(this.#assets).forEach(key => {
			if (res[i].status == "fulfilled") {
				this.#assets[key] = res[i].value;
			} else {
				console.log(`ERROR: to pull balance, assetId=${key}, reason=${res[i].reason}`);
				this.#assets[key] = new Big(0);
			}
			i++
		})
	}

	balanceInt(assetId) {
		const b = this.#assets[assetId];
		assert.ok(b, `no balance found for asset=${assetId}`);

		return b;
	}

	balanceDec(assetId) {
		const b = this.balanceInt(assetId);
		const dec = this.#registry.decimals(assetId);

		return toDecimal(b, dec);
	}

	log() {
		let balances = "";
		for (const [k, v] of Object.entries(this.#assets)) {
			balances += `, ${this.#registry.symbol(k)}: assetId=${k}, balance=${toDecimal(v, this.#registry.decimals(k)).toString()}`;
		}

		console.log(`AGENT: address=${this.address}${balances}`);
	}
}

export function loadSigner(path, password) {
	try {

		const keyring = new Keyring( { type: 'sr25519'});
		const p = JSON.parse(fs.readFileSync(path));
		const pair = keyring.addFromJson(p);
		pair.decodePkcs8(password);

		return pair;
	} catch (err) {
		throw new Error(`Failed to load signer from ${path}: ${err.message}`);
	}
}

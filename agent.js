
import { BalanceClient } from '@galacticcouncil/sdk';
import { Keyring } from '@polkadot/keyring';
import fs from 'fs';
import Big from 'big.js';

const ZERO = new Big(0.0)

export class Agent {
	#api
	#signer
	#assets
	#registry

	constructor(api, secretPath, password, assets, assetRegistry) {
		this.#api = new BalanceClient(api)
		this.#registry = assetRegistry
		this.#signer = this.#loadAccount(secretPath, password)

		this.#assets = {}
		assets.forEach(a => {
			this.#assets[a] = new Big(0)
		});

	}

	#loadAccount(path, password) {
		const keyring = new Keyring( { type: 'sr25519'});
		const p = JSON.parse(fs.readFileSync(path));
		const pair = keyring.addFromJson(p)
		pair.decodePkcs8(password);

		return pair
	}

	get address() {
		return this.#signer.address
	}

	get signer() {
		return this.#signer
	}

	async updateBalances() {
		const rawBalances = []
		Object.keys(this.#assets).forEach(key => {
			rawBalances.push(this.#api.getBalance(this.address, key));
		})

		const res = await Promise.allSettled(rawBalances)
		let i = 0
		Object.keys(this.#assets).forEach(key => {
			if (res[i].status == "fulfilled") {
				this.#assets[key] = res[i].value
			} else {
				console.log(`ERROR: to pull blance assetId=${key}, reason=${res[i].reason}`)
				this.#assets[key] = new Big(0)
			}
			i++
		})
	}

	balanceInt(assetId) {
		return (this.#assets[assetId] || new Big(0))
	}

	balanceDec(assetId) {
		const b = this.balanceInt(assetId)
		if (b.eq(ZERO)) {
			return b
		}
		const dec = this.#registry.decimals(assetId)

		return toDecimal(b, dec)
	}

	log() {
		let balances = ""
		for (const [k, v] of Object.entries(this.#assets)) {
			balances += ` ,${this.#registry.symbol(k)}: assetId=${k}, balance=${toDecimal(v, this.#registry.decimals(k)).toString()}` 
		}

		console.log(`AGENT: address=${this.address}${balances}`)
	}
}


function toDecimal(num, decimals) {
	//TODO: check if this modify original `num` or not
  const divisor = Big(10).pow(decimals);
  return num.div(divisor);
}

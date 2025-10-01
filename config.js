import fs from 'fs';
import Big from 'big.js';

export class Config {
	constructor(path) {
		const cfg = JSON.parse(fs.readFileSync(path))
		this.endpoint = cfg.endpoint;
		this.cooldown =  cfg.cooldown;

		for (const [_, val] of Object.entries(cfg.assets))	{
			val.buy.threshold = new Big(val.buy.threshold)
			val.sell.threshold = new Big(val.sell.threshold)
		}

		this.assets = cfg.assets
	}
}

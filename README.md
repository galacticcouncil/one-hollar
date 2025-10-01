# one-hollar

Arbitrage bot trading Hollar with USDT, USDC, sUSDS and sUSDe on Hydration chain.

## Run
* node.js version `v22.14.0` of newer
* `npm ci --ignore-scripts`
* `npm run start`

## Configuration
* `configs/config.json` - main configuration file.
* `config/account.json` - encrypted file holding account's seed. File can be created e.g. by exporting account from  polkadot.js extension.
* `.env` - environment file with password to unlock `account.json`

### `configs.config.json`
* `endpoint` - RPC url bot will use to get chain state end submit transactions.
* `cooldowd` - number of blocks between trades. Bot creates `forceBatch` with all trades in one block.
* `assets` - assets to be arbed against Hollar. WARN: bot is not designed to trade arbitrary assets. Uou can remove assets from `config.json` but you can't add different assets.
* `assets.{XXX}.assetId` - asset id on Hydation chain.
* `assets.{XXX}.{buy|sell}.threshold` - price volatility bot accecpts in %. e.g. `buy.threshold = 0.999` for pair with target price 1 means bot will not buy Hollar until its' price is <= 0.999$.
* `assets.{XXX}.{buy|sell}.minTrade` - min. traded amount per opportunity.
* `assets.{XXX}.{buy|sell}.maxTrade` - max. traded amount per opportunity. This walue can be set bigger than acount balance and in that case bot will trade whole asset balance in single trade if possible.

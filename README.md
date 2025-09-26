# one-hollar

Arbitrage bot arbing Hollar with USDT, USDC, sUSDS and sUSDe on Hydration chain.

## Configuration
* `configs/config.json` - main configuration bot configuration file.
* `config/account.json` - encrypted file holding account's seed. File can be created e.g. by exporting account from  polkadot.js extension.
* `.env` - environmen file with password to unlock `account.json`


### `configs.config.json`
* `endpoint` - RPC url bot will use to get chain state end submit transaction transaction
* `cooldowd` - number of block between trades. Bot creates `forceBatch` with all trades in the block
* `assets` - assets to be arbed against Hollar. WARN: bot is not deseigned to trade arbitrary assets, you can remove asset from config but you can't add different assets.
* `assets.{XXX}.assetId` - asset id on Hydation chain
* `assets.{XXX}.{buy|sell}.threshold` - price volatility bot accecpts in %. e.g. `buy.threshold = 0.999` for pair with target price 1 means bot will not buy Hollar until its' price is <= 0.999$ 

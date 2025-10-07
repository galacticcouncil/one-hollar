# one-hollar

Arbitrage bot trading Hollar with USDT, USDC, sUSDS and sUSDe on Hydration chain.

## Run
* node.js version `v22.14.0` of newer
* `npm ci --ignore-scripts`
* `npm run start`
* `npm run test`

## Configuration
* `configs/config.json` - main configuration file.
* `config/account.json` - encrypted file holding account's seed. File can be created e.g. by exporting account from  polkadot.js extension.
* `.env` - environment file with password to unlock `account.json`

### `configs.config.json`
* `url` - hydration RPC url that will be used to get chain state end submit transactions.
* `cooldown` - number of blocks between trades. Bot creates `forceBatch` with all trades in one block.
* `assets` - assets to be arbed against Hollar. Assets can be removed or supported assets can be added. Supported assets: `USDT, USDC, sUSDe, sUSDS`.
* `assets.{XXX}.assetId` - asset id on Hydation chain.
* `assets.{XXX}.{buy|sell}.threshold` - price volatility bot accecpts in %. e.g. `buy.threshold = 0.999` for pair with target price 1.0$ means bot will not buy Hollar until its' price is <= 0.999$.
* `assets.{XXX}.{buy|sell}.minTrade` - min. traded amount per opportunity.
* `assets.{XXX}.{buy|sell}.maxTrade` - max. traded amount per opportunity. This walue can be set bigger than acount balance and in that case bot will trade whole asset balance in single trade if possible.
* `coinGecko.url` - coinGecko api url, only public api supported.
* `coinGecko.sUSDe` - coinGecko's sUSDe asset id.
* `coinGecko.sUSDS` - coinGecko's sUSDS asset id.
* `coinGecko.precission` - precission of prices returned by coinGecko api.
* `coinGecko.cooldown` - number of blocks between price update.

## Atribution
CoinGecko oracle is powerd by [CoinGecko API](https://www.coingecko.com/en/api/)

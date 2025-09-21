import Big from 'big.js'

export function toDecimal(num, decimals) {
	const divisor = Big(10).pow(decimals);
	return num.div(divisor);
}


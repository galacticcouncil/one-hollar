import Big from 'big.js'

export function toDecimal(num, decimals) {
	const divisor = Big(10).pow(decimals);
	return num.div(divisor);
}

export function min(a, b) {
	if (a.lt(b)) {
		return a;
	}

	return b;
}

export function max(a, b) {
	if (a.gt(b)) {
		return a;
	}

	return b;
}

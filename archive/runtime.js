export function idle(hash, props) {
	console.log('idle', { hash, props });
}

export function visible(hash, props) {
	console.log('visible', { hash, props });
}

export function interact(hash, props) {
	console.log('interact', { hash, props });
}

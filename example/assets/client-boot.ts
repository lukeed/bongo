import { client, on } from 'bongo/client';

client({ transitions: true, announce: true });

on('bongo:after-swap', ({ to }) => {
	console.log('[bongo] navigated to', to.pathname);
});

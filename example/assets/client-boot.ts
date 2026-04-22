import { client, on } from 'bongo/client';

client({ transitions: true, announce: true });

on('bongo:nav:after', ({ to }) => {
	console.log('[bongo] navigated to', to.pathname);
});

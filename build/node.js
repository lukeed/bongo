import sirv from 'sirv';
import { createServer } from 'http';
import Demo, { metadata } from './demo.js';

const assets = sirv('build', { dev: true, etag: true });

createServer((req, res) => {
	if (req.url !== '/') {
		return assets(req, res);
	}

	let output = Demo.render(metadata);
	res.setHeader('content-type', 'text/html');

	let html = `<html lang="en"><head>${output.head || ''}`;
	if (output.css && output.css.code) html += `<style>${output.css.code}</style>`;
	html += `</head><body>${output.html}</body>`;

	res.end(html);
}).listen(3000);

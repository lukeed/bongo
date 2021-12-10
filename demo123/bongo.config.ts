import markdown from '@bongo/markdown';
import type { Config } from 'bongo';

console.log('INSIDE TS CONFIG FILE');

const config: Config = {
	$site: {
		url: 'https://asd.com/',
		title: 'demo site',
		lang: 'en',
	},

	$assets: {
		html(filename, content) {
			console.log('DONT', { filename, content });
			return { filename, content };
		}
	},

	$partials: {
		custom(args: Record<string, string>) {
			return 'hello: ' + args.name;
		}
	},

	plugins: [
		markdown
	]
}

export default config;

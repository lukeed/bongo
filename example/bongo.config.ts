import { markdown } from '@bongo/markdown';
import type { Config } from 'bongo';

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
		},
		hello(args) {
			return '<div class="ello">puppet</div>';
		}
	},

	plugins: [
		markdown()
	]
}

export default config;

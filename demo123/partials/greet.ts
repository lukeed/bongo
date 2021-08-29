import type { Template } from '../../packages/bongo';

interface Args1 {
	name: string;
}

const greet: Template.Compiler<Args1> = function (args) {
	return `<span>hello, ${args.name}</span>`;
}

export default greet;

import { describe, expect, test } from 'bun:test';

import * as classes from './classes';

describe('scan', () => {
	test('finds each class name once, sorted', () => {
		expect(classes.scan('<div class="b a"><p class="a  c\n d">x</p></div>')).toEqual(['a', 'b', 'c', 'd']);
	});

	test('reads single-quoted, bare, and spaced attributes, in any case', () => {
		expect(classes.scan(`<p class='one'><p class=two><p CLASS = "three">`)).toEqual(['one', 'three', 'two']);
	});

	test('decodes entities, as a browser reads the attribute', () => {
		expect(classes.scan('<b class="[&amp;&gt;svg]:size-3 a&#58;b &#x2F;x &lt;">')).toEqual(['/x', '<', '[&>svg]:size-3', 'a:b']);
	});

	test('skips other attributes whose names end in class', () => {
		expect(classes.scan('<p data-class="no" subclass="no" class="yes">')).toEqual(['yes']);
	});

	test('finds nothing in markup without classes', () => {
		expect(classes.scan('<p>class="no" in text</p>')).toEqual([]);
	});
});

console.log('hello from bundle');
import('./other').then(x => console.log('other:', x.foo));

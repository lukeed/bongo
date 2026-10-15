import { on } from 'bongo/client';

on('bongo:navigated', ({ to }) => {
	document.querySelector('main')?.setAttribute('data-path', to.pathname);
});

let button = document.createElement('button');
button.id = 'back-to-top';
button.textContent = '↑ Top';
button.setAttribute('aria-label', 'Back to top');
button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
document.body.appendChild(button);

window.addEventListener('scroll', () => {
	button.classList.toggle('visible', window.scrollY > 300);
}, { passive: true });

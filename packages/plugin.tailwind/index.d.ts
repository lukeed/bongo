import type { Config } from 'bongo';

/**
 * Build each stylesheet that uses Tailwind from the class names of every page, as bongo renders them,
 * plus the scripts next to the stylesheet and each `@source` that it names.
 * @example
 * import { tailwind } from '@bongo/tailwind';
 * export default { plugins: [tailwind()] };
 */
export function tailwind(): Partial<Config>;

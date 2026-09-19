import { civitaiPage } from './page.js';
export default Object.freeze({ id: 'civitai', canonicalPage: civitaiPage, preserveReferrer: (value) => civitaiPage(value) !== null });

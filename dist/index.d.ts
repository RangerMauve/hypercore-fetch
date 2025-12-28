/**
 *
 * @param {object} options
 * @param {import('hyper-sdk').SDK} options.sdk
 * @param {boolean} [options.writable]
 * @param {boolean} [options.extensionMessages]
 * @param {number} [options.timeout]
 * @param {typeof DEFAULT_RENDER_INDEX} [options.renderIndex]
 * @param {OnLoadHandler} [options.onLoad]
 * @param {OnDeleteHandler} [options.onDelete]
 * @returns {Promise<typeof globalThis.fetch>}
 */
export default function makeHyperFetch({ sdk, writable, extensionMessages, timeout, renderIndex, onLoad, onDelete }: {
    sdk: import("hyper-sdk").SDK;
    writable?: boolean | undefined;
    extensionMessages?: boolean | undefined;
    timeout?: number | undefined;
    renderIndex?: typeof DEFAULT_RENDER_INDEX | undefined;
    onLoad?: OnLoadHandler | undefined;
    onDelete?: OnDeleteHandler | undefined;
}): Promise<typeof globalThis.fetch>;
export const ERROR_KEY_NOT_CREATED: "Must create key with POST before reading";
export const ERROR_DRIVE_EMPTY: "Could not find data in drive, make sure your key is correct and that there are peers online to load data from";
export type RenderIndexHandler = (url: URL, files: string[], fetch: typeof globalThis.fetch) => Promise<string>;
export type OnLoadHandler = (url: URL, writable: boolean, name?: string) => void;
export type OnDeleteHandler = (url: URL) => void;
declare function DEFAULT_RENDER_INDEX(url: URL, files: string[], fetch: typeof globalThis.fetch): Promise<string>;
export {};

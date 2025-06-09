import { Browser } from './browser/browser';
import { Helpers } from './utils/helpers';
import { Env } from '../worker-configuration';

export default {
	async fetch(req: Request, env: Env) {
		const ip = req.headers.get('cf-connecting-ip');
		const url = new URL(req.url);

		// Metadata route
		if (url.pathname === '/metadata') {
			if (!(env.BACKEND_SECURITY_TOKEN === req.headers.get('Authorization')?.replace('Bearer ', ''))) {
				const { success } = await env.RENDER_RATE_LIMITER.limit({ key: ip });
				if (!success) {
					return new Response('Rate limit exceeded', { status: 429 });
				}
			}

			const id = env.BROWSER.idFromName('browser');
			const obj = env.BROWSER.get(id);
			const metadataUrl = new URL(req.url);
			metadataUrl.searchParams.append('metadata', 'true');

			return await obj.fetch(metadataUrl.toString(), {
				headers: req.headers,
				method: req.method,
			});
		}

		// Regular request handling
		if (!(env.BACKEND_SECURITY_TOKEN === req.headers.get('Authorization')?.replace('Bearer ', ''))) {
			const pageUrl = url.searchParams.get('url');
			if (!pageUrl) {
				const helper = new Helpers();
				return helper.initialResponse();
			}
			const { success } = await env.RENDER_RATE_LIMITER.limit({ key: ip });
			if (!success) {
				return new Response('Rate limit exceeded', { status: 429 });
			}
		}

		const id = env.BROWSER.idFromName('browser');
		const obj = env.BROWSER.get(id);
		return await obj.fetch(req.url, {
			headers: req.headers,
			method: req.method,
		});
	},
};

export { Browser };

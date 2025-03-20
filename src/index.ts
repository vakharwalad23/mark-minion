import puppeteer from '@cloudflare/puppeteer';
import type { Browser as B, Page } from '@cloudflare/puppeteer';
import { Tweet } from 'react-tweet/api';
import { HTML } from './webResponse';
import { Env } from '../worker-configuration';

export default {
	async fetch(req: Request, env: Env) {
		const ip = req.headers.get('cf-connecting-ip');
		const url = new URL(req.url);

		// Handle metadata route
		if (url.pathname === '/metadata') {
			// Skip rate limiting for authenticated requests
			if (!(env.BACKEND_SECURITY_TOKEN === req.headers.get('Authorization')?.replace('Bearer ', ''))) {
				const { success } = await env.RENDER_RATE_LIMITER.limit({ key: ip });
				if (!success) {
					return new Response('Rate limit exceeded', { status: 429 });
				}
			}

			// Forward to Browser DO with metadata flag
			const id = env.BROWSER.idFromName('browser');
			const obj = env.BROWSER.get(id);
			const metadataUrl = new URL(req.url);
			metadataUrl.searchParams.append('metadata', 'true');

			const resp = await obj.fetch(metadataUrl.toString(), {
				headers: req.headers,
				method: req.method,
			});

			return resp;
		}

		// Original code for regular requests
		if (!(env.BACKEND_SECURITY_TOKEN === req.headers.get('Authorization')?.replace('Bearer ', ''))) {
			const pageUrl = url.searchParams.get('url');
			if (!pageUrl) {
				const helper = new Helpers();
				return helper.intialResponse();
			}
			const { success } = await env.RENDER_RATE_LIMITER.limit({ key: ip });

			if (!success) {
				return new Response('Rate limit exceeded', { status: 429 });
			}
		}

		// Use Durable Object for browser management
		const id = env.BROWSER.idFromName('browser');
		const obj = env.BROWSER.get(id);
		const resp = await obj.fetch(req.url, {
			headers: req.headers,
			method: req.method,
		});

		return resp;
	},
};

const KEEP_BROWSER_ALIVE_IN_SECONDS = 60;
const TEN_SECONDS = 10000;

export class Browser {
	state: DurableObjectState;
	env: Env;
	keptAliveInSeconds: number;
	storage: DurableObjectStorage;
	browser: B | undefined;
	request: Request | undefined;
	llmFilter: boolean;
	token = '';
	helper: Helpers;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		this.keptAliveInSeconds = 0;
		this.storage = this.state.storage;
		this.request = undefined;
		this.llmFilter = false;
		this.helper = new Helpers();
	}

	async fetch(requestUrl: string, options: { headers: Headers; method: string }) {
		const request = new Request(requestUrl, options);
		this.request = request;

		if (!(request.method === 'GET')) {
			return new Response('Method Not Allowed', { status: 405 });
		}

		const url = new URL(request.url);

		// Check if this is a metadata request
		if (url.pathname === '/metadata' || url.searchParams.get('metadata') === 'true') {
			const targetUrl = url.searchParams.get('url');

			if (!targetUrl) {
				return new Response('Missing URL parameter', { status: 400 });
			}

			if (!this.helper.isValidUrl(targetUrl)) {
				return new Response('Invalid URL provided', { status: 400 });
			}

			if (!(await this.ensureBrowser())) {
				return new Response('Could not start browser instance', { status: 500 });
			}

			const metadata = await this.extractMetadata(targetUrl);
			return new Response(JSON.stringify(metadata), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Original code for regular requests
		const pageUrl = url.searchParams.get('url');
		const enableDetailedResponse = url.searchParams.get('detailed') === 'true';
		const subpageCrawl = url.searchParams.get('subpage') === 'true';
		const unnecessaryFilter = url.searchParams.get('unnecessaryfilter') === 'true';
		const contentType = request.headers.get('content-type') === 'application/json' ? 'json' : 'text';
		const token = request.headers.get('Authorization')?.replace('Bearer ', '');

		this.token = token ?? '';
		this.llmFilter = unnecessaryFilter;

		if (contentType === 'text' && subpageCrawl) {
			return new Response('Error: Crawl subpages can only be enabled with JSON content type', { status: 400 });
		}

		if (!pageUrl) {
			return this.helper.intialResponse();
		}

		if (!this.helper.isValidUrl(pageUrl)) {
			return new Response('Invalid URL provided', { status: 400 });
		}

		if (!(await this.ensureBrowser())) {
			return new Response('Could not start browser instance', { status: 500 });
		}

		return subpageCrawl
			? this.crawlSubPages(pageUrl, enableDetailedResponse)
			: this.crawlSinglePage(pageUrl, enableDetailedResponse, contentType);
	}

	async ensureBrowser() {
		let retries = 3;
		while (retries) {
			if (!this.browser || !this.browser.isConnected()) {
				try {
					this.browser = await puppeteer.launch(this.env.MFBROWSER);
					return true;
				} catch (e) {
					console.error(`Browser DO: Could not start browser instance. Error: ${e}`);
					retries--;
					if (!retries) {
						return false;
					}

					const sessions = await puppeteer.sessions(this.env.MFBROWSER);

					for (const session of sessions) {
						const b = await puppeteer.connect(this.env.MFBROWSER, session.sessionId);
						await b.close();
					}

					console.log(`Retrying to start browser instance. Retries left: ${retries}`);
				}
			} else {
				return true;
			}
		}
		return false;
	}

	async getWebsiteMarkdown({ urls, enableDetailedResponse, env }: { urls: string[]; enableDetailedResponse: boolean; env: Env }) {
		this.keptAliveInSeconds = 0;

		const isBrowserActive = await this.ensureBrowser();

		if (!isBrowserActive) {
			return [{ url: urls[0], md: 'Could not start browser instance' }];
		}

		return await Promise.all(
			urls.map(async (url) => {
				const ip = this.request?.headers.get('cf-connecting-ip') || '';

				if (this.token !== env.BACKEND_SECURITY_TOKEN) {
					const { success } = await env.RENDER_RATE_LIMITER.limit({ key: ip });

					if (!success) {
						return { url, md: 'Rate limit exceeded' };
					}
				}

				const id = url + (enableDetailedResponse ? '-detailed' : '') + (this.llmFilter ? '-llm' : '');
				const cached = await env.BROWSER_KV.get(id);

				// Special handling for Twitter/X URLs
				if (url.startsWith('https://x.com') || url.startsWith('https://twitter.com')) {
					const tweetID = url.split('/').pop();
					if (!tweetID) return { url, md: 'Invalid tweet URL' };

					const tweetCached = await env.BROWSER_KV.get(tweetID);
					if (tweetCached) return { url, md: tweetCached };

					const tweet = await this.helper.handleTweet(tweetID);
					if (!tweet || typeof tweet !== 'object' || tweet.text === undefined) return { url, md: 'Tweet not found' };

					const tweetMd = `Tweet from @${tweet.user?.name ?? tweet.user?.screen_name ?? 'Unknown'}

                    ${tweet.text}
                    Images: ${tweet.photos ? tweet.photos.map((photo) => photo.url).join(', ') : 'none'}
                    Time: ${tweet.created_at}, Likes: ${tweet.favorite_count}, Retweets: ${tweet.conversation_count}

                    raw: ${JSON.stringify(tweet)}`;

					await env.BROWSER_KV.put(tweetID, tweetMd);
					return { url, md: tweetMd };
				}

				let md = cached ?? (await this.fetchAndProcessPage(url, enableDetailedResponse));

				if (this.llmFilter && !cached) {
					const AgentResponse = (await env.AI_AGENT.run('@cf/mistral/mistral-7b-instruct-v0.1', {
						prompt: `You are an AI assistant whose work is to convert webpage content into markdown at the same time filtering out unnecessary information. Follow the given guidelines:
                        Remove any inappropriate content, ads, or irrelevant information
                        If unsure about including any content, keep it aside.
                        Make the content clean, readable markdown.
                        Input: ${md}
                        Output: \`\`\`markdown\n`,
						temperature: 0.2,
					})) as { response: string };

					md = AgentResponse.response;
				}

				await env.BROWSER_KV.put(id, md, { expirationTtl: 1800 });
				return { url, md };
			})
		);
	}

	async crawlSinglePage(url: string, enableDetailedResponse: boolean, contentType: string) {
		const md = await this.getWebsiteMarkdown({
			urls: [url],
			enableDetailedResponse,
			env: this.env,
		});

		if (contentType === 'json') {
			return new Response(JSON.stringify(md), { status: 200 });
		} else {
			return new Response(md[0].md, {
				status: 200,
			});
		}
	}

	async crawlSubPages(baseUrl: string, enableDetailedResponse: boolean) {
		const page = await this.browser!.newPage();
		await page.goto(baseUrl);
		const links = await this.extractLinks(page, baseUrl);
		await page.close();

		const uniqueLinks = Array.from(new Set(links)).splice(0, 10) as string[];
		const md = await this.getWebsiteMarkdown({
			urls: uniqueLinks,
			enableDetailedResponse,
			env: this.env,
		});

		let status = 200;

		return new Response(JSON.stringify(md), { status: status });
	}

	async extractLinks(page: Page, baseUrl: string) {
		return await page.evaluate((baseUrl) => {
			return Array.from(document.querySelectorAll('a'))
				.map((link) => (link as HTMLAnchorElement).href)
				.filter((link) => link.startsWith(baseUrl));
		}, baseUrl);
	}

	async fetchAndProcessPage(url: string, enableDetailedResponse: boolean): Promise<string> {
		const page = await this.browser!.newPage();
		await page.goto(url, { waitUntil: 'networkidle0' });

		const md = await page.evaluate((enableDetailedResponse: boolean) => {
			async function extractArticleMarkdown() {
				// Load Readability library
				const readabilityScript = document.createElement('script');
				readabilityScript.src = 'https://unpkg.com/@mozilla/readability/Readability.js';
				document.head.appendChild(readabilityScript);

				// Load Turndown for HTML to Markdown conversion
				const turndownScript = document.createElement('script');
				turndownScript.src = 'https://unpkg.com/turndown/dist/turndown.js';
				document.head.appendChild(turndownScript);

				let md = 'no content';

				// Wait for the libraries to load
				return Promise.all([
					new Promise((resolve) => (readabilityScript.onload = resolve)),
					new Promise((resolve) => (turndownScript.onload = resolve)),
				]).then(() => {
					// Create Readability instance with the current document
					const reader = new (window as any).Readability(document.cloneNode(true), {
						charThreshold: 0,
						keepClasses: true,
						nbTopCandidates: 500,
					});

					// Parse the article content
					const article = reader.parse();

					// Create Turndown instance to convert HTML to Markdown
					const turndownService = new (window as any).TurndownService();

					let documentWithoutScripts = document.cloneNode(true) as Document;
					documentWithoutScripts.querySelectorAll('script').forEach((node) => node.remove());
					documentWithoutScripts.querySelectorAll('style').forEach((node) => node.remove());
					documentWithoutScripts.querySelectorAll('iframe').forEach((node) => node.remove());
					documentWithoutScripts.querySelectorAll('noscript').forEach((node) => node.remove());

					// Convert content to Markdown based on whether detailed response is requested
					const markdown = turndownService.turndown(
						enableDetailedResponse ? documentWithoutScripts.documentElement.outerHTML : article.content
					);

					return markdown;
				});
			}
			return extractArticleMarkdown();
		}, enableDetailedResponse);

		await page.close();
		return md;
	}

	async extractMetadata(url: string) {
		// Check cache first
		const cacheKey = `metadata-${url}`;
		const cached = await this.env.BROWSER_KV.get(cacheKey);
		if (cached) {
			try {
				return JSON.parse(cached);
			} catch (e) {
				// Cache parsing failed, continue to fetch fresh data
			}
		}

		// Create a new page
		const page = await this.browser!.newPage();

		try {
			// Set timeout and navigate to page
			await page.setDefaultNavigationTimeout(30000);
			await page.goto(url, { waitUntil: 'domcontentloaded' });

			// Extract metadata
			const metadata = await page.evaluate(() => {
				const getMetaContent = (selector: string) => {
					const element = document.querySelector(selector);
					return element ? element.getAttribute('content') : null;
				};

				const getOpenGraphContent = (property: string) => {
					const element = document.querySelector(`meta[property="og:${property}"]`);
					return element ? element.getAttribute('content') : null;
				};

				const getTwitterContent = (property: string) => {
					const element = document.querySelector(`meta[name="twitter:${property}"]`);
					return element ? element.getAttribute('content') : null;
				};

				return {
					title: document.title,
					description: getMetaContent('meta[name="description"]'),
					keywords: getMetaContent('meta[name="keywords"]'),
					author: getMetaContent('meta[name="author"]'),
					favicon: (() => {
						const favicon = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
						return favicon ? favicon.getAttribute('href') : null;
					})(),
					canonical: (() => {
						const link = document.querySelector('link[rel="canonical"]');
						return link ? link.getAttribute('href') : null;
					})(),
					openGraph: {
						title: getOpenGraphContent('title'),
						description: getOpenGraphContent('description'),
						image: getOpenGraphContent('image'),
						url: getOpenGraphContent('url'),
						type: getOpenGraphContent('type'),
						siteName: getOpenGraphContent('site_name'),
					},
					twitter: {
						card: getTwitterContent('card'),
						title: getTwitterContent('title'),
						description: getTwitterContent('description'),
						image: getTwitterContent('image'),
					},
					jsonLD: (() => {
						const scripts = document.querySelectorAll('script[type="application/ld+json"]');
						const results: any = [];
						scripts.forEach((script) => {
							try {
								results.push(JSON.parse(script.textContent || ''));
							} catch (e) {
								// Parse error, skip this script
							}
						});
						return results.length > 0 ? results : null;
					})(),
				};
			});

			// Cache for 1 hour
			await this.env.BROWSER_KV.put(cacheKey, JSON.stringify(metadata), { expirationTtl: 3600 });

			return metadata;
		} catch (err: any) {
			console.error(`Error extracting metadata: ${err.message}`);
			return { error: `Failed to extract metadata: ${err.message}` };
		} finally {
			await page.close().catch((e) => console.error('Error closing page:', e));
		}
	}

	async alarm() {
		this.keptAliveInSeconds += 10;
		if (this.keptAliveInSeconds < KEEP_BROWSER_ALIVE_IN_SECONDS) {
			await this.storage.setAlarm(Date.now() + TEN_SECONDS);
		} else {
			if (this.browser) {
				await this.browser.close();
				this.browser = undefined;
			}
		}
	}
}

export class Helpers {
	isValidUrl(url: string): boolean {
		return url.match(/(http|https):\/\/[^ "]+/) ? true : false;
	}

	async handleTweet(tweetId: string): Promise<Tweet> {
		const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&features=tfw_timeline_list%3A%3Btfw_follower_count_sunset%3Atrue%3Btfw_tweet_edit_backend%3Aon%3Btfw_refsrc_session%3Aon%3Btfw_fosnr_soft_interventions_enabled%3Aon%3Btfw_show_birdwatch_pivots_enabled%3Aon%3Btfw_show_business_verified_badge%3Aon%3Btfw_duplicate_scribes_to_settings%3Aon%3Btfw_use_profile_image_shape_enabled%3Aon%3Btfw_show_blue_verified_badge%3Aon%3Btfw_legacy_timeline_sunset%3Atrue%3Btfw_show_gov_verified_badge%3Aon%3Btfw_show_business_affiliate_badge%3Aon%3Btfw_tweet_edit_frontend%3Aon&token=4iace3gbq7`;

		const resp = await fetch(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
				Accept: 'application/json',
				'Accept-Language': 'en-US,en;q=0.5',
				'Accept-Encoding': 'gzip, deflate, br',
				Connection: 'keep-alive',
				'Upgrade-Insecure-Requests': '1',
				'Cache-Control': 'max-age=0',
				TE: 'Trailers',
			},
		});
		const data = (await resp.json()) as Tweet;

		return data;
	}

	intialResponse() {
		return new Response(HTML, {
			headers: {
				'content-type': 'text/html;charset=UTF-8',
			},
		});
	}
}

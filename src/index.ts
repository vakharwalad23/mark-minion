import puppeteer from '@cloudflare/puppeteer';
import type { Browser as B, Page } from '@cloudflare/puppeteer';
import { Tweet } from 'react-tweet/api';
import { HTML } from './webResponse';
import { Env } from '../worker-configuration';

// Constants for configuration
const KEEP_BROWSER_ALIVE_IN_SECONDS = 60;
const TEN_SECONDS = 10000;
const PAGE_TIMEOUT = 30000; // 30 seconds

// Main fetch handler for incoming requests
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

// Browser Durable Object to manage Puppeteer instance
export class Browser {
	state: DurableObjectState;
	env: Env;
	keptAliveInSeconds: number;
	storage: DurableObjectStorage;
	browser: B | undefined;
	request: Request | undefined;
	llmFilter: boolean;
	token: string;
	helper: Helpers;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		this.keptAliveInSeconds = 0;
		this.storage = this.state.storage;
		this.request = undefined;
		this.llmFilter = false;
		this.token = '';
		this.helper = new Helpers();
	}

	// Handle fetch requests to the Durable Object
	async fetch(requestUrl: string, options: { headers: Headers; method: string }) {
		const request = new Request(requestUrl, options);
		this.request = request;

		if (request.method !== 'GET') {
			return new Response('Method Not Allowed', { status: 405 });
		}

		const url = new URL(request.url);
		console.log(`Processing request for URL: ${url.toString()}`);

		// Metadata extraction
		if (url.pathname === '/metadata' || url.searchParams.get('metadata') === 'true') {
			const targetUrl = url.searchParams.get('url');
			console.log(`Metadata route triggered, target URL: ${targetUrl}`);

			if (!targetUrl) {
				console.error('Missing URL parameter');
				return new Response('Missing URL parameter', { status: 400 });
			}
			if (!this.helper.isValidUrl(targetUrl)) {
				console.error(`Invalid URL provided: ${targetUrl}`);
				return new Response('Invalid URL provided', { status: 400 });
			}
			if (!(await this.ensureBrowser())) {
				console.error('Failed to start browser instance');
				return new Response('Could not start browser instance', { status: 500 });
			}

			try {
				const metadata = await this.extractMetadata(targetUrl);
				console.log(`Metadata extracted for ${targetUrl}`);
				return new Response(JSON.stringify(metadata), {
					headers: { 'Content-Type': 'application/json' },
					status: 200,
				});
			} catch (error: any) {
				console.error(`Metadata extraction failed for ${targetUrl}: ${error}`);
				return new Response(JSON.stringify({ error: `Failed to extract metadata: ${error.message}` }), {
					headers: { 'Content-Type': 'application/json' },
					status: 500,
				});
			}
		}

		// Regular crawling
		const pageUrl = url.searchParams.get('url');
		const enableDetailedResponse = url.searchParams.get('detailed') === 'true';
		const subpageCrawl = url.searchParams.get('subpage') === 'true';
		const unnecessaryFilter = url.searchParams.get('unnecessaryfilter') === 'true';
		const contentType = request.headers.get('content-type') === 'application/json' ? 'json' : 'text';
		this.token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
		this.llmFilter = unnecessaryFilter;

		if (contentType === 'text' && subpageCrawl) {
			return new Response('Error: Subpage crawling requires JSON content type', { status: 400 });
		}

		if (!pageUrl) return this.helper.initialResponse();
		if (!this.helper.isValidUrl(pageUrl)) return new Response('Invalid URL provided', { status: 400 });
		if (!(await this.ensureBrowser())) return new Response('Could not start browser instance', { status: 500 });

		return subpageCrawl
			? this.crawlSubPages(pageUrl, enableDetailedResponse)
			: this.crawlSinglePage(pageUrl, enableDetailedResponse, contentType);
	}

	// Ensure browser is running with retry logic
	async ensureBrowser(): Promise<boolean> {
		let retries = 3;
		while (retries > 0) {
			if (!this.browser || !this.browser.isConnected()) {
				try {
					this.browser = await puppeteer.launch(this.env.MFBROWSER);
					return true;
				} catch (e) {
					console.error(`Failed to start browser: ${e}`);
					retries--;
					if (retries === 0) return false;

					const sessions = await puppeteer.sessions(this.env.MFBROWSER);
					for (const session of sessions) {
						const b = await puppeteer.connect(this.env.MFBROWSER, session.sessionId);
						await b.close();
					}
				}
			} else {
				return true;
			}
		}
		return false;
	}

	// Fetch and convert webpage(s) to Markdown
	async getWebsiteMarkdown({ urls, enableDetailedResponse, env }: { urls: string[]; enableDetailedResponse: boolean; env: Env }) {
		this.keptAliveInSeconds = 0;
		if (!(await this.ensureBrowser())) {
			return [{ url: urls[0], md: 'Could not start browser instance' }];
		}

		return Promise.all(
			urls.map(async (url) => {
				const ip = this.request?.headers.get('cf-connecting-ip') || '';
				if (this.token !== env.BACKEND_SECURITY_TOKEN) {
					const { success } = await env.RENDER_RATE_LIMITER.limit({ key: ip });
					if (!success) return { url, md: 'Rate limit exceeded' };
				}

				const cacheKey = url + (enableDetailedResponse ? '-detailed' : '') + (this.llmFilter ? '-llm' : '');
				const cached = await env.BROWSER_KV.get(cacheKey);
				if (cached) return { url, md: cached };

				// Handle Twitter/X URLs
				if (url.startsWith('https://x.com') || url.startsWith('https://twitter.com')) {
					const tweetId = url.split('/').pop();
					if (!tweetId) return { url, md: 'Invalid tweet URL' };

					const tweetCached = await env.BROWSER_KV.get(tweetId);
					if (tweetCached) return { url, md: tweetCached };

					const tweet = await this.helper.handleTweet(tweetId);
					if (!tweet || !tweet.text) return { url, md: 'Tweet not found' };

					const tweetMd = `Tweet from @${tweet.user?.name ?? tweet.user?.screen_name ?? 'Unknown'}\n\n${tweet.text}\nImages: ${
						tweet.photos ? tweet.photos.map((p) => p.url).join(', ') : 'none'
					}\nTime: ${tweet.created_at}, Likes: ${tweet.favorite_count}, Retweets: ${tweet.conversation_count}\n\nraw: ${JSON.stringify(
						tweet
					)}`;
					await env.BROWSER_KV.put(tweetId, tweetMd);
					return { url, md: tweetMd };
				}

				let md = await this.fetchAndProcessPage(url, enableDetailedResponse);
				if (this.llmFilter) {
					const { response } = (await env.AI_AGENT.run('@cf/mistral/mistral-7b-instruct-v0.1', {
						prompt: `Convert this webpage content to clean Markdown, removing ads and irrelevant info:\n${md}\n\`\`\`markdown\n`,
						temperature: 0.2,
					})) as { response: string };
					md = response;
				}

				await env.BROWSER_KV.put(cacheKey, md, { expirationTtl: 1800 });
				return { url, md };
			})
		);
	}

	// Crawl a single page
	async crawlSinglePage(url: string, enableDetailedResponse: boolean, contentType: string) {
		const md = await this.getWebsiteMarkdown({ urls: [url], enableDetailedResponse, env: this.env });
		return contentType === 'json' ? new Response(JSON.stringify(md), { status: 200 }) : new Response(md[0].md, { status: 200 });
	}

	// Crawl subpages
	async crawlSubPages(baseUrl: string, enableDetailedResponse: boolean) {
		const page = await this.browser!.newPage();
		try {
			await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT });
			const links = await this.extractLinks(page, baseUrl);
			const uniqueLinks = Array.from(new Set(links)).slice(0, 10);
			const md = await this.getWebsiteMarkdown({ urls: uniqueLinks, enableDetailedResponse, env: this.env });
			return new Response(JSON.stringify(md), { status: 200 });
		} catch (error) {
			console.error(`Subpage crawl failed for ${baseUrl}: ${error}`);
			return new Response('Error crawling subpages', { status: 500 });
		} finally {
			await page.close().catch((e) => console.error(`Page close error: ${e}`));
		}
	}

	// Extract links from a page
	async extractLinks(page: Page, baseUrl: string): Promise<string[]> {
		return page.evaluate((baseUrl) => {
			return Array.from(document.querySelectorAll('a'))
				.map((link) => (link as HTMLAnchorElement).href)
				.filter((link) => link.startsWith(baseUrl));
		}, baseUrl);
	}

	// Fetch and process a page into Markdown
	async fetchAndProcessPage(url: string, enableDetailedResponse: boolean): Promise<string> {
		const page = await this.browser!.newPage();
		try {
			// Set timeout and wait for page to stabilize
			await page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
			await page.goto(url, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT });

			// Attempt script injection with Readability and Turndown
			try {
				const markdown = await page.evaluate(async (enableDetailedResponse) => {
					// Inject Readability.js
					const readabilityScript = document.createElement('script');
					readabilityScript.src = 'https://unpkg.com/@mozilla/readability/Readability.js';
					document.head.appendChild(readabilityScript);

					// Inject Turndown.js
					const turndownScript = document.createElement('script');
					turndownScript.src = 'https://unpkg.com/turndown/dist/turndown.js';
					document.head.appendChild(turndownScript);

					// Wait for scripts to load (timeout after 2 seconds)
					await new Promise((resolve, reject) => {
						let loaded = 0;
						const checkLoaded = () => {
							loaded++;
							if (loaded === 2) resolve(true);
						};
						readabilityScript.onload = checkLoaded;
						turndownScript.onload = checkLoaded;
						setTimeout(() => reject(new Error('Script load timeout')), 2000);
					});

					// Use Readability to parse content
					const reader = new (window as any).Readability(document.cloneNode(true), {
						charThreshold: 0,
						keepClasses: true,
						nbTopCandidates: 500,
					});
					const article = reader.parse();

					// Convert to Markdown with Turndown
					const turndownService = new (window as any).TurndownService();
					const doc = document.cloneNode(true) as Document;
					doc.querySelectorAll('script, style, iframe, noscript').forEach((el) => el.remove());

					return turndownService.turndown(enableDetailedResponse ? doc.documentElement.outerHTML : article.content);
				}, enableDetailedResponse);

				console.log(`Successfully processed ${url} with script injection`);
				return markdown || 'No content extracted';
			} catch (scriptError) {
				console.error(`Script injection failed for ${url}: ${scriptError}, falling back to manual Markdown`);

				// Fallback to manual Markdown conversion
				const fallbackMarkdown = await page.evaluate((enableDetailedResponse) => {
					// Manual HTML-to-Markdown conversion
					function htmlToMarkdown(html: string): string {
						const cleaned = html.replace(
							/<script[\s\S]*?>[\s\S]*?<\/script>|<style[\s\S]*?>[\s\S]*?<\/style>|<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi,
							''
						);
						let md = cleaned
							.replace(/<h1[\s\S]*?>(.*?)<\/h1>/gi, '# $1\n\n')
							.replace(/<h2[\s\S]*?>(.*?)<\/h2>/gi, '## $1\n\n')
							.replace(/<h3[\s\S]*?>(.*?)<\/h3>/gi, '### $1\n\n')
							.replace(/<p[\s\S]*?>(.*?)<\/p>/gi, '$1\n\n')
							.replace(/<a[\s\S]*?href="(.*?)"[\s\S]*?>(.*?)<\/a>/gi, '[$2]($1)')
							.replace(/<strong[\s\S]*?>(.*?)<\/strong>|<b[\s\S]*?>(.*?)<\/b>/gi, '**$1$2**')
							.replace(/<em[\s\S]*?>(.*?)<\/em>|<i[\s\S]*?>(.*?)<\/i>/gi, '_$1$2_')
							.replace(/<li[\s\S]*?>(.*?)<\/li>/gi, '- $1\n')
							.replace(/<br[\s\S]*?>/gi, '\n')
							.replace(/<[^>]+>/g, '')
							.replace(/\s+\n/g, '\n')
							.trim();
						return md;
					}

					// Extract content based on preference
					const doc = document.cloneNode(true) as Document;
					doc.querySelectorAll('script, style, iframe, noscript').forEach((el) => el.remove());
					const mainContent = doc.querySelector('main, article, #readme') || doc.body;
					const content = enableDetailedResponse ? doc.body.innerHTML : mainContent.innerHTML;

					return htmlToMarkdown(content);
				}, enableDetailedResponse);

				console.log(`Fallback Markdown generated for ${url}`);
				return fallbackMarkdown || 'No content extracted';
			}
		} catch (error) {
			console.error(`Page processing failed for ${url}: ${error}`);
			// Ultimate fallback to raw text
			try {
				const textContent = await page.evaluate(() => document.body.innerText);
				return textContent || 'Error processing page';
			} catch (fallbackError) {
				console.error(`Ultimate fallback failed for ${url}: ${fallbackError}`);
				return 'Error processing page';
			}
		} finally {
			await page.close().catch((e) => console.error(`Page close error for ${url}: ${e}`));
		}
	}

	// Extract metadata from a page
	async extractMetadata(url: string) {
		const cacheKey = `metadata-${url}`;
		const cached = await this.env.BROWSER_KV.get(cacheKey);
		if (cached) {
			try {
				console.log(`Returning cached metadata for ${url}`);
				return JSON.parse(cached);
			} catch (e) {
				console.error(`Cached metadata parse error for ${url}: ${e}`);
			}
		}

		const page = await this.browser!.newPage();
		try {
			console.log(`Navigating to ${url} for metadata extraction`);
			await page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

			const metadata = await page.evaluate(() => {
				const getMeta = (sel: string) => document.querySelector(sel)?.getAttribute('content') || null;
				return {
					title: document.title,
					description: getMeta('meta[name="description"]'),
					keywords: getMeta('meta[name="keywords"]'),
					author: getMeta('meta[name="author"]'),
					favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href') || null,
					canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
					openGraph: {
						title: getMeta('meta[property="og:title"]'),
						description: getMeta('meta[property="og:description"]'),
						image: getMeta('meta[property="og:image"]'),
					},
					twitter: {
						card: getMeta('meta[name="twitter:card"]'),
						title: getMeta('meta[name="twitter:title"]'),
						description: getMeta('meta[name="twitter:description"]'),
					},
				};
			});

			console.log(`Metadata extracted for ${url}: ${JSON.stringify(metadata)}`);
			await this.env.BROWSER_KV.put(cacheKey, JSON.stringify(metadata), { expirationTtl: 3600 });
			return metadata;
		} catch (error: any) {
			console.error(`Metadata extraction failed for ${url}: ${error}`);
			return { error: `Failed to extract metadata: ${error.message}` };
		} finally {
			await page.close().catch((e) => console.error(`Page close error for ${url}: ${e}`));
		}
	}

	// Keep browser alive with alarm
	async alarm() {
		this.keptAliveInSeconds += 10;
		if (this.keptAliveInSeconds < KEEP_BROWSER_ALIVE_IN_SECONDS) {
			await this.storage.setAlarm(Date.now() + TEN_SECONDS);
		} else if (this.browser) {
			await this.browser.close();
			this.browser = undefined;
		}
	}
}

// Helper class for utility functions
export class Helpers {
	isValidUrl(url: string): boolean {
		return /^(http|https):\/\/[^ "]+$/.test(url);
	}

	async handleTweet(tweetId: string): Promise<Tweet | null> {
		const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en`;
		try {
			const resp = await fetch(url, {
				headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
			});
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			return (await resp.json()) as Tweet;
		} catch (error) {
			console.error(`Tweet fetch failed for ${tweetId}: ${error}`);
			return null;
		}
	}

	initialResponse() {
		return new Response(HTML, {
			headers: { 'content-type': 'text/html;charset=UTF-8' },
		});
	}
}

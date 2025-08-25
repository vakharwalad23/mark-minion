import type { Browser, Page } from '@cloudflare/puppeteer';
import { Env } from '../../worker-configuration';
import { BotProtectionBypass } from '../utils/bot-protection';
import { AIUtils } from '../utils/ai-utils';

export class ContentProcessor {
	private env: Env;
	private botProtection: BotProtectionBypass;
	private aiUtils: AIUtils;

	constructor(env: Env) {
		this.env = env;
		this.botProtection = new BotProtectionBypass();
		this.aiUtils = new AIUtils(env);
	}

	async processWebpage(browser: Browser, url: string, enableDetailedResponse: boolean, filter: boolean, request: Request) {
		const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'localhost';
		const cacheKey = url + (enableDetailedResponse ? '-detailed' : '') + (filter ? '-llm' : '');

		const cached = await this.env.BROWSER_KV.get(cacheKey);
		if (cached) {
			try {
				const cachedData = JSON.parse(cached);
				return {
					url,
					content: cachedData.content || cached,
					metadata: {
						...cachedData.metadata,
						cached: true,
						retrievedAt: new Date().toISOString(),
					},
				};
			} catch {
				return {
					url,
					content: cached,
					metadata: {
						cached: true,
						retrievedAt: new Date().toISOString(),
					},
				};
			}
		}

		const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
		if (token !== this.env.BACKEND_SECURITY_TOKEN) {
			const { success } = await this.env.RENDER_RATE_LIMITER.limit({ key: ip });
			if (!success) {
				return { url, content: 'Rate limit exceeded', metadata: { error: 'rate_limited' } };
			}
		}

		const page = await browser.newPage();
		await this.botProtection.setupPage(page);

		try {
			const navigationSuccess = await this.botProtection.navigateWithRetry(page, url);
			if (!navigationSuccess) {
				throw new Error('Failed to navigate after multiple attempts');
			}

			let content = await this.extractContent(page, enableDetailedResponse);
			const metadata = await this.extractPageMetadata(page);

			if (filter && content.length > 1000) {
				content = await this.aiUtils.applyChunkedFiltering(content);
			}

			const result = {
				url,
				content,
				metadata: {
					...metadata,
					extractedAt: new Date().toISOString(),
					contentLength: content.length,
					cached: false,
				},
			};

			await this.env.BROWSER_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 1800 });

			return result;
		} catch (error: any) {
			console.error(`Content processing failed for ${url}: ${error}`);
			return {
				url,
				content: `Error processing page: ${error.message}`,
				metadata: { error: error.message, cached: false },
			};
		} finally {
			await page.close().catch((e) => console.error(`Page close error: ${e}`));
		}
	}

	async processSubpages(browser: Browser, baseUrl: string, enableDetailedResponse: boolean, filter: boolean, request: Request) {
		const page = await browser.newPage();
		await this.botProtection.setupPage(page);

		try {
			const navigationSuccess = await this.botProtection.navigateWithRetry(page, baseUrl);
			if (!navigationSuccess) {
				throw new Error('Failed to navigate to base URL');
			}

			const links = await this.extractLinks(page, baseUrl);
			const uniqueLinks = Array.from(new Set(links)).slice(0, 10);

			const results = await Promise.all(
				uniqueLinks.map((url) => this.processWebpage(browser, url, enableDetailedResponse, filter, request))
			);

			return results;
		} catch (error: any) {
			console.error(`Subpage crawl failed for ${baseUrl}: ${error}`);
			return [{ url: baseUrl, content: 'Error crawling subpages', metadata: { error: error.message } }];
		} finally {
			await page.close().catch((e) => console.error(`Page close error: ${e}`));
		}
	}

	private async extractContent(page: Page, enableDetailedResponse: boolean): Promise<string> {
		try {
			const markdown = await page.evaluate(async (detailed) => {
				const readabilityScript = document.createElement('script');
				readabilityScript.src = 'https://unpkg.com/@mozilla/readability/Readability.js';
				document.head.appendChild(readabilityScript);

				const turndownScript = document.createElement('script');
				turndownScript.src = 'https://unpkg.com/turndown/dist/turndown.js';
				document.head.appendChild(turndownScript);

				await new Promise((resolve, reject) => {
					let loaded = 0;
					const checkLoaded = () => {
						loaded++;
						if (loaded === 2) resolve(true);
					};
					readabilityScript.onload = checkLoaded;
					turndownScript.onload = checkLoaded;
					setTimeout(() => reject(new Error('Script load timeout')), 3000);
				});

				const reader = new (window as any).Readability(document.cloneNode(true), {
					charThreshold: 0,
					keepClasses: true,
					nbTopCandidates: 500,
				});
				const article = reader.parse();

				const turndownService = new (window as any).TurndownService({
					headingStyle: 'atx',
					bulletListMarker: '-',
					codeBlockStyle: 'fenced',
				});

				const doc = document.cloneNode(true) as Document;
				doc.querySelectorAll('script, style, iframe, noscript').forEach((el) => el.remove());

				return turndownService.turndown(detailed ? doc.documentElement.outerHTML : article.content);
			}, enableDetailedResponse);

			return markdown || 'No content extracted';
		} catch (error) {
			console.error('Advanced extraction failed, using fallback:', error);
			return this.fallbackExtraction(page, enableDetailedResponse);
		}
	}

	private async fallbackExtraction(page: Page, enableDetailedResponse: boolean): Promise<string> {
		return page.evaluate((detailed) => {
			function htmlToMarkdown(html: string): string {
				const cleaned = html.replace(
					/<script[\s\S]*?>[\s\S]*?<\/script>|<style[\s\S]*?>[\s\S]*?<\/style>|<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi,
					''
				);

				return cleaned
					.replace(/<h([1-6])[\s\S]*?>(.*?)<\/h[1-6]>/gi, (_, level, text) => '#'.repeat(parseInt(level)) + ' ' + text + '\n\n')
					.replace(/<p[\s\S]*?>(.*?)<\/p>/gi, '$1\n\n')
					.replace(/<a[\s\S]*?href="(.*?)"[\s\S]*?>(.*?)<\/a>/gi, '[$2]($1)')
					.replace(/<strong[\s\S]*?>(.*?)<\/strong>|<b[\s\S]*?>(.*?)<\/b>/gi, '**$1$2**')
					.replace(/<em[\s\S]*?>(.*?)<\/em>|<i[\s\S]*?>(.*?)<\/i>/gi, '_$1$2_')
					.replace(/<li[\s\S]*?>(.*?)<\/li>/gi, '- $1\n')
					.replace(/<br[\s\S]*?>/gi, '\n')
					.replace(/<[^>]+>/g, '')
					.replace(/\s+\n/g, '\n')
					.trim();
			}

			const doc = document.cloneNode(true) as Document;
			doc.querySelectorAll('script, style, iframe, noscript').forEach((el) => el.remove());
			const mainContent = doc.querySelector('main, article, #readme, .content') || doc.body;
			const content = detailed ? doc.body.innerHTML : mainContent.innerHTML;

			return htmlToMarkdown(content);
		}, enableDetailedResponse);
	}

	private async extractPageMetadata(page: Page) {
		return page.evaluate(() => {
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
	}

	private async extractLinks(page: Page, baseUrl: string): Promise<string[]> {
		return page.evaluate((baseUrl) => {
			return Array.from(document.querySelectorAll('a'))
				.map((link) => (link as HTMLAnchorElement).href)
				.filter((link) => link.startsWith(baseUrl) && link !== baseUrl);
		}, baseUrl);
	}
}

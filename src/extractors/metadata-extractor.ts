import type { Browser, Page } from '@cloudflare/puppeteer';
import { Env } from '../../worker-configuration';
import { PageMetadata } from '../types';

export class MetadataExtractor {
	async extract(browser: Browser, url: string, env: Env): Promise<PageMetadata> {
		const cacheKey = `metadata-${url}`;

		// Check cache first
		const cached = await env.BROWSER_KV.get(cacheKey);
		if (cached) {
			try {
				console.log(`Returning cached metadata for ${url}`);
				return JSON.parse(cached) as PageMetadata;
			} catch (e) {
				console.error(`Cached metadata parse error for ${url}: ${e}`);
			}
		}

		const startTime = Date.now();
		const page = await browser.newPage();

		try {
			console.log(`Navigating to ${url} for metadata extraction`);
			await page.setDefaultNavigationTimeout(30000);
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

			const metadata = await this.extractPageMetadata(page, url, startTime);

			// Cache the result
			await env.BROWSER_KV.put(cacheKey, JSON.stringify(metadata), { expirationTtl: 3600 });
			console.log(`Metadata extracted and cached for ${url}`);

			return metadata;
		} catch (error: any) {
			console.error(`Metadata extraction failed for ${url}: ${error}`);
			return {
				url,
				title: null,
				description: null,
				keywords: null,
				author: null,
				favicon: null,
				canonical: null,
				language: null,
				charset: null,
				robots: null,
				viewport: null,
				openGraph: {
					title: null,
					description: null,
					image: null,
					url: null,
					type: null,
					siteName: null,
					locale: null,
				},
				twitter: {
					card: null,
					title: null,
					description: null,
					image: null,
					site: null,
					creator: null,
				},
				schema: [],
				links: {
					stylesheets: [],
					feeds: [],
					alternates: [],
				},
				images: [],
				headings: {
					h1: [],
					h2: [],
					h3: [],
				},
				wordCount: 0,
				loadTime: Date.now() - startTime,
				extractedAt: new Date().toISOString(),
				error: error.message,
			};
		} finally {
			await page.close().catch((e) => console.error(`Page close error for ${url}: ${e}`));
		}
	}

	private async extractPageMetadata(page: Page, url: string, startTime: number): Promise<PageMetadata> {
		return page.evaluate(
			(url, startTime) => {
				const getMeta = (selector: string): string | null => {
					const element = document.querySelector(selector);
					return element?.getAttribute('content') || null;
				};

				const getMultipleMeta = (selector: string): string[] => {
					return Array.from(document.querySelectorAll(selector))
						.map((el) => el.getAttribute('content') || el.getAttribute('href'))
						.filter(Boolean) as string[];
				};

				const getTextContent = (selector: string): string[] => {
					return Array.from(document.querySelectorAll(selector))
						.map((el) => el.textContent?.trim())
						.filter(Boolean) as string[];
				};

				// Extract JSON-LD structured data
				const extractJsonLd = (): any[] => {
					const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
					return scripts
						.map((script) => {
							try {
								return JSON.parse(script.textContent || '');
							} catch {
								return null;
							}
						})
						.filter(Boolean);
				};

				// Count words in body text
				const countWords = (): number => {
					const text = document.body?.innerText || '';
					return text
						.trim()
						.split(/\s+/)
						.filter((word) => word.length > 0).length;
				};

				// Extract images
				const extractImages = (): string[] => {
					return Array.from(document.querySelectorAll('img[src]'))
						.map((img) => (img as HTMLImageElement).src)
						.filter((src) => src && !src.startsWith('data:'))
						.slice(0, 10); // Limit to first 10 images
				};

				// Get favicon
				const getFavicon = (): string | null => {
					const selectors = ['link[rel="icon"]', 'link[rel="shortcut icon"]', 'link[rel="apple-touch-icon"]'];

					for (const selector of selectors) {
						const element = document.querySelector(selector);
						if (element) {
							const href = element.getAttribute('href');
							if (href) {
								return href.startsWith('http') ? href : new URL(href, url).href;
							}
						}
					}
					return null;
				};

				return {
					url,
					title: document.title || null,
					description: getMeta('meta[name="description"]') || getMeta('meta[property="description"]'),
					keywords: getMeta('meta[name="keywords"]'),
					author: getMeta('meta[name="author"]'),
					favicon: getFavicon(),
					canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
					language: document.documentElement?.lang || getMeta('meta[name="language"]'),
					charset: document.characterSet || null,
					robots: getMeta('meta[name="robots"]'),
					viewport: getMeta('meta[name="viewport"]'),

					// Open Graph metadata
					openGraph: {
						title: getMeta('meta[property="og:title"]'),
						description: getMeta('meta[property="og:description"]'),
						image: getMeta('meta[property="og:image"]'),
						url: getMeta('meta[property="og:url"]'),
						type: getMeta('meta[property="og:type"]'),
						siteName: getMeta('meta[property="og:site_name"]'),
						locale: getMeta('meta[property="og:locale"]'),
					},

					// Twitter Card metadata
					twitter: {
						card: getMeta('meta[name="twitter:card"]'),
						title: getMeta('meta[name="twitter:title"]'),
						description: getMeta('meta[name="twitter:description"]'),
						image: getMeta('meta[name="twitter:image"]'),
						site: getMeta('meta[name="twitter:site"]'),
						creator: getMeta('meta[name="twitter:creator"]'),
					},

					// Structured data
					schema: extractJsonLd(),

					// Links
					links: {
						stylesheets: getMultipleMeta('link[rel="stylesheet"]').map((href) =>
							href.startsWith('http') ? href : new URL(href, url).href
						),
						feeds: getMultipleMeta('link[type="application/rss+xml"], link[type="application/atom+xml"]'),
						alternates: getMultipleMeta('link[rel="alternate"]'),
					},

					// Content analysis
					images: extractImages(),
					headings: {
						h1: getTextContent('h1'),
						h2: getTextContent('h2').slice(0, 5), // Limit to first 5
						h3: getTextContent('h3').slice(0, 5), // Limit to first 5
					},
					wordCount: countWords(),
					loadTime: Date.now() - startTime,
					extractedAt: new Date().toISOString(),
				};
			},
			url,
			startTime
		);
	}
}

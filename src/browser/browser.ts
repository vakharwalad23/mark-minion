import puppeteer from '@cloudflare/puppeteer';
import type { Browser as B } from '@cloudflare/puppeteer';
import { Env } from '../../worker-configuration';
import { ContentProcessor } from '../processors/content-processor';
import { DocumentProcessor } from '../processors/document-processor';
import { VideoProcessor } from '../processors/video-processor';
import { TwitterProcessor } from '../processors/twitter-processor';
import { MetadataExtractor } from '../extractors/metadata-extractor';
import { Helpers } from '../utils/helpers';
import { BotProtectionBypass } from '../utils/bot-protection';

const KEEP_BROWSER_ALIVE_IN_SECONDS = 60;
const TEN_SECONDS = 10000;

export class Browser {
	state: DurableObjectState;
	env: Env;
	keptAliveInSeconds: number;
	storage: DurableObjectStorage;
	browser: B | undefined;
	request: Request | undefined;
	token: string;
	helper: Helpers;
	contentProcessor: ContentProcessor;
	documentProcessor: DocumentProcessor;
	videoProcessor: VideoProcessor;
	twitterProcessor: TwitterProcessor;
	metadataExtractor: MetadataExtractor;
	botProtection: BotProtectionBypass;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		this.keptAliveInSeconds = 0;
		this.storage = this.state.storage;
		this.request = undefined;
		this.token = '';
		this.helper = new Helpers();
		this.contentProcessor = new ContentProcessor(env);
		this.documentProcessor = new DocumentProcessor(env);
		this.videoProcessor = new VideoProcessor(env);
		this.twitterProcessor = new TwitterProcessor(env);
		this.metadataExtractor = new MetadataExtractor();
		this.botProtection = new BotProtectionBypass();
	}

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
			return this.handleMetadataRequest(url);
		}

		// Regular crawling
		const pageUrl = url.searchParams.get('url');
		const enableDetailedResponse = url.searchParams.get('detailed') === 'true';
		const subpageCrawl = url.searchParams.get('subpage') === 'true';
		const unnecessaryFilter = url.searchParams.get('unnecessaryfilter') === 'true';
		const contentType = request.headers.get('content-type') === 'application/json' ? 'json' : 'text';
		this.token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';

		if (!pageUrl) return this.helper.initialResponse();
		if (!this.helper.isValidUrl(pageUrl)) return new Response('Invalid URL provided', { status: 400 });

		// Determine content type and route to appropriate processor
		const urlType = await this.helper.determineUrlType(pageUrl);

		if (urlType === 'document') {
			return this.handleDocumentRequest(pageUrl, enableDetailedResponse, unnecessaryFilter, contentType);
		}

		if (urlType === 'video') {
			return this.handleVideoRequest(pageUrl, enableDetailedResponse, contentType);
		}

		if (urlType === 'twitter') {
			return this.handleTwitterRequest(pageUrl, contentType);
		}

		// Regular webpage processing
		if (!(await this.ensureBrowser())) return new Response('Could not start browser instance', { status: 500 });

		return subpageCrawl
			? this.crawlSubPages(pageUrl, enableDetailedResponse, unnecessaryFilter)
			: this.crawlSinglePage(pageUrl, enableDetailedResponse, unnecessaryFilter, contentType);
	}

	async handleMetadataRequest(url: URL) {
		const targetUrl = url.searchParams.get('url');
		if (!targetUrl) {
			return new Response('Missing URL parameter', { status: 400 });
		}
		if (!this.helper.isValidUrl(targetUrl)) {
			return new Response('Invalid URL provided', { status: 400 });
		}

		const urlType = await this.helper.determineUrlType(targetUrl);

		// Handle different types of content
		if (urlType === 'document') {
			const metadata = await this.documentProcessor.extractMetadata(targetUrl);
			return new Response(JSON.stringify(metadata), {
				headers: { 'Content-Type': 'application/json' },
				status: 200,
			});
		}

		if (urlType === 'video') {
			const metadata = await this.videoProcessor.extractMetadata(targetUrl);
			return new Response(JSON.stringify(metadata), {
				headers: { 'Content-Type': 'application/json' },
				status: 200,
			});
		}

		// Regular webpage metadata
		if (!(await this.ensureBrowser())) {
			return new Response('Could not start browser instance', { status: 500 });
		}

		try {
			const metadata = await this.metadataExtractor.extract(this.browser!, targetUrl, this.env);
			return new Response(JSON.stringify(metadata), {
				headers: { 'Content-Type': 'application/json' },
				status: 200,
			});
		} catch (error: any) {
			return new Response(JSON.stringify({ error: `Failed to extract metadata: ${error.message}` }), {
				headers: { 'Content-Type': 'application/json' },
				status: 500,
			});
		}
	}

	async handleDocumentRequest(url: string, enableDetailedResponse: boolean, filter: boolean, contentType: string) {
		try {
			const result = await this.documentProcessor.process(url, enableDetailedResponse, filter);
			return contentType === 'json'
				? new Response(JSON.stringify([result]), { status: 200 })
				: new Response(result.content, { status: 200 });
		} catch (error: any) {
			return new Response(`Error processing document: ${error.message}`, { status: 500 });
		}
	}

	async handleVideoRequest(url: string, enableDetailedResponse: boolean, contentType: string) {
		try {
			const result = await this.videoProcessor.process(url, enableDetailedResponse);
			return contentType === 'json'
				? new Response(JSON.stringify([result]), { status: 200 })
				: new Response(result.content, { status: 200 });
		} catch (error: any) {
			return new Response(`Error processing video: ${error.message}`, { status: 500 });
		}
	}

	async handleTwitterRequest(url: string, contentType: string) {
		try {
			const result = await this.twitterProcessor.process(url);
			return contentType === 'json'
				? new Response(JSON.stringify([result]), { status: 200 })
				: new Response(result.content, { status: 200 });
		} catch (error: any) {
			return new Response(`Error processing tweet: ${error.message}`, { status: 500 });
		}
	}

	async crawlSinglePage(url: string, enableDetailedResponse: boolean, filter: boolean, contentType: string) {
		const result = await this.contentProcessor.processWebpage(this.browser!, url, enableDetailedResponse, filter, this.request!);

		return contentType === 'json' ? new Response(JSON.stringify([result]), { status: 200 }) : new Response(result.content, { status: 200 });
	}

	async crawlSubPages(baseUrl: string, enableDetailedResponse: boolean, filter: boolean) {
		const results = await this.contentProcessor.processSubpages(this.browser!, baseUrl, enableDetailedResponse, filter, this.request!);

		return new Response(JSON.stringify(results), { status: 200 });
	}

	async ensureBrowser(): Promise<boolean> {
		let retries = 3;
		while (retries > 0) {
			if (!this.browser || !this.browser.isConnected()) {
				try {
					this.browser = await puppeteer.launch(this.env.MFBROWSER);
					// Apply bot protection bypass
					await this.botProtection.setupBrowser(this.browser);
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

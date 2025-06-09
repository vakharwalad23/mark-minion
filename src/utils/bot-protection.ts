import type { Browser, Page } from '@cloudflare/puppeteer';

export class BotProtectionBypass {
	private userAgents = [
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	];

	async setupBrowser(browser: Browser) {
		// Set up browser-level bypass measures
		const pages = await browser.pages();
		for (const page of pages) {
			await this.setupPage(page);
		}
	}

	async setupPage(page: Page) {
		// Set random user agent
		const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
		await page.setUserAgent(userAgent);

		// Set viewport to common resolution
		await page.setViewport({ width: 1366, height: 768 });

		// Override webdriver property
		await page.evaluateOnNewDocument(() => {
			Object.defineProperty(navigator, 'webdriver', {
				get: () => undefined,
			});
		});

		// Override chrome property
		await page.evaluateOnNewDocument(() => {
			// @ts-ignore
			window.chrome = {
				runtime: {},
			};
		});

		// Override permissions with proper PermissionStatus interface
		await page.evaluateOnNewDocument(() => {
			const originalQuery = window.navigator.permissions.query;

			// Create a proper PermissionStatus mock
			const createPermissionStatus = (name: string, state: PermissionState): PermissionStatus => {
				return {
					name: name as PermissionName,
					state,
					onchange: null,
					addEventListener: () => {},
					removeEventListener: () => {},
					dispatchEvent: () => false,
				} as PermissionStatus;
			};

			window.navigator.permissions.query = (parameters: PermissionDescriptor): Promise<PermissionStatus> => {
				if (parameters.name === 'notifications') {
					const state =
						typeof Notification !== 'undefined' && Notification.permission
							? (Notification.permission as PermissionState)
							: ('default' as PermissionState);
					return Promise.resolve(createPermissionStatus('notifications', state));
				}

				// For other permissions, try to call original or return default
				try {
					return originalQuery.call(window.navigator.permissions, parameters);
				} catch {
					return Promise.resolve(createPermissionStatus(parameters.name as string, 'granted'));
				}
			};
		});

		// Override plugins
		await page.evaluateOnNewDocument(() => {
			Object.defineProperty(navigator, 'plugins', {
				get: () => [1, 2, 3, 4, 5],
			});
		});

		// Override languages
		await page.evaluateOnNewDocument(() => {
			Object.defineProperty(navigator, 'languages', {
				get: () => ['en-US', 'en'],
			});
		});

		// Override hardwareConcurrency
		await page.evaluateOnNewDocument(() => {
			Object.defineProperty(navigator, 'hardwareConcurrency', {
				get: () => 4,
			});
		});

		// Override deviceMemory if it exists
		await page.evaluateOnNewDocument(() => {
			if ('deviceMemory' in navigator) {
				Object.defineProperty(navigator, 'deviceMemory', {
					get: () => 8,
				});
			}
		});

		// Override battery API to prevent detection
		await page.evaluateOnNewDocument(() => {
			if ('getBattery' in navigator) {
				// @ts-ignore
				navigator.getBattery = () =>
					Promise.resolve({
						charging: true,
						chargingTime: 0,
						dischargingTime: Infinity,
						level: 1,
						addEventListener: () => {},
						removeEventListener: () => {},
						dispatchEvent: () => false,
					});
			}
		});

		// Set extra headers
		await page.setExtraHTTPHeaders({
			'Accept-Language': 'en-US,en;q=0.9',
			'Accept-Encoding': 'gzip, deflate, br',
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
			Connection: 'keep-alive',
			'Upgrade-Insecure-Requests': '1',
		});

		// Random delay to simulate human behavior
		await this.randomDelay();
	}

	async navigateWithRetry(page: Page, url: string, maxRetries = 3): Promise<boolean> {
		for (let i = 0; i < maxRetries; i++) {
			try {
				await this.randomDelay();
				await page.goto(url, {
					waitUntil: 'networkidle0',
					timeout: 30000,
				});

				// Check if we're blocked
				const isBlocked = await this.detectBlocking(page);
				if (!isBlocked) {
					// Additional check for successful page load
					const hasContent = await this.checkPageContent(page);
					if (hasContent) {
						return true;
					}
				}

				console.log(`Attempt ${i + 1} blocked or failed, retrying...`);
				await this.randomDelay(2000, 5000);
			} catch (error) {
				console.error(`Navigation attempt ${i + 1} failed:`, error);
				if (i === maxRetries - 1) throw error;
				await this.randomDelay(1000, 3000);
			}
		}
		return false;
	}

	private async detectBlocking(page: Page): Promise<boolean> {
		try {
			// Check for common blocking indicators
			const blockingSelectors = [
				'[class*="captcha"]',
				'[id*="captcha"]',
				'[class*="blocked"]',
				'[class*="access-denied"]',
				'[class*="cloudflare"]',
				'#cf-wrapper',
				'.cf-error-overview',
				'[class*="bot-protection"]',
				'[class*="security-check"]',
				'.challenge-form',
			];

			for (const selector of blockingSelectors) {
				const element = await page.$(selector);
				if (element) {
					console.log(`Blocking detected: ${selector}`);
					return true;
				}
			}

			// Check page title for blocking keywords
			const title = await page.title();
			const blockingKeywords = [
				'access denied',
				'blocked',
				'captcha',
				'cloudflare',
				'security check',
				'bot protection',
				'rate limit',
				'please wait',
			];

			const titleBlocked = blockingKeywords.some((keyword) => title.toLowerCase().includes(keyword));

			if (titleBlocked) {
				console.log(`Blocking detected in title: ${title}`);
				return true;
			}

			// Check for redirect loops or empty pages
			const url = page.url();
			if (url.includes('blocked') || url.includes('captcha') || url.includes('security')) {
				console.log(`Blocking detected in URL: ${url}`);
				return true;
			}

			return false;
		} catch (error) {
			console.error('Error detecting blocking:', error);
			return false;
		}
	}

	private async checkPageContent(page: Page): Promise<boolean> {
		try {
			// Check if page has meaningful content
			const bodyText = await page.evaluate(() => document.body?.innerText || '');
			const hasContent = bodyText.trim().length > 50; // Minimum content threshold

			if (!hasContent) {
				console.log('Page appears to have no meaningful content');
				return false;
			}

			return true;
		} catch (error) {
			console.error('Error checking page content:', error);
			return false;
		}
	}

	private async randomDelay(min = 500, max = 2000) {
		const delay = Math.floor(Math.random() * (max - min + 1)) + min;
		await new Promise((resolve) => setTimeout(resolve, delay));
	}

	async solveCaptcha(page: Page): Promise<boolean> {
		// Basic captcha detection and handling
		// In a real implementation, you might integrate with a captcha solving service
		try {
			const captchaSelectors = ['iframe[src*="captcha"]', 'iframe[src*="recaptcha"]', '.g-recaptcha', '[class*="captcha"]', '#captcha'];

			for (const selector of captchaSelectors) {
				const captchaElement = await page.$(selector);
				if (captchaElement) {
					console.log(`CAPTCHA detected: ${selector} - requires external solving service`);

					// Here you could integrate with services like:
					// - 2captcha
					// - Anti-Captcha
					// - CapMonster
					// For now, we'll just wait and hope it goes away
					await this.randomDelay(5000, 10000);
					return false;
				}
			}

			return true;
		} catch (error) {
			console.error('CAPTCHA solving error:', error);
			return false;
		}
	}

	// Method to handle specific anti-bot measures
	async handleSpecificProtection(page: Page, domain: string): Promise<void> {
		const domainLower = domain.toLowerCase();

		// CloudFlare specific handling
		if (await this.isCloudFlareChallenge(page)) {
			console.log('CloudFlare challenge detected, waiting...');
			await this.waitForCloudFlare(page);
		}

		// Add more specific handlers as needed
		if (domainLower.includes('linkedin')) {
			await this.handleLinkedInProtection(page);
		}
	}

	private async isCloudFlareChallenge(page: Page): Promise<boolean> {
		try {
			const cfElements = await page.$$('#cf-wrapper, .cf-browser-verification, [data-ray]');
			return cfElements.length > 0;
		} catch {
			return false;
		}
	}

	private async waitForCloudFlare(page: Page, maxWait = 30000): Promise<void> {
		const startTime = Date.now();

		while (Date.now() - startTime < maxWait) {
			try {
				const isChallengeActive = await this.isCloudFlareChallenge(page);
				if (!isChallengeActive) {
					console.log('CloudFlare challenge completed');
					return;
				}

				await this.randomDelay(1000, 2000);
			} catch (error) {
				console.error('Error waiting for CloudFlare:', error);
				break;
			}
		}
	}

	private async handleLinkedInProtection(page: Page): Promise<void> {
		// LinkedIn-specific bot protection bypass
		try {
			// Set LinkedIn-specific headers
			await page.setExtraHTTPHeaders({
				'Sec-Fetch-Dest': 'document',
				'Sec-Fetch-Mode': 'navigate',
				'Sec-Fetch-Site': 'none',
				'Sec-Fetch-User': '?1',
			});

			// Simulate more realistic behavior
			await this.randomDelay(2000, 5000);
		} catch (error) {
			console.error('LinkedIn protection handling failed:', error);
		}
	}
}

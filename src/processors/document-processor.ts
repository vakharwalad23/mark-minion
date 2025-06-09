import { Env } from '../../worker-configuration';

export class DocumentProcessor {
	private env: Env;

	constructor(env: Env) {
		this.env = env;
	}

	async process(url: string, enableDetailedResponse: boolean, filter: boolean) {
		const fileType = await this.getFileType(url);
		const cacheKey = `doc-${url}-${fileType}-${enableDetailedResponse}-${filter}`;

		// Check cache
		const cached = await this.env.BROWSER_KV.get(cacheKey);
		if (cached) {
			return JSON.parse(cached);
		}

		let content = '';
		let metadata = {};

		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const arrayBuffer = await response.arrayBuffer();

			switch (fileType) {
				case 'pdf':
					const result = await this.processPDF(arrayBuffer);
					content = result.text;
					metadata = result.metadata;
					break;
				case 'docx':
					content = await this.processDocx(arrayBuffer);
					metadata = { type: 'docx', size: arrayBuffer.byteLength };
					break;
				case 'doc':
					content = await this.processDoc(arrayBuffer);
					metadata = { type: 'doc', size: arrayBuffer.byteLength };
					break;
				case 'txt':
					content = new TextDecoder().decode(arrayBuffer);
					metadata = { type: 'txt', size: arrayBuffer.byteLength };
					break;
				case 'md':
					content = new TextDecoder().decode(arrayBuffer);
					metadata = { type: 'markdown', size: arrayBuffer.byteLength };
					break;
				default:
					throw new Error(`Unsupported file type: ${fileType}`);
			}

			// Apply AI filtering if requested and content is large
			if (filter && content.length > 1000) {
				content = await this.applyChunkedFiltering(content);
			}

			const result = {
				url,
				content,
				metadata: {
					...metadata,
					extractedAt: new Date().toISOString(),
					fileType,
					contentLength: content.length,
				},
			};

			// Cache result
			await this.env.BROWSER_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 1800 });
			return result;
		} catch (error: any) {
			console.error(`Document processing error for ${url}: ${error}`);
			return {
				url,
				content: `Error processing document: ${error.message}`,
				metadata: { error: error.message, fileType },
			};
		}
	}

	private async processPDF(arrayBuffer: ArrayBuffer) {
		try {
			// Use pdfjs-serverless for PDF processing
			const pdfjsLib = await import('pdfjs-serverless');

			const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
			let fullText = '';
			const metadata = {
				numPages: pdf.numPages,
				info: await pdf.getMetadata(),
			};

			for (let i = 1; i <= pdf.numPages; i++) {
				const page = await pdf.getPage(i);
				const textContent = await page.getTextContent();
				const pageText = textContent.items.map((item: any) => item.str).join(' ');
				fullText += `\n\nPage ${i}:\n${pageText}`;
			}

			return { text: fullText.trim(), metadata };
		} catch (error) {
			console.error('PDF processing error:', error);
			throw new Error('Failed to process PDF');
		}
	}

	private async processDocx(arrayBuffer: ArrayBuffer) {
		try {
			// Use mammoth for DOCX processing
			const mammoth = await import('mammoth');
			const result = await mammoth.extractRawText({ arrayBuffer });
			return result.value;
		} catch (error) {
			console.error('DOCX processing error:', error);
			throw new Error('Failed to process DOCX');
		}
	}

	private async processDoc(arrayBuffer: ArrayBuffer) {
		// For legacy DOC files, we'll need a different approach
		// This is a simplified version - you might need a more robust solution
		try {
			const text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
			// Basic cleanup for DOC files (this is very basic and may not work for all DOC files)
			return text
				.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
		} catch (error) {
			console.error('DOC processing error:', error);
			throw new Error('Failed to process DOC file');
		}
	}

	private async applyChunkedFiltering(content: string): Promise<string> {
		const chunkSize = 3000; // Smaller chunks for AI processing
		const chunks = this.chunkText(content, chunkSize);
		const filteredChunks: string[] = [];

		for (const chunk of chunks) {
			try {
				const { response } = (await this.env.AI_AGENT.run('@cf/mistral/mistral-7b-instruct-v0.1', {
					prompt: `Clean and summarize this text, removing irrelevant information and keeping important content:\n\n${chunk}\n\nCleaned text:`,
					temperature: 0.2,
					max_tokens: 1000,
				})) as { response: string };

				filteredChunks.push(response);
			} catch (error) {
				console.error('AI filtering error for chunk:', error);
				filteredChunks.push(chunk); // Keep original if filtering fails
			}
		}

		return filteredChunks.join('\n\n');
	}

	private chunkText(text: string, chunkSize: number): string[] {
		const chunks: string[] = [];
		for (let i = 0; i < text.length; i += chunkSize) {
			chunks.push(text.slice(i, i + chunkSize));
		}
		return chunks;
	}

	private async getFileType(url: string): Promise<string> {
		const urlObj = new URL(url);
		const pathname = urlObj.pathname.toLowerCase();

		// First check for file extensions
		if (pathname.endsWith('.pdf')) return 'pdf';
		if (pathname.endsWith('.docx')) return 'docx';
		if (pathname.endsWith('.doc')) return 'doc';
		if (pathname.endsWith('.txt')) return 'txt';
		if (pathname.endsWith('.md')) return 'md';

		// If no extension found, check Content-Type header
		try {
			const response = await fetch(url, { method: 'HEAD' });
			const contentType = response.headers.get('content-type')?.toLowerCase() || '';

			if (contentType.includes('application/pdf')) return 'pdf';
			if (contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) return 'docx';
			if (contentType.includes('application/msword')) return 'doc';
			if (contentType.includes('text/plain')) return 'txt';
			if (contentType.includes('text/markdown')) return 'md';
			if (contentType.includes('application/octet-stream')) {
				// For Google Drive, try to infer from URL parameters or make a test request
				if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
					return await this.inferGoogleDriveFileType(url);
				}
			}
		} catch (error) {
			console.error('Error checking content-type:', error);
		}

		return 'unknown';
	}

	private async inferGoogleDriveFileType(url: string): Promise<string> {
		try {
			// Try to get a small range of the file to check magic bytes
			const response = await fetch(url, {
				headers: { Range: 'bytes=0-10' },
				method: 'GET',
			});

			if (response.ok) {
				const buffer = await response.arrayBuffer();
				const bytes = new Uint8Array(buffer);

				// Check magic bytes for different file types
				if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
					return 'pdf'; // %PDF
				}
				if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
					return 'docx'; // ZIP-based (DOCX)
				}
				if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
					return 'doc'; // OLE2 (DOC)
				}
			}
		} catch (error) {
			console.error('Error inferring Google Drive file type:', error);
		}

		return 'pdf';
	}

	async extractMetadata(url: string) {
		try {
			const response = await fetch(url, { method: 'HEAD' });
			const contentType = response.headers.get('content-type') || '';
			const contentLength = response.headers.get('content-length') || '0';
			const lastModified = response.headers.get('last-modified') || '';

			return {
				url,
				contentType,
				contentLength: parseInt(contentLength),
				lastModified,
				fileType: this.getFileType(url),
				extractedAt: new Date().toISOString(),
			};
		} catch (error: any) {
			return {
				url,
				error: error.message,
				extractedAt: new Date().toISOString(),
			};
		}
	}
}

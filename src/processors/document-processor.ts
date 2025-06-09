import { Env } from '../../worker-configuration';
import { DocumentResult } from '../types';
import { AIUtils } from '../utils/ai-utils';

export class DocumentProcessor {
	private env: Env;
	private aiUtils: AIUtils;

	constructor(env: Env) {
		this.env = env;
		this.aiUtils = new AIUtils(env);
	}

	async process(url: string, enableDetailedResponse: boolean, filter: boolean): Promise<DocumentResult> {
		const processedUrl = this.normalizeUrl(url);
		const fileType = await this.detectFileType(processedUrl);
		const cacheKey = `doc-${url}-${fileType}-${enableDetailedResponse}-${filter}`;

		const cached = await this.env.BROWSER_KV.get(cacheKey);
		if (cached) return JSON.parse(cached);

		try {
			const response = await fetch(processedUrl);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const arrayBuffer = await response.arrayBuffer();
			const { content, metadata } = await this.extractContent(arrayBuffer, fileType);

			const filteredContent = filter && content.length > 1000 ? await this.aiUtils.applyChunkedFiltering(content) : content;

			const result: DocumentResult = {
				url,
				content: filteredContent,
				metadata: {
					...metadata,
					extractedAt: new Date().toISOString(),
					fileType,
					contentLength: filteredContent.length,
					originalUrl: url,
					processedUrl: processedUrl !== url ? processedUrl : undefined,
				},
			};

			await this.env.BROWSER_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 1800 });
			return result;
		} catch (error: any) {
			return {
				url,
				content: `Error processing document: ${error.message}`,
				metadata: {
					error: error.message,
					fileType,
					originalUrl: url,
					type: 'error',
					extractedAt: new Date().toISOString(),
					contentLength: 0,
				},
			};
		}
	}

	async extractMetadata(url: string) {
		try {
			const response = await fetch(url, { method: 'HEAD' });
			return {
				url,
				contentType: response.headers.get('content-type') || '',
				contentLength: parseInt(response.headers.get('content-length') || '0'),
				lastModified: response.headers.get('last-modified') || '',
				fileType: await this.detectFileType(url),
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

	private normalizeUrl(url: string): string {
		if (url.includes('docs.google.com/document')) {
			const docId = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/)?.[1];
			return docId ? `https://docs.google.com/document/d/${docId}/export?format=txt` : url;
		}

		if (url.includes('docs.google.com/spreadsheets')) {
			const sheetId = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
			return sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx` : url;
		}

		if (url.includes('docs.google.com/presentation')) {
			const slideId = url.match(/\/presentation\/d\/([a-zA-Z0-9-_]+)/)?.[1];
			return slideId ? `https://docs.google.com/presentation/d/${slideId}/export?format=txt` : url;
		}

		if (url.includes('drive.google.com/file')) {
			const fileId = url.match(/\/file\/d\/([a-zA-Z0-9-_]+)/)?.[1];
			return fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : url;
		}

		return url;
	}

	private async detectFileType(url: string): Promise<string> {
		if (url.includes('docs.google.com') && url.includes('export')) {
			const format = url.match(/format=([^&]+)/)?.[1]?.toLowerCase();
			const formatMap: Record<string, string> = {
				txt: 'txt',
				pdf: 'pdf',
				docx: 'docx',
				html: 'html',
				xlsx: 'xlsx',
				odt: 'txt',
				csv: 'txt',
			};
			return formatMap[format || 'txt'] || 'txt';
		}

		const pathname = new URL(url).pathname.toLowerCase();
		const extensions = ['.pdf', '.docx', '.doc', '.txt', '.md', '.html', '.htm', '.xlsx'];
		for (const ext of extensions) {
			if (pathname.endsWith(ext)) return ext.slice(1);
		}

		try {
			const response = await fetch(url, { method: 'HEAD' });
			const contentType = response.headers.get('content-type')?.toLowerCase() || '';

			const typeMap: Record<string, string> = {
				'application/pdf': 'pdf',
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
				'application/msword': 'doc',
				'text/plain': 'txt',
				'text/markdown': 'md',
				'text/html': 'html',
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
			};

			for (const [mime, type] of Object.entries(typeMap)) {
				if (contentType.includes(mime)) return type;
			}

			if (contentType.includes('application/octet-stream') && (url.includes('drive.google.com') || url.includes('docs.google.com'))) {
				return await this.detectByMagicBytes(url);
			}
		} catch (error) {
			console.error('Error checking content-type:', error);
		}

		return 'txt';
	}

	private async detectByMagicBytes(url: string): Promise<string> {
		try {
			const response = await fetch(url, {
				headers: { Range: 'bytes=0-10' },
				method: 'GET',
			});

			if (response.ok) {
				const bytes = new Uint8Array(await response.arrayBuffer());
				if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
				if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'docx';
				if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return 'doc';
			}
		} catch (error) {
			console.error('Error checking magic bytes:', error);
		}
		return 'pdf';
	}

	private async extractContent(arrayBuffer: ArrayBuffer, fileType: string) {
		const processors: Record<string, () => Promise<{ content: string; metadata: any }>> = {
			pdf: () => this.processPDF(arrayBuffer),
			docx: async () => ({
				content: await this.processDocx(arrayBuffer),
				metadata: { type: 'docx', size: arrayBuffer.byteLength },
			}),
			doc: async () => ({
				content: await this.processDoc(arrayBuffer),
				metadata: { type: 'doc', size: arrayBuffer.byteLength },
			}),
			txt: () =>
				Promise.resolve({
					content: new TextDecoder().decode(arrayBuffer),
					metadata: { type: 'txt', size: arrayBuffer.byteLength },
				}),
			md: () =>
				Promise.resolve({
					content: new TextDecoder().decode(arrayBuffer),
					metadata: { type: 'markdown', size: arrayBuffer.byteLength },
				}),
			html: () =>
				Promise.resolve({
					content: this.extractTextFromHtml(new TextDecoder().decode(arrayBuffer)),
					metadata: { type: 'html', size: arrayBuffer.byteLength },
				}),
			xlsx: async () => ({
				content: await this.processXlsx(arrayBuffer),
				metadata: { type: 'xlsx', size: arrayBuffer.byteLength },
			}),
		};

		const processor = processors[fileType];
		if (!processor) throw new Error(`Unsupported file type: ${fileType}`);

		const result = await processor();
		return { content: result.content, metadata: result.metadata };
	}

	private async processPDF(arrayBuffer: ArrayBuffer) {
		const { resolvePDFJS } = await import('pdfjs-serverless');
		const { getDocument } = await resolvePDFJS();
		const pdf = await getDocument({ data: arrayBuffer }).promise;

		let content = '';
		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const textContent = await page.getTextContent();
			const pageText = textContent.items.map((item: any) => item.str).join(' ');
			content += `\n\nPage ${i}:\n${pageText}`;
		}

		return {
			content: content.trim(),
			metadata: {
				type: 'pdf',
				size: arrayBuffer.byteLength,
				numPages: pdf.numPages,
				info: await pdf.getMetadata(),
			},
		};
	}

	private async processDocx(arrayBuffer: ArrayBuffer): Promise<string> {
		const mammoth = await import('mammoth');
		const result = await mammoth.extractRawText({ arrayBuffer });
		return result.value;
	}

	private async processDoc(arrayBuffer: ArrayBuffer): Promise<string> {
		const text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
		return text
			.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private async processXlsx(arrayBuffer: ArrayBuffer): Promise<string> {
		const XLSX = await import('xlsx');
		const workbook = XLSX.read(arrayBuffer, { type: 'array' });

		return workbook.SheetNames.map((sheetName) => {
			const worksheet = workbook.Sheets[sheetName];
			const sheetData = XLSX.utils.sheet_to_txt(worksheet);
			return `\n\nSheet: ${sheetName}\n${sheetData}`;
		})
			.join('')
			.trim();
	}

	private extractTextFromHtml(html: string): string {
		return html
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\s+/g, ' ')
			.trim();
	}
}

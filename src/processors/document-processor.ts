import { Env } from '../../worker-configuration';
import { DocumentResult } from '../types';
import { AIUtils } from '../utils/ai-utils';
import {
	MarkdownRenderer,
	TableData,
	MediaItem,
	HeadingStructure,
	CodeBlock,
	QuoteBlock,
	MetadataSection,
} from '../utils/markdown-renderer';
import { ContentAnalyzer } from '../utils/content-analyzer';
import { DocumentContent, ProcessingResult, ExtractionOptions, ContentQuality } from '../utils/markdown-content-types';

export class DocumentProcessor {
	private env: Env;
	private aiUtils: AIUtils;
	private markdownRenderer: MarkdownRenderer;

	constructor(env: Env) {
		this.env = env;
		this.aiUtils = new AIUtils(env);
		this.markdownRenderer = new MarkdownRenderer({
			headingStyle: 'atx',
			bulletStyle: '-',
			codeBlockStyle: 'fenced',
			tableAlignment: true,
			includeTableOfContents: true,
			includeFrontmatter: true,
		});
	}

	async process(url: string, enableDetailedResponse: boolean, filter: boolean): Promise<DocumentResult> {
		const processedUrl = this.normalizeUrl(url);
		const fileType = await this.detectFileType(processedUrl);
		const cacheKey = `doc-${url}-${fileType}-${enableDetailedResponse}-${filter}`;

		const cached = await this.env.BROWSER_KV.get(cacheKey);
		if (cached) {
			const cachedResult = JSON.parse(cached);
			// Convert cached result to new format if needed
			return this.convertToDocumentResult(cachedResult);
		}

		try {
			const response = await fetch(processedUrl, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
					Accept: 'application/pdf,application/octet-stream,*/*',
					'Accept-Language': 'en-US,en;q=0.9',
				},
			});

			if (!response.ok) {
				throw this.createHttpError(response.status, response.statusText);
			}

			const arrayBuffer = await response.arrayBuffer();
			const processingResult = await this.processDocumentContent(arrayBuffer, fileType, {
				includeImages: enableDetailedResponse,
				includeTables: true,
				includeCharts: enableDetailedResponse,
				includeDiagrams: enableDetailedResponse,
				includeCode: true,
				includeQuotes: true,
				includeMetadata: true,
				preserveFormatting: enableDetailedResponse,
			});

			let content = processingResult.content;

			// Apply AI filtering if requested
			if (filter && content.length > 1000) {
				content = await this.aiUtils.applyChunkedFiltering(content);
			}

			// Create enhanced metadata
			const metadata = {
				...processingResult.metadata,
				type: processingResult.metadata.type || fileType,
				extractedAt: new Date().toISOString(),
				fileType,
				contentLength: content.length,
				originalUrl: url,
				processedUrl: processedUrl !== url ? processedUrl : undefined,
				quality: processingResult.quality,
				hasTables: (processingResult.extractedData?.tables?.length ?? 0) > 0,
				hasCharts: (processingResult.extractedData?.charts?.length ?? 0) > 0,
				hasImages: (processingResult.extractedData?.media?.length ?? 0) > 0,
			};

			const result: DocumentResult = {
				url,
				content,
				metadata,
			};

			await this.env.BROWSER_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 1800 });
			return result;
		} catch (error: any) {
			return this.createErrorResult(url, fileType, error.message);
		}
	}

	private async processDocumentContent(arrayBuffer: ArrayBuffer, fileType: string, options: ExtractionOptions): Promise<ProcessingResult> {
		const rawContent = await this.extractRawContent(arrayBuffer, fileType);
		const documentContent = await this.enhanceDocumentContent(rawContent, fileType, options);

		const markdownContent = this.generateStructuredMarkdown(documentContent, options, fileType);

		// Calculate quality by comparing original vs processed content
		const qualityScores = ContentAnalyzer.analyzeContentQuality(rawContent.content, markdownContent);
		const quality: ContentQuality = {
			...qualityScores,
			accuracyScore: Math.min(100, qualityScores.structureScore + qualityScores.completenessScore) / 2,
			issues: [],
		};

		documentContent.quality = quality;

		return {
			content: markdownContent,
			structure: documentContent.structure,
			extractedData: {
				tables: documentContent.tables,
				media: documentContent.images,
				charts: documentContent.charts,
				diagrams: documentContent.diagrams,
				codeBlocks: documentContent.codeBlocks,
				quotes: documentContent.quotes,
			},
			metadata: {
				...documentContent.metadata,
				fileType,
				size: arrayBuffer.byteLength,
			},
			quality,
		};
	}

	private generateStructuredMarkdown(documentContent: DocumentContent, options: ExtractionOptions, fileType: string): string {
		let sections: string[] = [];

		if (documentContent.structure.title) {
			sections.push(
				this.markdownRenderer.renderHeading({
					level: 1,
					content: documentContent.structure.title,
				})
			);
		}

		// Add table of contents if we have meaningful headings
		if (options.includeMetadata && this.hasMeaningfulHeadings(documentContent.structure.headings)) {
			const toc = this.markdownRenderer.createTableOfContents(documentContent.structure.headings);
			if (toc.trim()) {
				sections.push(toc);
			}
		}

		for (const section of documentContent.structure.sections) {
			switch (section.type) {
				case 'table':
					if (section.data && options.includeTables) {
						sections.push(this.markdownRenderer.renderTable(section.data as TableData));
					}
					break;
				case 'media':
					if (section.data && options.includeImages) {
						sections.push(this.markdownRenderer.renderMedia(section.data as MediaItem));
					}
					break;
				case 'code':
					if (section.data && options.includeCode) {
						sections.push(this.markdownRenderer.renderCodeBlock(section.data as CodeBlock));
					}
					break;
				case 'quote':
					if (section.data && options.includeQuotes) {
						sections.push(this.markdownRenderer.renderQuote(section.data as QuoteBlock));
					}
					break;
				default:
					sections.push(section.content);
			}
		}

		if (options.includeTables && documentContent.tables.length > 0) {
			sections.push(this.markdownRenderer.renderHeading({ level: 2, content: 'Document Tables' }));
			documentContent.tables.forEach((table, index) => {
				sections.push(this.markdownRenderer.renderTable(table));
				if (index < documentContent.tables.length - 1) {
					sections.push('');
				}
			});
		}

		if (options.includeCharts && documentContent.charts.length > 0) {
			sections.push(this.markdownRenderer.renderHeading({ level: 2, content: 'Charts and Visualizations' }));
			documentContent.charts.forEach((chart, index) => {
				let chartContent = `**Chart ${index + 1}**\n`;
				if (chart.title) chartContent += `Title: ${chart.title}\n`;
				if (chart.description) chartContent += `Description: ${chart.description}\n`;
				if (chart.extractedText && chart.extractedText.length > 0) {
					chartContent += `Extracted Data: ${chart.extractedText.join('; ')}\n`;
				}
				sections.push(chartContent);
			});
		}

		if (options.includeMetadata) {
			const metadataItems = Object.entries(documentContent.metadata)
				.filter(([key, value]) => value !== null && value !== undefined)
				.map(([key, value]) => ({
					label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
					value: value,
					format: this.inferValueFormat(value),
				}));

			if (metadataItems.length > 0) {
				const metadataSection: MetadataSection = {
					title: 'Document Metadata',
					items: metadataItems,
				};
				sections.push(this.markdownRenderer.renderMetadata(metadataSection));
			}
		}

		if (documentContent.quality) {
			sections.push(this.markdownRenderer.renderHeading({ level: 2, content: 'Processing Quality' }));
			sections.push(`- **Structure Score:** ${documentContent.quality.structureScore}/100`);
			sections.push(`- **Completeness Score:** ${documentContent.quality.completenessScore}/100`);
			sections.push(`- **Readability Score:** ${documentContent.quality.readabilityScore}/100`);
			sections.push(`- **Accuracy Score:** ${documentContent.quality.accuracyScore}/100`);

			if (documentContent.quality.issues && documentContent.quality.issues.length > 0) {
				sections.push('\n**Issues Detected:**');
				for (const issue of documentContent.quality.issues) {
					const emoji = issue.type === 'error' ? '🚨' : issue.type === 'warning' ? '⚠️' : 'ℹ️';
					sections.push(`- ${emoji} ${issue.message}`);
					if (issue.suggestion) {
						sections.push(`  - *Suggestion:* ${issue.suggestion}`);
					}
				}
			}
		}

		// Create final document with metadata
		const mainContent = sections.join('\n\n');
		const docMetadata = {
			title: documentContent.structure.title || 'Document',
			url: documentContent.metadata.url || '',
			extractedAt: new Date().toISOString(),
			contentType: `Document (${fileType.toUpperCase()})`,
			author: documentContent.metadata.author || undefined,
			description: documentContent.metadata.description || undefined,
			tags: ['document', fileType],
		};

		return this.markdownRenderer.createDocument(mainContent, docMetadata);
	}

	private async enhanceDocumentContent(
		rawContent: { content: string; metadata: any },
		fileType: string,
		options: ExtractionOptions
	): Promise<DocumentContent> {
		let enhancedContent: DocumentContent = {
			structure: {
				headings: [],
				sections: [],
				metadata: rawContent.metadata,
			},
			extractedText: rawContent.content,
			tables: [],
			images: [],
			charts: [],
			diagrams: [],
			codeBlocks: [],
			quotes: [],
			metadata: rawContent.metadata,
		};

		if (options.includeTables) {
			enhancedContent.tables = await this.extractTablesFromDocument(rawContent.content, fileType);
		}

		if (options.includeCharts || options.includeDiagrams) {
			const { charts, diagrams } = await this.extractChartsAndDiagrams(rawContent.content, fileType);
			enhancedContent.charts = charts;
			enhancedContent.diagrams = diagrams;
		}

		if (options.includeCode) {
			enhancedContent.codeBlocks = this.extractCodeBlocks(rawContent.content);
		}

		if (options.includeQuotes) {
			enhancedContent.quotes = this.extractQuotes(rawContent.content);
		}

		// Analyze document structure based on content type
		if (rawContent.content.includes('<') && rawContent.content.includes('>')) {
			enhancedContent.structure = ContentAnalyzer.analyzeDocumentStructure(rawContent.content);
		} else {
			enhancedContent.structure = this.analyzePlainTextStructure(rawContent.content);
		}

		return enhancedContent;
	}

	private async extractRawContent(arrayBuffer: ArrayBuffer, fileType: string): Promise<{ content: string; metadata: any }> {
		switch (fileType) {
			case 'pdf':
				return this.processPDF(arrayBuffer);
			case 'docx':
				return {
					content: await this.processDocx(arrayBuffer),
					metadata: { type: 'docx', size: arrayBuffer.byteLength },
				};
			case 'doc':
				return {
					content: await this.processDoc(arrayBuffer),
					metadata: { type: 'doc', size: arrayBuffer.byteLength },
				};
			case 'xlsx':
				return {
					content: await this.processXlsx(arrayBuffer),
					metadata: { type: 'xlsx', size: arrayBuffer.byteLength },
				};
			case 'txt':
			case 'md':
			case 'html':
			default:
				const text = new TextDecoder().decode(arrayBuffer);
				return {
					content: fileType === 'html' ? this.extractTextFromHtml(text) : text,
					metadata: { type: fileType, size: arrayBuffer.byteLength },
				};
		}
	}

	private async extractTablesFromDocument(content: string, fileType: string): Promise<TableData[]> {
		switch (fileType) {
			case 'pdf':
				return this.extractTablesFromPDF(content);
			case 'docx':
			case 'doc':
				return this.extractTablesFromWord(content);
			case 'xlsx':
				return this.extractTablesFromExcel(content);
			case 'html':
				return ContentAnalyzer.extractTables(content);
			default:
				return [];
		}
	}

	private async extractChartsAndDiagrams(content: string, fileType: string): Promise<{ charts: any[]; diagrams: any[] }> {
		const charts = ContentAnalyzer.analyzeCharts(content);
		const diagrams: any[] = []; // TODO: Implement diagram extraction

		return { charts, diagrams };
	}

	private extractCodeBlocks(content: string): CodeBlock[] {
		const codeBlocks: CodeBlock[] = [];

		const fencedRegex = /```(\w+)?\n?([\s\S]*?)```/g;
		let match;
		while ((match = fencedRegex.exec(content)) !== null) {
			codeBlocks.push({
				content: match[2].trim(),
				language: match[1] || undefined,
			});
		}

		const indentedRegex = /(?:^|\n)( {4,}|\t+)(.+?)(?=\n\S|\n{2,}|$)/g;
		while ((match = indentedRegex.exec(content)) !== null) {
			const codeContent = match[2].trim();
			if (codeContent && !codeContent.startsWith('-') && !codeContent.startsWith('*')) {
				codeBlocks.push({
					content: codeContent,
				});
			}
		}

		return codeBlocks;
	}

	private extractQuotes(content: string): QuoteBlock[] {
		const quotes: QuoteBlock[] = [];

		const quoteRegex = /(?:^|\n)>\s*(.+?)(?=\n[^>]|\n{2,}|$)/g;
		let match;
		while ((match = quoteRegex.exec(content)) !== null) {
			quotes.push({
				content: match[1].trim(),
			});
		}

		return quotes;
	}

	private hasMeaningfulHeadings(headings: HeadingStructure[]): boolean {
		if (!headings || headings.length === 0) return false;

		const meaningfulHeadings = headings.filter((heading) => {
			const content = heading.content.trim();

			if (/\s{3,}|\t|\|/.test(content)) return false;
			if (content.length > 100) return false;
			if (/^\s*\d+\.\s*|^\s*-\s*|^\s*\*\s*/.test(content)) return false;
			if (/^\d+.*\d+.*\d+/.test(content) && /[,\/\s]/.test(content)) return false;
			if (content.length < 3) return false;

			return true;
		});

		return meaningfulHeadings.length >= 2;
	}

	private looksLikeTableData(line: string): boolean {
		if (/\s{3,}/.test(line)) return true;
		if ((line.match(/\t/g) || []).length > 2) return true;
		if ((line.match(/\|/g) || []).length > 2) return true;
		if (/^\d+.*\d+.*\d+/.test(line) && /[,\/\s]/.test(line)) return true;
		if (line.length > 150) return true;

		return false;
	}

	private analyzePlainTextStructure(content: string): any {
		const lines = content.split('\n');
		const headings: HeadingStructure[] = [];
		const sections: any[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();

			if (this.looksLikeTableData(line)) {
				continue;
			}

			if (
				line.length > 0 &&
				line.length < 100 &&
				line.length >= 3 &&
				!/\s{3,}/.test(line) &&
				(line === line.toUpperCase() || /^[A-Z][^.!?]*$/.test(line) || line.startsWith('#') || line.match(/^\d+\./))
			) {
				const level = line.startsWith('#') ? Math.min(line.split('#').length - 1, 6) : 2;
				headings.push({
					level: level as 1 | 2 | 3 | 4 | 5 | 6,
					content: line.replace(/^#+\s*/, ''),
				});
			} else if (line.length > 0) {
				sections.push({
					type: 'text',
					content: line,
				});
			}
		}

		return {
			headings,
			sections,
			metadata: {},
		};
	}

	private extractTablesFromPDF(content: string): TableData[] {
		const tables: TableData[] = [];
		const lines = content.split('\n');

		let currentTable: TableData | null = null;
		let tableRows: string[][] = [];

		for (const line of lines) {
			const columns = line.split(/\s{2,}|\t/).filter((col) => col.trim().length > 0);

			if (columns.length >= 2) {
				if (!currentTable) {
					currentTable = {
						rows: [],
					};
				}
				tableRows.push(columns);
			} else if (currentTable && tableRows.length > 0) {
				this.convertTextRowsToTableData(tableRows, tables);
				currentTable = null;
				tableRows = [];
			}
		}

		if (currentTable && tableRows.length > 0) {
			this.convertTextRowsToTableData(tableRows, tables);
		}

		return tables;
	}

	private convertTextRowsToTableData(textRows: string[][], tables: TableData[]): void {
		if (textRows.length === 0) return;

		const tableData: TableData = {
			rows: textRows.map((row, index) => ({
				cells: row.map((cell) => ({ content: cell.trim() })),
				isHeader: index === 0,
			})),
		};

		tables.push(tableData);
	}

	private extractTablesFromWord(content: string): TableData[] {
		return ContentAnalyzer.extractTables(content);
	}

	private extractTablesFromExcel(content: string): TableData[] {
		const tables: TableData[] = [];
		const lines = content.split('\n');
		let currentTable: string[] = [];

		for (const line of lines) {
			if (line.startsWith('Sheet: ') || line.trim() === '') {
				if (currentTable.length > 0) {
					const tableData = this.parseExcelTable(currentTable);
					if (tableData) {
						tables.push(tableData);
					}
					currentTable = [];
				}
			} else {
				currentTable.push(line);
			}
		}

		if (currentTable.length > 0) {
			const tableData = this.parseExcelTable(currentTable);
			if (tableData) {
				tables.push(tableData);
			}
		}

		return tables;
	}

	private parseExcelTable(lines: string[]): TableData | null {
		const tableRows: any[] = [];

		for (const line of lines) {
			const cells = line.split('\t').map((cell) => cell.trim());
			if (cells.some((cell) => cell.length > 0)) {
				tableRows.push({
					cells: cells.map((cell) => ({ content: cell })),
				});
			}
		}

		if (tableRows.length > 0) {
			if (tableRows.length > 1 && tableRows[0].cells.every((cell: any) => cell.content.length < 50)) {
				tableRows[0].isHeader = true;
			}

			return {
				rows: tableRows,
			};
		}

		return null;
	}

	private inferValueFormat(value: any): 'text' | 'number' | 'date' | 'url' | 'email' | 'boolean' {
		if (typeof value === 'boolean') return 'boolean';
		if (typeof value === 'number') return 'number';
		if (typeof value === 'string') {
			if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
			if (/^https?:\/\//.test(value)) return 'url';
			if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
		}
		return 'text';
	}

	private createHttpError(status: number, statusText: string): Error {
		switch (status) {
			case 409:
				return new Error(
					'Document temporarily unavailable (HTTP 409). This often occurs with Blob Storage due to access restrictions. Please try again later or use a direct download link.'
				);
			case 403:
				return new Error('Access forbidden (HTTP 403). The document may require authentication or have restricted access.');
			case 404:
				return new Error('Document not found (HTTP 404). Please verify the URL is correct.');
			default:
				return new Error(`HTTP ${status}: ${statusText || 'Unknown error'}`);
		}
	}

	private convertToDocumentResult(cachedResult: any): DocumentResult {
		if (cachedResult.content && cachedResult.metadata) {
			return cachedResult as DocumentResult;
		}

		return {
			url: cachedResult.url || '',
			content: cachedResult.content || cachedResult,
			metadata: {
				...cachedResult.metadata,
				extractedAt: cachedResult.metadata?.extractedAt || new Date().toISOString(),
				contentLength: cachedResult.content?.length || 0,
			},
		};
	}

	private createErrorResult(url: string, fileType: string, errorMessage: string): DocumentResult {
		return {
			url,
			content: `Error processing document: ${errorMessage}`,
			metadata: {
				error: errorMessage,
				fileType,
				originalUrl: url,
				type: 'error',
				extractedAt: new Date().toISOString(),
				contentLength: 0,
			},
		};
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
			const response = await fetch(url, {
				method: 'HEAD',
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
					Accept: '*/*',
				},
			});
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
				headers: {
					Range: 'bytes=0-10',
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
					Accept: '*/*',
				},
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
				info: (await pdf.getMetadata()).info,
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

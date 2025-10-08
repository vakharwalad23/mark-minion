/**
 * Content Analysis Utilities
 * Analyzes content structure and extracts semantic information
 */

import { HeadingStructure, TableData, TableRow, TableCell } from './markdown-renderer';
import { ChartData, DiagramData, ContentSection, DocumentStructure } from './markdown-content-types';

export class ContentAnalyzer {
	static extractHeadings(html: string): HeadingStructure[] {
		const headings: HeadingStructure[] = [];
		const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi;
		let match;

		while ((match = headingRegex.exec(html)) !== null) {
			const level = parseInt(match[1]) as 1 | 2 | 3 | 4 | 5 | 6;
			const content = this.cleanHtmlText(match[2]);
			const id = this.generateHeadingId(content);

			headings.push({
				level,
				content,
				id,
			});
		}

		return headings;
	}

	static extractTables(html: string): TableData[] {
		const tables: TableData[] = [];
		const tableRegex = /<table[^>]*>(.*?)<\/table>/gis;
		let match;

		while ((match = tableRegex.exec(html)) !== null) {
			const tableHtml = match[1];
			const table = this.parseTableHtml(tableHtml);
			if (table && table.rows.length > 0) {
				tables.push(table);
			}
		}

		return tables;
	}

	static analyzeCharts(html: string): ChartData[] {
		const charts: ChartData[] = [];

		// Look for chart-related text patterns
		const chartKeywords = [/chart\s*:\s*(.+)/gi, /graph\s*showing\s*(.+)/gi, /figure\s*\d+[:\s]*(.+)/gi];

		for (const regex of chartKeywords) {
			let match;
			while ((match = regex.exec(html)) !== null) {
				charts.push({
					type: 'unknown',
					title: this.cleanHtmlText(match[1]),
					description: `Chart detected in content`,
					extractedText: [match[0]],
				});
			}
		}

		return charts;
	}

	static analyzeDocumentStructure(html: string): DocumentStructure {
		const headings = this.extractHeadings(html);
		const sections = this.extractSections(html);
		const title = this.extractTitle(html);

		return {
			title,
			headings,
			sections,
			metadata: this.extractDocumentMetadata(html),
		};
	}

	static extractSections(html: string): ContentSection[] {
		const sections: ContentSection[] = [];

		// Split content by headings
		const headingRegex = /<h[1-6][^>]*>.*?<\/h[1-6]>/gi;
		const parts = html.split(headingRegex);

		for (let i = 1; i < parts.length; i++) {
			const content = parts[i].trim();
			if (content) {
				const section: ContentSection = {
					type: 'text',
					content: this.cleanHtmlText(content),
				};

				// Check for special content types
				if (content.includes('<table')) {
					section.type = 'table';
					const tables = this.extractTables(content);
					if (tables.length > 0) {
						section.data = tables[0];
					}
				} else if (content.includes('<pre') || content.includes('<code')) {
					section.type = 'code';
				} else if (content.includes('<blockquote')) {
					section.type = 'quote';
				}

				sections.push(section);
			}
		}

		return sections;
	}

	private static parseTableHtml(tableHtml: string): TableData | null {
		const rows: TableRow[] = [];
		let caption: string | undefined;

		const captionMatch = tableHtml.match(/<caption[^>]*>(.*?)<\/caption>/i);
		if (captionMatch) {
			caption = this.cleanHtmlText(captionMatch[1]);
		}

		const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
		let rowMatch;
		let isFirstRow = true;

		while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
			const rowHtml = rowMatch[1];
			const cells = this.parseTableRow(rowHtml);

			if (cells.length > 0) {
				const isHeader = isFirstRow && this.isHeaderRow(rowHtml);
				rows.push({
					cells,
					isHeader,
				});
				isFirstRow = false;
			}
		}

		if (rows.length === 0) return null;

		return {
			rows,
			caption,
		};
	}

	private static parseTableRow(rowHtml: string): TableCell[] {
		const cells: TableCell[] = [];
		const cellRegex = /<(th|td)[^>]*>(.*?)<\/(th|td)>/gis;
		let cellMatch;

		while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
			const cellContent = this.cleanHtmlText(cellMatch[2]);
			const cellElement = cellMatch[0];

			let alignment: 'left' | 'center' | 'right' | undefined;
			if (cellElement.includes('text-align:center') || cellElement.includes('center')) {
				alignment = 'center';
			} else if (cellElement.includes('text-align:right') || cellElement.includes('right')) {
				alignment = 'right';
			} else if (cellElement.includes('text-align:left') || cellElement.includes('left')) {
				alignment = 'left';
			}

			const colspanMatch = cellElement.match(/colspan\s*=\s*["']?(\d+)/i);
			const rowspanMatch = cellElement.match(/rowspan\s*=\s*["']?(\d+)/i);

			cells.push({
				content: cellContent,
				alignment,
				colspan: colspanMatch ? parseInt(colspanMatch[1]) : undefined,
				rowspan: rowspanMatch ? parseInt(rowspanMatch[1]) : undefined,
			});
		}

		return cells;
	}

	private static isHeaderRow(rowHtml: string): boolean {
		if (rowHtml.includes('<th')) return true;

		const headerIndicators = ['font-weight:bold', 'font-weight: bold', 'class="header"', 'class="thead"', 'background-color'];

		return headerIndicators.some((indicator) => rowHtml.includes(indicator));
	}

	private static extractTitle(html: string): string | undefined {
		const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
		if (titleMatch) {
			return this.cleanHtmlText(titleMatch[1]);
		}

		const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
		if (h1Match) {
			return this.cleanHtmlText(h1Match[1]);
		}

		return undefined;
	}

	private static extractDocumentMetadata(html: string): Record<string, any> {
		const metadata: Record<string, any> = {};

		const metaRegex = /<meta\s+([^>]+)>/gi;
		let match;

		while ((match = metaRegex.exec(html)) !== null) {
			const attributes = match[1];

			const nameMatch = attributes.match(/name\s*=\s*["']([^"']+)["']/i);
			const contentMatch = attributes.match(/content\s*=\s*["']([^"']+)["']/i);

			if (nameMatch && contentMatch) {
				metadata[nameMatch[1]] = contentMatch[1];
			}

			const propertyMatch = attributes.match(/property\s*=\s*["']([^"']+)["']/i);
			if (propertyMatch && contentMatch) {
				metadata[propertyMatch[1]] = contentMatch[1];
			}
		}

		return metadata;
	}

	private static cleanHtmlText(html: string): string {
		return html
			.replace(/<[^>]+>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\s+/g, ' ')
			.trim();
	}

	private static generateHeadingId(content: string): string {
		return content
			.toLowerCase()
			.replace(/[^\w\s-]/g, '')
			.replace(/\s+/g, '-')
			.replace(/^-+|-+$/g, '');
	}

	static analyzeContentQuality(
		originalHtml: string,
		extractedMarkdown: string
	): {
		structureScore: number;
		completenessScore: number;
		readabilityScore: number;
	} {
		const originalText = this.cleanHtmlText(originalHtml);
		const extractedText = extractedMarkdown.replace(/[#*`_\[\]()]/g, '').trim();

		const completenessScore = Math.min(100, (extractedText.length / originalText.length) * 100);

		const originalHeadings = this.extractHeadings(originalHtml);
		const extractedHeadings = (extractedMarkdown.match(/^#+\s+.+$/gm) || []).length;
		const structureScore = originalHeadings.length > 0 ? Math.min(100, (extractedHeadings / originalHeadings.length) * 100) : 100;

		const paragraphs = extractedMarkdown.split('\n\n').filter((p) => p.trim().length > 0);
		const avgParagraphLength = paragraphs.reduce((sum, p) => sum + p.length, 0) / paragraphs.length;
		const readabilityScore = Math.max(50, Math.min(100, 150 - avgParagraphLength / 10));

		return {
			structureScore: Math.round(structureScore),
			completenessScore: Math.round(completenessScore),
			readabilityScore: Math.round(readabilityScore),
		};
	}
}

/**
 * Unified Markdown Renderer
 * Provides consistent, high-quality markdown formatting across all content processors
 */

export interface TableCell {
	content: string;
	alignment?: 'left' | 'center' | 'right';
	colspan?: number;
	rowspan?: number;
}

export interface TableRow {
	cells: TableCell[];
	isHeader?: boolean;
}

export interface TableData {
	rows: TableRow[];
	caption?: string;
	summary?: string;
}

export interface MediaItem {
	type: 'image' | 'video' | 'audio' | 'embed';
	url: string;
	title?: string;
	description?: string;
	caption?: string;
	thumbnail?: string;
	duration?: number;
	dimensions?: { width: number; height: number };
}

export interface ListItem {
	content: string;
	level: number;
	type: 'ordered' | 'unordered' | 'checklist';
	checked?: boolean;
	children?: ListItem[];
}

export interface HeadingStructure {
	level: 1 | 2 | 3 | 4 | 5 | 6;
	content: string;
	id?: string;
}

export interface CodeBlock {
	content: string;
	language?: string;
	filename?: string;
	caption?: string;
}

export interface QuoteBlock {
	content: string;
	author?: string;
	source?: string;
	citation?: string;
}

export interface MetadataSection {
	title: string;
	items: Array<{
		label: string;
		value: string | number | boolean;
		format?: 'text' | 'number' | 'date' | 'url' | 'email' | 'boolean';
	}>;
}

export class MarkdownRenderer {
	private options: {
		headingStyle: 'atx' | 'setext';
		bulletStyle: '-' | '*' | '+';
		codeBlockStyle: 'fenced' | 'indented';
		tableAlignment: boolean;
		preserveWhitespace: boolean;
		maxLineLength?: number;
		includeTableOfContents: boolean;
		includeFrontmatter: boolean;
	};

	constructor(options?: Partial<MarkdownRenderer['options']>) {
		this.options = {
			headingStyle: 'atx',
			bulletStyle: '-',
			codeBlockStyle: 'fenced',
			tableAlignment: true,
			preserveWhitespace: false,
			includeTableOfContents: false,
			includeFrontmatter: true,
			...options,
		};
	}

	createDocument(
		content: string,
		metadata?: {
			title?: string;
			url?: string;
			extractedAt?: string;
			contentType?: string;
			author?: string;
			description?: string;
			tags?: string[];
			[key: string]: any;
		}
	): string {
		let document = '';

		if (this.options.includeFrontmatter && metadata) {
			document += this.renderFrontmatter(metadata) + '\n\n';
		}

		document += content;

		return this.cleanupWhitespace(document);
	}

	renderFrontmatter(metadata: Record<string, any>): string {
		const frontmatter = ['---'];

		for (const [key, value] of Object.entries(metadata)) {
			if (value !== undefined && value !== null) {
				if (Array.isArray(value)) {
					frontmatter.push(`${key}:`);
					value.forEach((item) => frontmatter.push(`  - ${this.escapeYamlValue(item)}`));
				} else if (typeof value === 'string' && (value.includes('\n') || value.includes('"') || value.includes("'"))) {
					frontmatter.push(`${key}: |`);
					value.split('\n').forEach((line) => frontmatter.push(`  ${line}`));
				} else {
					frontmatter.push(`${key}: ${this.escapeYamlValue(value)}`);
				}
			}
		}

		frontmatter.push('---');
		return frontmatter.join('\n');
	}

	renderHeading(heading: HeadingStructure): string {
		const { level, content, id } = heading;

		if (this.options.headingStyle === 'atx') {
			const hashes = '#'.repeat(level);
			const idSuffix = id ? ` {#${id}}` : '';
			return `${hashes} ${content}${idSuffix}`;
		} else {
			// Setext style (only for h1 and h2)
			if (level === 1) {
				return `${content}\n${'='.repeat(content.length)}`;
			} else if (level === 2) {
				return `${content}\n${'-'.repeat(content.length)}`;
			} else {
				// Fall back to atx for h3+
				const hashes = '#'.repeat(level);
				return `${hashes} ${content}`;
			}
		}
	}

	renderTable(table: TableData): string {
		if (!table.rows.length) return '';

		const result: string[] = [];

		if (table.caption) {
			result.push(`**${table.caption}**\n`);
		}

		const headerRow = table.rows.find((row) => row.isHeader) || table.rows[0];
		const columnCount = Math.max(...table.rows.map((row) => row.cells.length));

		const headerCells = headerRow.cells.map((cell) => this.escapeTableCell(cell.content));
		const paddedHeader = this.padArrayToLength(headerCells, columnCount, '');
		result.push(`| ${paddedHeader.join(' | ')} |`);

		const separators = headerRow.cells.map((cell) => {
			if (!this.options.tableAlignment) return '---';

			switch (cell.alignment) {
				case 'left':
					return ':---';
				case 'right':
					return '---:';
				case 'center':
					return ':---:';
				default:
					return '---';
			}
		});
		const paddedSeparators = this.padArrayToLength(separators, columnCount, '---');
		result.push(`| ${paddedSeparators.join(' | ')} |`);

		const dataRows = table.rows.filter((row) => !row.isHeader);
		for (const row of dataRows) {
			const cells = row.cells.map((cell) => this.escapeTableCell(cell.content));
			const paddedCells = this.padArrayToLength(cells, columnCount, '');
			result.push(`| ${paddedCells.join(' | ')} |`);
		}

		if (table.summary) {
			result.push(`\n*${table.summary}*`);
		}

		return result.join('\n');
	}

	renderList(items: ListItem[]): string {
		return items.map((item) => this.renderListItem(item)).join('\n');
	}

	renderCodeBlock(code: CodeBlock): string {
		const { content, language, filename, caption } = code;

		let result = '';

		if (filename || caption) {
			result += `**${filename || caption}**\n`;
		}

		if (this.options.codeBlockStyle === 'fenced') {
			const fence = '```';
			const lang = language || '';
			result += `${fence}${lang}\n${content}\n${fence}`;
		} else {
			const indentedContent = content
				.split('\n')
				.map((line) => `    ${line}`)
				.join('\n');
			result += indentedContent;
		}

		return result;
	}

	renderQuote(quote: QuoteBlock): string {
		const { content, author, source, citation } = quote;

		let result = content
			.split('\n')
			.map((line) => `> ${line}`)
			.join('\n');

		if (author || source || citation) {
			result += '\n>';
			if (author) result += `\n> — ${author}`;
			if (source) result += `\n> *${source}*`;
			if (citation) result += `\n> ${citation}`;
		}

		return result;
	}

	renderMedia(media: MediaItem): string {
		const { type, url, title, description, caption, thumbnail, duration, dimensions } = media;

		let result = '';

		switch (type) {
			case 'image':
				const altText = description || title || 'Image';
				result = `![${altText}](${url})`;
				if (caption) result += `\n*${caption}*`;
				break;

			case 'video':
				result = `**Video: ${title || 'Untitled'}**\n`;
				if (description) result += `${description}\n\n`;
				if (duration) {
					const mins = Math.floor(duration / 60);
					const secs = duration % 60;
					result += `Duration: ${mins}:${secs.toString().padStart(2, '0')}\n`;
				}
				if (thumbnail) result += `![Video Thumbnail](${thumbnail})\n`;
				result += `[Watch Video](${url})`;
				break;

			case 'audio':
				result = `**Audio: ${title || 'Untitled'}**\n`;
				if (description) result += `${description}\n\n`;
				if (duration) {
					const mins = Math.floor(duration / 60);
					const secs = duration % 60;
					result += `Duration: ${mins}:${secs.toString().padStart(2, '0')}\n`;
				}
				result += `[Listen](${url})`;
				break;

			case 'embed':
				result = `**Embedded Content: ${title || 'Untitled'}**\n`;
				if (description) result += `${description}\n\n`;
				result += `[View Content](${url})`;
				break;
		}

		return result;
	}

	renderMetadata(metadata: MetadataSection): string {
		const { title, items } = metadata;

		let result = `## ${title}\n\n`;

		if (items.length > 0) {
			const tableData: TableData = {
				rows: [
					{
						cells: [
							{ content: 'Property', alignment: 'left' },
							{ content: 'Value', alignment: 'left' },
						],
						isHeader: true,
					},
					...items.map((item) => ({
						cells: [
							{ content: item.label, alignment: 'left' as const },
							{ content: this.formatMetadataValue(item.value, item.format), alignment: 'left' as const },
						],
					})),
				],
			};

			result += this.renderTable(tableData);
		}

		return result;
	}

	formatInline(
		text: string,
		options: {
			bold?: boolean;
			italic?: boolean;
			code?: boolean;
			strikethrough?: boolean;
			link?: { url: string; title?: string };
		} = {}
	): string {
		let result = text;

		if (options.code) {
			result = `\`${result}\``;
		}

		if (options.bold) {
			result = `**${result}**`;
		}

		if (options.italic) {
			result = `*${result}*`;
		}

		if (options.strikethrough) {
			result = `~~${result}~~`;
		}

		if (options.link) {
			const title = options.link.title ? ` "${options.link.title}"` : '';
			result = `[${result}](${options.link.url}${title})`;
		}

		return result;
	}

	createTableOfContents(headings: HeadingStructure[]): string {
		if (!headings.length) return '';

		let toc = '## Table of Contents\n\n';

		for (const heading of headings) {
			const indent = '  '.repeat(heading.level - 1);
			const link = heading.id ? `#${heading.id}` : `#${this.slugify(heading.content)}`;
			toc += `${indent}- [${heading.content}](${link})\n`;
		}

		return toc + '\n';
	}

	escapeMarkdown(text: string): string {
		return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
	}

	private cleanupWhitespace(content: string): string {
		if (this.options.preserveWhitespace) return content;

		return content
			.replace(/\n{4,}/g, '\n\n\n')
			.replace(/[ \t]+$/gm, '')
			.replace(/\n*$/, '\n');
	}

	private renderListItem(item: ListItem): string {
		const indent = '  '.repeat(item.level);
		let bullet: string;

		switch (item.type) {
			case 'ordered':
				bullet = '1.';
				break;
			case 'checklist':
				bullet = item.checked ? '- [x]' : '- [ ]';
				break;
			default:
				bullet = this.options.bulletStyle;
		}

		let result = `${indent}${bullet} ${item.content}`;

		if (item.children && item.children.length > 0) {
			const childrenMarkdown = item.children.map((child) => this.renderListItem({ ...child, level: child.level + 1 })).join('\n');
			result += '\n' + childrenMarkdown;
		}

		return result;
	}

	private escapeTableCell(content: string): string {
		return content.replace(/\|/g, '\\|').replace(/\n/g, '<br>').trim();
	}

	private padArrayToLength<T>(array: T[], length: number, defaultValue: T): T[] {
		const result = [...array];
		while (result.length < length) {
			result.push(defaultValue);
		}
		return result;
	}

	private formatMetadataValue(value: string | number | boolean, format?: string): string {
		if (value === null || value === undefined) return '';

		switch (format) {
			case 'date':
				return new Date(value as string).toLocaleString();
			case 'url':
				return `[${value}](${value})`;
			case 'email':
				return `[${value}](mailto:${value})`;
			case 'boolean':
				return value ? '✅ Yes' : '❌ No';
			case 'number':
				return typeof value === 'number' ? value.toLocaleString() : String(value);
			default:
				return String(value);
		}
	}

	private slugify(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^\w\s-]/g, '')
			.replace(/[\s_-]+/g, '-')
			.replace(/^-+|-+$/g, '');
	}

	private escapeYamlValue(value: any): string {
		if (typeof value === 'string') {
			if (/[:\-\[\]{}*&!|>'"%@`]/.test(value) || /^\s|\s$/.test(value)) {
				return `"${value.replace(/"/g, '\\"')}"`;
			}
		}
		return String(value);
	}
}

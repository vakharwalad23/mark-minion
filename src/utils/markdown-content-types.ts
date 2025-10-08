/**
 * Content type definitions for enhanced markdown processing
 */

import { TableData, MediaItem, HeadingStructure, CodeBlock, QuoteBlock, MetadataSection } from './markdown-renderer';

export interface DocumentStructure {
	title?: string;
	headings: HeadingStructure[];
	sections: ContentSection[];
	metadata?: Record<string, any>;
	summary?: string;
}

export interface ContentSection {
	type: 'text' | 'table' | 'list' | 'code' | 'quote' | 'media' | 'chart' | 'diagram';
	content: string;
	data?: TableData | MediaItem | CodeBlock | QuoteBlock | ChartData | DiagramData;
	metadata?: Record<string, any>;
}

export interface ChartData {
	type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'bubble' | 'mixed' | 'unknown';
	title?: string;
	description?: string;
	xAxis?: {
		title?: string;
		categories?: string[];
	};
	yAxis?: {
		title?: string;
		min?: number;
		max?: number;
	};
	series?: Array<{
		name: string;
		data: Array<number | { x: number; y: number; label?: string }>;
		color?: string;
	}>;
	extractedText?: string[];
	imageUrl?: string;
}

export interface DiagramData {
	type: 'flowchart' | 'organizational' | 'process' | 'network' | 'mindmap' | 'timeline' | 'unknown';
	title?: string;
	description?: string;
	elements?: Array<{
		id: string;
		type: 'node' | 'edge' | 'group';
		label?: string;
		position?: { x: number; y: number };
		connections?: string[];
	}>;
	extractedText?: string[];
	imageUrl?: string;
}

export interface TwitterThread {
	mainTweet: TwitterTweetData;
	replies: TwitterTweetData[];
	quotedTweets: TwitterTweetData[];
}

export interface TwitterTweetData {
	id: string;
	text: string;
	author: {
		name: string;
		handle: string;
		profileImage?: string;
		isVerified?: boolean;
	};
	createdAt: string;
	engagement: {
		likes: number;
		retweets: number;
		replies: number;
		quotes?: number;
	};
	media: MediaItem[];
	hashtags: string[];
	mentions: string[];
	urls: Array<{
		url: string;
		expandedUrl: string;
		displayUrl: string;
	}>;
	isReply?: boolean;
	replyToId?: string;
	isQuote?: boolean;
	quotedTweetId?: string;
}

export interface VideoContent {
	metadata: {
		title: string;
		description?: string;
		author?: string;
		platform: 'youtube' | 'vimeo' | 'direct' | 'other';
		duration?: number;
		uploadDate?: string;
		viewCount?: number;
		tags?: string[];
		category?: string;
	};
	transcript?: {
		segments: Array<{
			start: number;
			end: number;
			text: string;
			speaker?: string;
		}>;
		language?: string;
		confidence?: number;
	};
	chapters?: Array<{
		start: number;
		end: number;
		title: string;
		description?: string;
	}>;
	thumbnails: MediaItem[];
	relatedContent?: string[];
}

export interface DocumentContent {
	structure: DocumentStructure;
	extractedText: string;
	tables: TableData[];
	images: MediaItem[];
	charts: ChartData[];
	diagrams: DiagramData[];
	codeBlocks: CodeBlock[];
	quotes: QuoteBlock[];
	metadata: Record<string, any>;
	quality?: ContentQuality;
}

export interface WebPageContent {
	structure: DocumentStructure;
	mainContent: string;
	sidebar?: string;
	navigation?: string;
	footer?: string;
	forms?: Array<{
		action: string;
		method: string;
		fields: Array<{
			name: string;
			type: string;
			label?: string;
			required?: boolean;
		}>;
	}>;
	embeddedContent: MediaItem[];
	externalLinks: Array<{
		url: string;
		text: string;
		domain: string;
	}>;
	internalLinks: Array<{
		url: string;
		text: string;
		anchor?: string;
	}>;
}

export interface ProcessingResult {
	content: string;
	structure?: DocumentStructure;
	extractedData?: {
		tables: TableData[];
		media: MediaItem[];
		charts: ChartData[];
		diagrams: DiagramData[];
		codeBlocks: CodeBlock[];
		quotes: QuoteBlock[];
	};
	metadata: Record<string, any>;
	quality?: ContentQuality;
	processingNotes?: string[];
	warnings?: string[];
	errors?: string[];
}

/**
 * Content extraction options for different processors
 */
export interface ExtractionOptions {
	includeImages: boolean;
	includeTables: boolean;
	includeCharts: boolean;
	includeDiagrams: boolean;
	includeCode: boolean;
	includeQuotes: boolean;
	includeMetadata: boolean;
	preserveFormatting: boolean;
	maxImageSize?: number;
	maxTableRows?: number;
	language?: string;
	customSelectors?: {
		exclude?: string[];
		include?: string[];
	};
}

/**
 * Quality metrics for extracted content
 */
export interface ContentQuality {
	structureScore: number; // 0-100, how well structured the content is
	completenessScore: number; // 0-100, how much of the original content was preserved
	readabilityScore: number; // 0-100, how readable the markdown output is
	accuracyScore: number; // 0-100, how accurate the extraction was
	issues: Array<{
		type: 'warning' | 'error' | 'info';
		message: string;
		location?: string;
		suggestion?: string;
	}>;
}

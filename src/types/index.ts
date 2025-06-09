export interface PageMetadata {
	url: string;
	title: string | null;
	description: string | null;
	keywords: string | null;
	author: string | null;
	favicon: string | null;
	canonical: string | null;
	language: string | null;
	charset: string | null;
	robots: string | null;
	viewport: string | null;
	openGraph: {
		title: string | null;
		description: string | null;
		image: string | null;
		url: string | null;
		type: string | null;
		siteName: string | null;
		locale: string | null;
	};
	twitter: {
		card: string | null;
		title: string | null;
		description: string | null;
		image: string | null;
		site: string | null;
		creator: string | null;
	};
	schema: any[];
	links: {
		stylesheets: string[];
		feeds: string[];
		alternates: string[];
	};
	images: string[];
	headings: {
		h1: string[];
		h2: string[];
		h3: string[];
	};
	wordCount: number;
	loadTime: number;
	extractedAt: string;
	error?: string;
}

export interface YouTubeOEmbedResponse {
	title: string;
	author_name: string;
	author_url: string;
	type: 'video';
	height: number;
	width: number;
	version: string;
	provider_name: 'YouTube';
	provider_url: 'https://www.youtube.com/';
	thumbnail_height: number;
	thumbnail_width: number;
	thumbnail_url: string;
	html: string;
}

export interface VimeoOEmbedResponse {
	type: 'video';
	version: string;
	provider_name: 'Vimeo';
	provider_url: 'https://vimeo.com/';
	title: string;
	author_name: string;
	author_url: string;
	is_plus: string;
	account_type: string;
	html: string;
	width: number;
	height: number;
	duration: number;
	description?: string;
	thumbnail_url: string;
	thumbnail_width: number;
	thumbnail_height: number;
	thumbnail_url_with_play_button: string;
	upload_date: string;
	video_id: number;
	uri: string;
}

export interface VideoMetadata {
	title?: string;
	author?: string;
	author_url?: string;
	thumbnailUrl?: string;
	duration?: number | null;
	platform: 'youtube' | 'vimeo' | 'direct';
	videoId?: string;
	contentType?: string;
	contentLength?: number;
	isVideo?: boolean;
	description?: string;
	uploadDate?: string;
	viewCount?: number;
}

export interface VideoProcessResult {
	url: string;
	content: string;
	metadata: VideoMetadata & {
		extractedAt: string;
		hasTranscript: boolean;
		error?: string;
	};
}

export interface TranscriptItem {
	text: string;
	start: number;
	duration: number;
}

export interface YouTubeTranscriptResponse {
	transcript: TranscriptItem[];
	video_id: string;
}

export interface TwitterProcessResult {
	url: string;
	content: string;
	metadata: {
		tweetId: string;
		author: string;
		authorHandle?: string;
		createdAt?: string;
		likes?: number;
		retweets?: number;
		replies?: number;
		hasImages: boolean;
		hasVideo: boolean;
		isReply: boolean;
		isQuoted: boolean;
		extractedAt: string;
		error?: string;
	};
}

export interface DocumentResult {
	url: string;
	content: string;
	metadata: {
		type: string;
		size?: number;
		numPages?: number;
		info?: any;
		extractedAt: string;
		fileType: string;
		contentLength: number;
		originalUrl: string;
		processedUrl?: string;
		error?: string;
	};
}

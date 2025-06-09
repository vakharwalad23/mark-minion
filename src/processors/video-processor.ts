import { Env } from '../../worker-configuration';
import {
	YouTubeOEmbedResponse,
	VimeoOEmbedResponse,
	VideoMetadata,
	VideoProcessResult,
	TranscriptItem,
	YouTubeTranscriptResponse,
} from '../types';

export class VideoProcessor {
	private env: Env;

	constructor(env: Env) {
		this.env = env;
	}

	async process(url: string, enableDetailedResponse: boolean): Promise<VideoProcessResult> {
		const cacheKey = `video-${url}-${enableDetailedResponse}`;

		// Check cache
		const cached = await this.env.BROWSER_KV.get(cacheKey);
		if (cached) {
			return JSON.parse(cached) as VideoProcessResult;
		}

		try {
			let metadata: VideoMetadata = { platform: 'direct' };
			let transcript = '';
			let description = '';

			// Determine video platform
			if (this.isYouTubeUrl(url)) {
				const result = await this.processYouTubeVideo(url, enableDetailedResponse);
				metadata = result.metadata;
				transcript = result.transcript;
				description = result.description;
			} else if (this.isVimeoUrl(url)) {
				const result = await this.processVimeoVideo(url, enableDetailedResponse);
				metadata = result.metadata;
				transcript = result.transcript;
				description = result.description;
			} else {
				// Try to extract basic info from direct video URLs
				const result = await this.processDirectVideoUrl(url);
				metadata = result.metadata;
				description = result.description;
			}

			const processedResult: VideoProcessResult = {
				url,
				content: this.formatVideoContent(metadata, transcript, description),
				metadata: {
					...metadata,
					extractedAt: new Date().toISOString(),
					hasTranscript: !!transcript,
				},
			};

			// Cache result
			await this.env.BROWSER_KV.put(cacheKey, JSON.stringify(processedResult), { expirationTtl: 3600 });
			return processedResult;
		} catch (error: any) {
			console.error(`Video processing error for ${url}: ${error}`);
			return {
				url,
				content: `Error processing video: ${error.message}`,
				metadata: {
					error: error.message,
					platform: 'direct',
					extractedAt: new Date().toISOString(),
					hasTranscript: false,
				},
			};
		}
	}

	private async processYouTubeVideo(url: string, enableDetailedResponse: boolean) {
		const videoId = this.extractYouTubeVideoId(url);
		if (!videoId) throw new Error('Invalid YouTube URL');

		// Get video metadata using YouTube's oEmbed API
		const oembedResponse = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);

		if (!oembedResponse.ok) {
			throw new Error(`YouTube oEmbed API error: ${oembedResponse.status}`);
		}

		const oembedData: YouTubeOEmbedResponse = await oembedResponse.json();

		// Try to get transcript using multiple methods
		let transcript = '';
		if (enableDetailedResponse) {
			transcript = 'Not available';
		}

		const metadata: VideoMetadata = {
			title: oembedData.title,
			author: oembedData.author_name,
			author_url: oembedData.author_url,
			thumbnailUrl: oembedData.thumbnail_url,
			duration: null, // oEmbed doesn't provide duration
			platform: 'youtube',
			videoId,
			description: oembedData.title,
		};

		return {
			metadata,
			transcript,
			description: oembedData.title,
		};
	}

	private async processVimeoVideo(url: string, enableDetailedResponse: boolean) {
		// Extract Vimeo video ID
		const match = url.match(/vimeo\.com\/(\d+)/);
		if (!match) throw new Error('Invalid Vimeo URL');

		const videoId = match[1];

		// Get video metadata using Vimeo's oEmbed API
		const oembedResponse = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoId}`);

		if (!oembedResponse.ok) {
			throw new Error(`Vimeo oEmbed API error: ${oembedResponse.status}`);
		}

		const oembedData: VimeoOEmbedResponse = await oembedResponse.json();

		const metadata: VideoMetadata = {
			title: oembedData.title,
			author: oembedData.author_name,
			author_url: oembedData.author_url,
			thumbnailUrl: oembedData.thumbnail_url,
			duration: oembedData.duration,
			platform: 'vimeo',
			videoId,
			description: oembedData.description,
			uploadDate: oembedData.upload_date,
		};

		return {
			metadata,
			transcript: '', // Vimeo transcript would require API access
			description: oembedData.description || oembedData.title,
		};
	}

	private async processDirectVideoUrl(url: string) {
		try {
			const response = await fetch(url, { method: 'HEAD' });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const contentType = response.headers.get('content-type') || '';
			const contentLength = response.headers.get('content-length') || '0';

			const metadata: VideoMetadata = {
				contentType,
				contentLength: parseInt(contentLength),
				platform: 'direct',
				isVideo: contentType.startsWith('video/'),
				title: url.split('/').pop() || 'Unknown Video',
			};

			return {
				metadata,
				description: `Direct video file: ${url.split('/').pop()}`,
			};
		} catch (error: any) {
			throw new Error(`Failed to fetch video metadata: ${error.message}`);
		}
	}

	private formatVideoContent(metadata: VideoMetadata, transcript: string, description: string): string {
		let content = `# Video: ${metadata.title || 'Unknown Title'}\n\n`;

		if (metadata.author) {
			content += `**Author:** ${metadata.author}\n`;
			if (metadata.author_url) {
				content += `**Author URL:** ${metadata.author_url}\n`;
			}
			content += '\n';
		}

		if (description && description !== metadata.title) {
			content += `**Description:** ${description}\n\n`;
		}

		if (metadata.duration) {
			const minutes = Math.floor(metadata.duration / 60);
			const seconds = metadata.duration % 60;
			content += `**Duration:** ${minutes}:${seconds.toString().padStart(2, '0')}\n\n`;
		}

		if (metadata.thumbnailUrl) {
			content += `**Thumbnail:** ${metadata.thumbnailUrl}\n\n`;
		}

		if (metadata.uploadDate) {
			content += `**Upload Date:** ${metadata.uploadDate}\n\n`;
		}

		if (transcript) {
			content += `## Transcript\n\n${transcript}\n\n`;
		}

		content += `**Platform:** ${metadata.platform}\n`;
		if (metadata.videoId) {
			content += `**Video ID:** ${metadata.videoId}\n`;
		}
		content += `**Extracted at:** ${new Date().toISOString()}`;

		return content;
	}

	private isYouTubeUrl(url: string): boolean {
		return /(?:youtube\.com|youtu\.be)/.test(url);
	}

	private isVimeoUrl(url: string): boolean {
		return /vimeo\.com/.test(url);
	}

	private extractYouTubeVideoId(url: string): string | null {
		const patterns = [
			/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
			/youtube\.com\/embed\/([^&\n?#]+)/,
			/youtube\.com\/v\/([^&\n?#]+)/,
		];

		for (const pattern of patterns) {
			const match = url.match(pattern);
			if (match) return match[1];
		}

		return null;
	}

	async extractMetadata(url: string): Promise<VideoMetadata & { extractedAt: string; error?: string }> {
		try {
			if (this.isYouTubeUrl(url)) {
				const videoId = this.extractYouTubeVideoId(url);
				if (videoId) {
					const oembedResponse = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);

					if (!oembedResponse.ok) {
						throw new Error(`YouTube oEmbed API error: ${oembedResponse.status}`);
					}

					const data: YouTubeOEmbedResponse = await oembedResponse.json();
					return {
						title: data.title,
						author: data.author_name,
						author_url: data.author_url,
						thumbnailUrl: data.thumbnail_url,
						platform: 'youtube',
						videoId,
						extractedAt: new Date().toISOString(),
					};
				}
			} else if (this.isVimeoUrl(url)) {
				const oembedResponse = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);

				if (!oembedResponse.ok) {
					throw new Error(`Vimeo oEmbed API error: ${oembedResponse.status}`);
				}

				const data: VimeoOEmbedResponse = await oembedResponse.json();
				return {
					title: data.title,
					author: data.author_name,
					author_url: data.author_url,
					thumbnailUrl: data.thumbnail_url,
					duration: data.duration,
					description: data.description,
					uploadDate: data.upload_date,
					platform: 'vimeo',
					videoId: data.video_id.toString(),
					extractedAt: new Date().toISOString(),
				};
			}

			// Direct video URL
			const response = await fetch(url, { method: 'HEAD' });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return {
				contentType: response.headers.get('content-type') || undefined,
				contentLength: parseInt(response.headers.get('content-length') || '0'),
				platform: 'direct',
				isVideo: (response.headers.get('content-type') || '').startsWith('video/'),
				title: url.split('/').pop() || 'Unknown Video',
				extractedAt: new Date().toISOString(),
			};
		} catch (error: any) {
			return {
				platform: 'direct',
				error: error.message,
				extractedAt: new Date().toISOString(),
			};
		}
	}
}

import { Tweet } from 'react-tweet/api';
import { Env } from '../../worker-configuration';
import { TwitterProcessResult } from '../types';

export class TwitterProcessor {
	private env: Env;

	constructor(env: Env) {
		this.env = env;
	}

	async process(url: string): Promise<TwitterProcessResult> {
		const tweetId = this.extractTweetId(url);
		if (!tweetId) {
			return {
				url,
				content: 'Invalid Twitter/X URL - could not extract tweet ID',
				metadata: {
					tweetId: '',
					author: '',
					hasImages: false,
					hasVideo: false,
					isReply: false,
					isQuoted: false,
					extractedAt: new Date().toISOString(),
					error: 'Invalid URL',
				},
			};
		}

		// Check cache first
		const cacheKey = `tweet-${tweetId}`;
		const cached = await this.env.BROWSER_KV.get(cacheKey);
		if (cached) {
			return JSON.parse(cached) as TwitterProcessResult;
		}

		try {
			const tweet = await this.fetchTweet(tweetId);
			if (!tweet || !tweet.text) {
				return {
					url,
					content: 'Tweet not found or unavailable',
					metadata: {
						tweetId,
						author: '',
						hasImages: false,
						hasVideo: false,
						isReply: false,
						isQuoted: false,
						extractedAt: new Date().toISOString(),
						error: 'Tweet not found',
					},
				};
			}

			const result = this.formatTweetContent(tweet, url, tweetId);

			// Cache the result
			await this.env.BROWSER_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
			return result;
		} catch (error: any) {
			console.error(`Twitter processing error for ${url}: ${error}`);
			return {
				url,
				content: `Error processing tweet: ${error.message}`,
				metadata: {
					tweetId,
					author: '',
					hasImages: false,
					hasVideo: false,
					isReply: false,
					isQuoted: false,
					extractedAt: new Date().toISOString(),
					error: error.message,
				},
			};
		}
	}

	private extractTweetId(url: string): string | null {
		// Handle both twitter.com and x.com URLs
		const patterns = [
			/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
			/(?:twitter\.com|x\.com)\/i\/web\/status\/(\d+)/,
			/(?:twitter\.com|x\.com)\/\w+\/statuses\/(\d+)/,
		];

		for (const pattern of patterns) {
			const match = url.match(pattern);
			if (match && match[1]) {
				return match[1];
			}
		}

		// Try to extract from the end of the URL if it's just a number
		const segments = url.split('/');
		const lastSegment = segments[segments.length - 1];
		if (/^\d+$/.test(lastSegment)) {
			return lastSegment;
		}

		return null;
	}

	private async fetchTweet(tweetId: string): Promise<Tweet | null> {
		const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&features=tfw_timeline_list%3A%3Btfw_follower_count_sunset%3Atrue%3Btfw_tweet_edit_backend%3Aon%3Btfw_refsrc_session%3Aon%3Btfw_fosnr_soft_interventions_enabled%3Aon%3Btfw_show_birdwatch_pivots_enabled%3Aon%3Btfw_show_business_verified_badge%3Aon%3Btfw_duplicate_scribes_to_settings%3Aon%3Btfw_use_profile_image_shape_enabled%3Aon%3Btfw_show_blue_verified_badge%3Aon%3Btfw_legacy_timeline_sunset%3Atrue%3Btfw_show_gov_verified_badge%3Aon%3Btfw_show_business_affiliate_badge%3Aon%3Btfw_tweet_edit_frontend%3Aon&token=4c2mmul6mnh`;

		try {
			const response = await fetch(url, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
					Accept: 'application/json',
					'Accept-Language': 'en-US,en;q=0.5',
					'Accept-Encoding': 'gzip, deflate, br',
					Connection: 'keep-alive',
					'Upgrade-Insecure-Requests': '1',
					'Cache-Control': 'max-age=0',
					TE: 'Trailers',
				},
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			return (await response.json()) as Tweet;
		} catch (error) {
			console.error(`Tweet fetch failed for ${tweetId}: ${error}`);
			throw error;
		}
	}

	private formatTweetContent(tweet: Tweet, url: string, tweetId: string): TwitterProcessResult {
		const author = tweet.user?.name || 'Unknown';
		const authorHandle = tweet.user?.screen_name;
		const hasImages = !!(tweet.photos && tweet.photos.length > 0);
		const hasVideo = !!tweet.video;
		const isReply = !!tweet.in_reply_to_status_id_str;
		const isQuoted = !!tweet.quoted_tweet;

		let content = `# Tweet from @${authorHandle || author}\n\n`;
		content += `**Author:** ${author}`;
		if (authorHandle) {
			content += ` (@${authorHandle})`;
		}
		content += '\n\n';

		if (tweet.created_at) {
			content += `**Posted:** ${new Date(tweet.created_at).toLocaleString()}\n\n`;
		}

		// Add reply context
		if (isReply && tweet.in_reply_to_screen_name) {
			content += `**In reply to:** @${tweet.in_reply_to_screen_name}\n\n`;
		}

		content += `**Content:**\n${tweet.text}\n\n`;

		// Add quoted tweet content
		if (isQuoted && tweet.quoted_tweet) {
			content += `**Quoted Tweet:**\n`;
			content += `Author: ${tweet.quoted_tweet.user.name} (@${tweet.quoted_tweet.user.screen_name})\n`;
			content += `Content: ${tweet.quoted_tweet.text}\n\n`;
		}

		// Add media information
		if (hasImages) {
			content += `**Images:** ${tweet.photos!.length} image(s)\n`;
			tweet.photos!.forEach((photo, index) => {
				content += `- Image ${index + 1}: ${photo.url}\n`;
			});
			content += '\n';
		}

		if (hasVideo && tweet.video) {
			content += `**Video:** Available\n`;
			if (tweet.video.poster) {
				content += `- Poster: ${tweet.video.poster}\n`;
			}
			if (tweet.video.variants && tweet.video.variants.length > 0) {
				content += `- Video URL: ${tweet.video.variants[0].src}\n`;
			}
			content += '\n';
		}

		// Add engagement metrics
		content += `**Engagement:**\n`;
		content += `- Likes: ${tweet.favorite_count || 0}\n`;
		content += `- Replies: ${tweet.conversation_count || 0}\n`;

		// Add parent tweet metrics if available
		if (tweet.parent) {
			content += `- Retweets: ${tweet.parent.retweet_count || 0}\n`;
		}

		// Add hashtags and mentions if available
		if (tweet.entities) {
			if (tweet.entities.hashtags && tweet.entities.hashtags.length > 0) {
				content += `\n**Hashtags:** ${tweet.entities.hashtags.map((h) => `#${h.text}`).join(', ')}\n`;
			}

			if (tweet.entities.user_mentions && tweet.entities.user_mentions.length > 0) {
				content += `**Mentions:** ${tweet.entities.user_mentions.map((m) => `@${m.screen_name}`).join(', ')}\n`;
			}

			if (tweet.entities.urls && tweet.entities.urls.length > 0) {
				content += `**Links:**\n`;
				tweet.entities.urls.forEach((urlEntity) => {
					content += `- ${urlEntity.expanded_url || urlEntity.url}\n`;
				});
			}
		}

		content += `\n**Original URL:** ${url}\n`;
		content += `**Tweet ID:** ${tweetId}\n`;
		content += `**Language:** ${tweet.lang}\n`;
		content += `**Extracted at:** ${new Date().toISOString()}`;

		return {
			url,
			content,
			metadata: {
				tweetId,
				author,
				authorHandle,
				createdAt: tweet.created_at,
				likes: tweet.favorite_count,
				retweets: tweet.parent?.retweet_count,
				replies: tweet.conversation_count,
				hasImages,
				hasVideo,
				isReply,
				isQuoted,
				extractedAt: new Date().toISOString(),
			},
		};
	}
}

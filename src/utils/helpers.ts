import { HTML } from '../webResponse';

export class Helpers {
	private static readonly DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.md', '.xlsx', '.xls'];
	private static readonly VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp'];
	private static readonly VIDEO_PLATFORMS = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'twitch.tv', 'tiktok.com'];
	private static readonly DOCUMENT_MIME_TYPES = [
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		'text/plain',
		'text/markdown',
		'text/html',
		'application/octet-stream',
	];

	isValidUrl(url: string): boolean {
		return /^https?:\/\/[^\s"]+$/.test(url);
	}

	async determineUrlType(url: string): Promise<'webpage' | 'document' | 'video' | 'twitter'> {
		const urlLower = url.toLowerCase();

		if (this.isTwitterUrl(urlLower)) return 'twitter';
		if (this.isGoogleDocsUrl(urlLower)) return 'document';
		if (this.isDocumentUrl(urlLower)) return 'document';
		if (await this.isDocumentByContentType(url)) return 'document';
		if (this.isVideoUrl(urlLower)) return 'video';

		return 'webpage';
	}

	initialResponse() {
		return new Response(HTML, {
			headers: { 'content-type': 'text/html;charset=UTF-8' },
		});
	}

	private isTwitterUrl(url: string): boolean {
		return url.includes('twitter.com') || url.includes('x.com');
	}

	private isGoogleDocsUrl(url: string): boolean {
		return (
			url.includes('docs.google.com/document') ||
			url.includes('docs.google.com/spreadsheets') ||
			url.includes('docs.google.com/presentation') ||
			(url.includes('drive.google.com') && url.includes('/file/'))
		);
	}

	private isDocumentUrl(url: string): boolean {
		return Helpers.DOCUMENT_EXTENSIONS.some((ext) => url.includes(ext));
	}

	private isVideoUrl(url: string): boolean {
		return Helpers.VIDEO_PLATFORMS.some((platform) => url.includes(platform)) || Helpers.VIDEO_EXTENSIONS.some((ext) => url.includes(ext));
	}

	private async isDocumentByContentType(url: string): Promise<boolean> {
		if (!this.isCloudStorageUrl(url)) return false;

		try {
			const response = await fetch(url, { method: 'HEAD' });
			const contentType = response.headers.get('content-type')?.toLowerCase() || '';
			return Helpers.DOCUMENT_MIME_TYPES.some((mime) => contentType.includes(mime));
		} catch {
			return false;
		}
	}

	private isCloudStorageUrl(url: string): boolean {
		return (
			url.includes('drive.google.com') ||
			url.includes('dropbox.com') ||
			url.includes('onedrive.live.com') ||
			url.includes('docs.google.com')
		);
	}
}

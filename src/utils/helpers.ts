import { HTML } from '../webResponse';

export class Helpers {
	isValidUrl(url: string): boolean {
		return /^(http|https):\/\/[^ "]+$/.test(url);
	}

	async determineUrlType(url: string): Promise<'webpage' | 'document' | 'video' | 'twitter'> {
		const urlLower = url.toLowerCase();

		// Twitter/X URLs
		if (urlLower.includes('twitter.com') || urlLower.includes('x.com')) {
			return 'twitter';
		}

		// Document URLs - check extension first
		if (this.isDocumentUrl(url)) {
			return 'document';
		}

		// Check content-type for URLs without extensions
		if (await this.isDocumentByContentType(url)) {
			return 'document';
		}

		// Video URLs
		if (this.isVideoUrl(url)) {
			return 'video';
		}

		return 'webpage';
	}

	private isDocumentUrl(url: string): boolean {
		const documentExtensions = ['.pdf', '.doc', '.docx', '.txt', '.md'];
		const urlLower = url.toLowerCase();
		return documentExtensions.some((ext) => urlLower.includes(ext));
	}

	private async isDocumentByContentType(url: string): Promise<boolean> {
		try {
			// Check for common document hosting patterns
			if (
				url.includes('drive.google.com') ||
				url.includes('dropbox.com') ||
				url.includes('onedrive.live.com') ||
				url.includes('docs.google.com')
			) {
				const response = await fetch(url, { method: 'HEAD' });
				const contentType = response.headers.get('content-type')?.toLowerCase() || '';

				const documentMimeTypes = [
					'application/pdf',
					'application/msword',
					'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
					'text/plain',
					'text/markdown',
					'application/octet-stream', // Google Drive often uses this
				];

				return documentMimeTypes.some((mimeType) => contentType.includes(mimeType));
			}
		} catch (error) {
			console.error('Error checking content type:', error);
		}

		return false;
	}

	private isVideoUrl(url: string): boolean {
		const urlLower = url.toLowerCase();

		// Video platforms
		const videoPlatforms = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'twitch.tv', 'tiktok.com'];

		if (videoPlatforms.some((platform) => urlLower.includes(platform))) {
			return true;
		}

		// Direct video files
		const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp'];
		return videoExtensions.some((ext) => urlLower.includes(ext));
	}

	initialResponse() {
		return new Response(HTML, {
			headers: { 'content-type': 'text/html;charset=UTF-8' },
		});
	}
}

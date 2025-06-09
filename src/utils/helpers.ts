import { HTML } from '../webResponse';

export class Helpers {
	isValidUrl(url: string): boolean {
		return /^(http|https):\/\/[^ "]+$/.test(url);
	}

	determineUrlType(url: string): 'webpage' | 'document' | 'video' | 'twitter' {
		const urlLower = url.toLowerCase();

		// Twitter/X URLs
		if (urlLower.includes('twitter.com') || urlLower.includes('x.com')) {
			return 'twitter';
		}

		// Document URLs
		if (this.isDocumentUrl(url)) {
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

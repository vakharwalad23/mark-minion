<div align="center">

<img src="./public/markminion.png" alt="Mark Minion Logo" width="120" height="120" style="border-radius: 15px; margin-bottom: 20px;">

# Mark Minion

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange?style=for-the-badge&logo=cloudflare)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-40B5A4?style=for-the-badge&logo=puppeteer&logoColor=white)](https://pptr.dev/)
[![AI Powered](https://img.shields.io/badge/AI-Powered-FF6B6B?style=for-the-badge&logo=brain&logoColor=white)](https://www.cloudflare.com/developer-platform/workers-ai/)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Deploy](https://img.shields.io/badge/Deploy-Live-success?style=for-the-badge&logo=rocket&logoColor=white)](https://markminion.dhruvvakharwala.dev/)
[![Status](https://img.shields.io/badge/Status-Production-brightgreen?style=for-the-badge&logo=check-circle&logoColor=white)]()

_**The Ultimate Web Content Extraction & Conversion Tool for AI/LLM Applications**_

_Convert any web content into clean, structured Markdown format with advanced bot protection and intelligent AI processing_

</div>

---

> 🙏 A humble request I am currently on the free plan of Cloudflare Workers, so there is a daily limit on browser rendering, which means it might not work for website URLs all the time. You can deploy your own Markminion easily. Everything else will work all the time.

## ✨ Features

### 🌐 Universal Content Support

- **Web Pages**: Convert any webpage to clean Markdown with advanced readability extraction
- **Documents**: Extract text from PDFs, DOCX, DOC, TXT, MD, HTML, and XLSX files
- **Videos**: Extract metadata, descriptions, and transcripts from YouTube, Vimeo, and other platforms
- **Social Media**: Parse Twitter/X tweets with full metadata and engagement metrics
- **Google Docs**: Direct extraction from Google Docs, Sheets, and Presentations

### 🤖 AI-Powered Processing

- **Smart Content Filtering**: AI-powered removal of ads, navigation, and irrelevant content
- **Chunked Processing**: Intelligent text chunking for large documents
- **Content Optimization**: Tailored output for LLM consumption

### 🛡️ Advanced Bot Protection (Still Work In Progress)

- **Stealth Browsing**: Advanced bot detection bypass with randomized user agents
- **Human-like Behavior**: Simulated human browsing patterns and delays
- **Multiple Retry Logic**: Robust navigation with intelligent fallbacks

### 🚀 Performance & Reliability

- **Intelligent Caching**: Multi-layer caching with KV storage for optimal performance
- **Rate Limiting**: Built-in protection against abuse
- **Subpage Crawling**: Extract content from multiple related pages (up to 10)
- **Metadata Extraction**: Comprehensive metadata including OpenGraph, Twitter Cards, and structured data

### 📊 Output Formats

- **Plain Text**: Clean Markdown output
- **JSON**: Structured data with metadata
- **Detailed Mode**: Enhanced extraction with additional content
- **Metadata-Only**: Extract just the page metadata

## 🏗️ Architecture

Mark Minion leverages modern serverless architecture for scalability and reliability:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client App    │────│  Cloudflare CDN  │────│ Cloudflare Edge │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │ Durable Objects │
                                               │   (Browser)     │
                                               └─────────────────┘
                                                         │
                              ┌──────────────────────────┼──────────────────────────┐
                              │                          │                          │
                              ▼                          ▼                          ▼
                    ┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
                    │  Content Proc.  │        │  Document Proc. │        │   Video Proc.   │
                    └─────────────────┘        └─────────────────┘        └─────────────────┘
                              │                          │                          │
                              └──────────────────────────┼──────────────────────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │   AI Filtering  │
                                               └─────────────────┘
```

### Core Components

1. **Durable Objects Browser**: Persistent browser instances with advanced bot protection
2. **Content Processors**: Specialized handlers for different content types
3. **AI Utils**: Intelligent content filtering and optimization
4. **Metadata Extractors**: Comprehensive page metadata extraction
5. **Caching Layer**: Multi-tier caching with Cloudflare KV

## 🚀 Quick Start

### Basic Usage

```bash
# Simple webpage conversion
curl "https://markminion.dhruvvakharwala.dev/?url=https://example.com"

# With authentication
curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://markminion.dhruvvakharwala.dev/?url=https://example.com"
```

### Advanced Examples

```bash
# Detailed extraction with AI filtering
curl "https://markminion.dhruvvakharwala.dev/?url=https://example.com&detailed=true&unnecessaryfilter=true"

# Extract from Google Docs
curl "https://markminion.dhruvvakharwala.dev/?url=https://docs.google.com/document/d/YOUR_DOC_ID/edit"

# YouTube video with transcript
curl "https://markminion.dhruvvakharwala.dev/?url=https://www.youtube.com/watch?v=VIDEO_ID&detailed=true"

# Twitter thread extraction
curl "https://markminion.dhruvvakharwala.dev/?url=https://x.com/username/status/TWEET_ID"

# PDF document processing
curl "https://markminion.dhruvvakharwala.dev/?url=https://example.com/document.pdf&unnecessaryfilter=true"

# Subpage crawling
curl "https://markminion.dhruvvakharwala.dev/?url=https://blog.example.com&subpage=true&detailed=true"

# Metadata extraction only
curl "https://markminion.dhruvvakharwala.dev/metadata?url=https://example.com"

# JSON output format
curl -H "Content-Type: application/json" \
     "https://markminion.dhruvvakharwala.dev/?url=https://example.com"
```

## 📖 API Reference

### Base Endpoint: `GET /`

#### Query Parameters

| Parameter           | Type    | Required | Description                                                          |
| ------------------- | ------- | -------- | -------------------------------------------------------------------- |
| `url`               | string  | ✅       | The URL to extract content from                                      |
| `detailed`          | boolean | ❌       | Enhanced extraction with more content (default: false)               |
| `subpage`           | boolean | ❌       | Crawl and extract from linked subpages (default: false)              |
| `unnecessaryfilter` | boolean | ❌       | Apply AI filtering to remove ads/irrelevant content (default: false) |

#### Headers

| Header          | Required | Description                                 |
| --------------- | -------- | ------------------------------------------- |
| `Authorization` | ❌       | Bearer token for authenticated requests     |
| `Content-Type`  | ❌       | `application/json` for JSON response format |

### Metadata Endpoint: `GET /metadata`

Extract only metadata without content processing.

```bash
curl "https://markminion.dhruvvakharwala.dev/metadata?url=https://example.com"
```

### Response Formats

#### Plain Text Response

```
# Page Title

Page content in clean Markdown format...

**Metadata:**
- Extracted at: 2025-01-01T00:00:00.000Z
- Content length: 1234 characters
- Source: https://example.com
```

#### JSON Response

```json
{
  "url": "https://example.com",
  "content": "# Page Title\n\nPage content...",
  "metadata": {
    "title": "Page Title",
    "description": "Page description",
    "extractedAt": "2025-01-01T00:00:00.000Z",
    "contentLength": 1234,
    "cached": false,
    "openGraph": { ... },
    "twitter": { ... }
  }
}
```

## 🔧 Supported Content Types

### 📄 Documents

- **PDF**: Full text extraction with metadata
- **Microsoft Word**: DOCX and DOC formats
- **Text Files**: TXT, Markdown (MD)
- **Spreadsheets**: XLSX with sheet separation
- **HTML**: Clean text extraction

### 🎥 Videos

- **YouTube**: Metadata, descriptions, and transcripts (Transcript extraction is future work)
- **Vimeo**: Video information and descriptions
- **Direct Video URLs**: Basic metadata extraction
- **TikTok, Twitch**: Platform-specific extraction (future work)

### 🐦 Social Media

- **Twitter/X**: Full tweet data with engagement metrics
- **Thread Support**: Multi-tweet thread extraction
- **Media Handling**: Images and video metadata

### 🌐 Web Pages

- **Readability Extraction**: Clean content using Mozilla Readability
- **Fallback Processing**: Multiple extraction strategies
- **Rich Metadata**: OpenGraph, Twitter Cards, JSON-LD

## ⚙️ Configuration

### Environment Variables

```bash
# Required
BACKEND_SECURITY_TOKEN=your_secret_token
```

### Rate Limiting

- **Authenticated requests**: No rate limits
- **Public requests**: Limited to prevent abuse
- **Per-IP tracking**: Using Cloudflare's connecting IP

## 🚀 Deployment

### Cloudflare Workers

1. **Clone the repository**

```bash
git clone https://github.com/vakharwalad23/mark-minion.git
cd mark-minion
```

2. **Install dependencies**

```bash
bun install
```

3. **Type Generation**

```bash
bun run cf-typegen
```

4. **Deploy**

```bash
bun run deploy
```

### Local Development

```bash
# Start development server
bun run dev

# Run tests (Currently just a placeholder test for the example)
bun run test
```

## 🎯 Use Cases

### 🤖 AI/LLM Applications

- **Training Data**: Clean, structured content for model training
- **RAG Systems**: High-quality documents for retrieval augmentation
- **Content Analysis**: Preprocessed data for NLP tasks

### 📊 Content Management

- **Documentation**: Convert web content to documentation formats
- **Research**: Bulk extraction from multiple sources
- **Archival**: Clean content storage and preservation

### 🔄 Integration

- **APIs**: Programmatic content extraction
- **Workflows**: Part of larger data processing pipelines
- **Automation**: Scheduled content updates

## 🛠️ Advanced Features

### Content Filtering

```bash
# AI-powered content cleaning
curl "https://markminion.dhruvvakharwala.dev/?url=https://news-site.com&unnecessaryfilter=true"
```

### Batch Processing

```bash
# Process multiple related pages
curl "https://markminion.dhruvvakharwala.dev/?url=https://docs.example.com&subpage=true"
```

### Custom Headers

```bash
# Specify output format
curl -H "Content-Type: application/json" \
     "https://markminion.dhruvvakharwala.dev/?url=https://example.com"
```

## 📈 Performance

- **Cold Start**: ~2-3 seconds for new browser instances
- **Warm Requests**: ~500ms-2s depending on content
- **Caching**: Subsequent requests ~50-200ms
- **Concurrent Users**: Scales automatically with Cloudflare

## 🔒 Security

- **Rate Limiting**: Protection against abuse
- **Input Validation**: URL and parameter sanitization
- **Bot Protection**: Advanced anti-detection measures
- **Token Authentication**: Optional API key protection

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/vakharwalad23/mark-minion/issues)
- **Discussions**: [GitHub Discussions](https://github.com/vakharwalad23/mark-minion/discussions)

## 🙏 Acknowledgments

- [Mozilla Readability](https://github.com/mozilla/readability) for content extraction
- [Turndown](https://github.com/mixmark-io/turndown) for HTML to Markdown conversion
- [Cloudflare](https://cloudflare.com) for the serverless platform
- [Puppeteer](https://pptr.dev/) for browser automation

---

**Built with ❤️ using Cloudflare Workers**

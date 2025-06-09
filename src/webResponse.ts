export const HTML = `
<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Mark Minion - Content Extraction API</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                line-height: 1.6; 
                color: #333; 
                background: #fafafa;
            }
            .container { max-width: 800px; margin: 0 auto; padding: 20px; }
            h1 { font-size: 2.5rem; font-weight: 600; margin-bottom: 10px; }
            h2 { font-size: 1.5rem; font-weight: 500; margin: 40px 0 20px; color: #555; }
            p { margin-bottom: 15px; color: #666; }
            code { 
                background: #f5f5f5; 
                padding: 2px 6px; 
                border-radius: 3px; 
                font-family: 'SF Mono', Monaco, monospace;
                font-size: 0.9em;
            }
            pre { 
                background: #2d3748; 
                color: #e2e8f0; 
                padding: 20px; 
                border-radius: 8px; 
                overflow-x: auto; 
                margin: 15px 0;
                font-family: 'SF Mono', Monaco, monospace;
            }
            .subtitle { font-size: 1.1rem; color: #777; margin-bottom: 30px; }
            .example { margin: 25px 0; }
            .example h3 { font-size: 1rem; font-weight: 500; margin-bottom: 10px; color: #444; }
            .footer { margin-top: 60px; padding-top: 30px; border-top: 1px solid #eee; text-align: center; }
            .footer a { color: #667eea; text-decoration: none; margin: 0 15px; }
            .footer a:hover { text-decoration: underline; }
            .param { 
                margin: 15px 0; 
                padding: 15px 0; 
                border-bottom: 1px solid #f0f0f0; 
            }
            .param:last-child { border-bottom: none; }
            .param-name { font-weight: 500; color: #333; }
            .param-desc { color: #666; margin-top: 5px; }
            .required { color: #e53e3e; font-size: 0.8em; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🕷️ Mark Minion</h1>
            <p class="subtitle">Convert any web content into clean Markdown format</p>
            
            <p>A simple API that extracts and converts web content, documents, videos, and social media posts into structured Markdown. Built for developers who need clean content for AI applications.</p>

            <h2>Getting Started</h2>
            <p>Make a GET request with a URL parameter:</p>
            <pre>curl "https://markminion.dhruvvakharwala.dev/?url=https://example.com"</pre>

            <h2>Parameters</h2>
            
            <div class="param">
                <div class="param-name">url <span class="required">*required</span></div>
                <div class="param-desc">The URL you want to extract content from</div>
            </div>
            
            <div class="param">
                <div class="param-name">detailed</div>
                <div class="param-desc">Get more comprehensive content extraction</div>
            </div>
            
            <div class="param">
                <div class="param-name">subpage</div>
                <div class="param-desc">Also extract content from linked pages (up to 10)</div>
            </div>
            
            <div class="param">
                <div class="param-name">unnecessaryfilter</div>
                <div class="param-desc">Apply AI filtering to remove ads and irrelevant content</div>
            </div>

            <h2>Examples</h2>

            <div class="example">
                <h3>Extract a webpage</h3>
                <pre>curl "https://markminion.dhruvvakharwala.dev/?url=https://news.ycombinator.com"</pre>
            </div>

            <div class="example">
                <h3>Get PDF content</h3>
                <pre>curl "https://markminion.dhruvvakharwala.dev/?url=https://example.com/paper.pdf"</pre>
            </div>

            <div class="example">
                <h3>YouTube video info</h3>
                <pre>curl "https://markminion.dhruvvakharwala.dev/?url=https://youtube.com/watch?v=dQw4w9WgXcQ"</pre>
            </div>

            <div class="example">
                <h3>Twitter thread</h3>
                <pre>curl "https://markminion.dhruvvakharwala.dev/?url=https://x.com/user/status/123456"</pre>
            </div>

            <div class="example">
                <h3>With AI filtering</h3>
                <pre>curl "https://markminion.dhruvvakharwala.dev/?url=https://blog.example.com&unnecessaryfilter=true"</pre>
            </div>

            <h2>What it supports</h2>
            <p>Web pages, PDFs, Word documents, YouTube videos, Twitter/X posts, Google Docs, and more. Returns clean Markdown that's perfect for feeding into language models or documentation systems.</p>

            <h2>Response format</h2>
            <p>By default, returns plain Markdown text. Add <code>Content-Type: application/json</code> header to get structured JSON with metadata.</p>

            <div class="footer">
                <p>Built with ❤️ using Cloudflare Workers</p>
                <div>
                    <a href="https://github.com/vakharwalad23/mark-minion">GitHub</a>
                    <a href="https://github.com/vakharwalad23/mark-minion/issues">Issues</a>
                    <a href="https://github.com/vakharwalad23/mark-minion/blob/main/README.md">Docs</a>
                </div>
            </div>
        </div>
    </body>
</html>
`;

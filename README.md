# <img src="https://cdn-static-1.medium.com/_/fp/icons/Medium-Avatar-500x500.svg" alt="Medium Logo" width="32" height="32"> Medium MCP Server (Browser-Based)

A [Model Context Protocol](https://modelcontextprotocol.io/) server for Medium. Since Medium discontinued their public API for new users, this server drives a real Chromium browser via Playwright to publish, read, and manage your Medium stories — no API token required.

## Features

- **Publish articles** — title, body (markdown-like syntax), tags, draft or live
- **Cover media** — Unsplash search, local file upload, or YouTube embed, with optional captions; all three can be combined in a single call
- **Read articles** — extract full content from published articles and draft editor URLs
- **List articles** — fetch your published stories and drafts with `postId` values
- **Search** — search Medium by keywords
- **Delete drafts** — with a hard guardrail that refuses to delete published articles
- **GitHub Copilot CLI skill** — drop-in skill for the Copilot CLI agent at `.copilot/skills/medium-publish/SKILL.md`

## Prerequisites

- Node.js 18+
- A Medium account (email/password login recommended — Google login sessions are less persistent)

## Installation

```bash
git clone https://github.com/unclaimed-cherry-blossom/medium-mcp-server.git
cd medium-mcp-server
npm install
npx playwright install chromium
npm run build
```

## MCP Configuration

Add to your MCP client config (Claude Desktop, GitHub Copilot CLI, etc.):

```json
{
  "mcpServers": {
    "medium-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/medium-mcp-server/dist/index.js"],
      "cwd": "/absolute/path/to/medium-mcp-server"
    }
  }
}
```

## First-time login

Call `login-to-medium` once. A browser window opens — log in manually. The session is saved to `medium-session.json` and reused on all subsequent calls.

## Available tools

### `login-to-medium`
Opens a browser window for manual login. Always call this first.

### `publish-article`

| Parameter | Type | Description |
|---|---|---|
| `title` | `string` | Article title |
| `content` | `string` | Article body (see formatting syntax below) |
| `isDraft` | `boolean` | `true` = save as draft (default: `false`) |
| `tags` | `string[]` | Up to 5 tags (applied at publish time) |
| `postId` | `string` | Existing draft ID — skips editor, goes straight to submission |
| `coverImageYoutubeUrl` | `string` | YouTube URL to embed as cover |
| `coverImageYoutubeCaption` | `string` | Caption for YouTube embed |
| `coverImageFile` | `string` | Absolute path to a local image file |
| `coverImageFileCaption` | `string` | Caption for local image |
| `coverImageQuery` | `string` | Unsplash search term |
| `coverImageQueryCaption` | `string` | Caption for Unsplash image |

Cover media insertion order: YouTube → local file → Unsplash. Insertion is non-fatal — the article saves even if a cover image step fails.

### `get-my-articles`
Returns all your stories (published + drafts) with `postId`, title, URL, and status.

### `get-article-content`
Extracts full content from a published article URL or a draft `/edit` URL.

```json
{ "url": "https://medium.com/p/<postId>/edit" }
```

### `search-medium`
Searches Medium by keywords.

```json
{ "keywords": ["playwright", "mcp"] }
```

### `delete-draft`
Deletes a draft story. **Refuses to delete published articles** — if the `postId` redirects away from `/edit`, the tool returns an error without touching anything.

```json
{ "postId": "abc123def456" }
```

## Content formatting syntax

| Syntax | Result |
|---|---|
| `# Heading` | H3 section heading |
| `## Heading` | H4 subheading |
| `**text**` | Bold |
| `*text*` | Italic |
| `` `code` `` | Inline code |
| `[text](url)` | Link |
| `> text` | Blockquote |
| ` ```lang\n...\n``` ` | Code block |
| `---` | Divider |
| `^T` at paragraph start | Drop cap (must be uppercase letter) |
| Blank line | Paragraph break |

## GitHub Copilot CLI skill

This repo ships a ready-to-use skill for the [GitHub Copilot CLI](https://githubnext.com/projects/copilot-cli/) agent:

```
.copilot/skills/medium-publish/SKILL.md
```

Install it by copying to your user skills directory:

```bash
mkdir -p ~/.copilot/skills/medium-publish
cp .copilot/skills/medium-publish/SKILL.md ~/.copilot/skills/medium-publish/SKILL.md
```

The skill covers the full publishing workflow — login, drafting, cover images with captions, reading drafts, publishing, and safe draft deletion.

## Project structure

```
src/
├── index.ts           # MCP server and tool definitions
├── browser-client.ts  # Playwright automation and all Medium interactions
├── auth.ts            # Legacy (unused)
└── client.ts          # Legacy (unused)
.copilot/
└── skills/
    └── medium-publish/
        └── SKILL.md   # Copilot CLI skill
```

## Limitations

- Browser automation is slower than a native API (10–30 s per operation)
- Dependent on Medium's HTML structure — selectors may need updates if Medium changes their UI
- Google login sessions are less persistent than email/password; prefer email/password
- Subject to Medium's normal rate limits (max 2 published stories per 24 hours)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome, especially for selector resilience and new tool ideas.

## License

MIT — see [LICENSE](LICENSE).

---

**Note**: Unofficial tool, not affiliated with Medium. Use in accordance with [Medium's Terms of Service](https://policy.medium.com/medium-terms-of-service-9db0094a1e0f).

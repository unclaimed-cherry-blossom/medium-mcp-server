---
name: medium-publish
description: >
  Full workflow for writing and publishing articles on Medium via the medium-mcp-server.
  Use this skill when asked to write, draft, or publish a Medium article, blog post, or story.
  Covers login, content writing with correct formatting syntax, draft saving, publishing with tags,
  cover images (Unsplash, local file, YouTube embed) with captions, draft reading, and draft deletion.
---

# Publishing a Medium Article

You have access to a Medium MCP server with these tools:
- `medium-mcp-login-to-medium` — opens a browser and waits for the user to log in
- `medium-mcp-publish-article` — writes an article to the editor and saves it as draft or publishes it
- `medium-mcp-get-article-content` — reads back a published or draft article by URL (including `/edit` draft URLs)
- `medium-mcp-get-my-articles` — lists the user's articles (published + drafts)
- `medium-mcp-search-medium` — searches Medium for articles by keywords
- `medium-mcp-delete-draft` — deletes a draft story by `postId` (**drafts only — refuses published articles**)

---

## Step 1 — Login

Always call `medium-mcp-login-to-medium` first. Wait for confirmation that login succeeded before proceeding. The tool opens a real browser window; the user must log in manually. Do not skip this step even if you believe a session is cached — the MCP server manages session state internally.

---

## Step 2 — Write the article content

Prepare the article content as a string using the markdown-like syntax described below. The MCP server converts this to proper Medium HTML before pasting it into the editor.

### Supported formatting syntax

| Syntax | Result |
|---|---|
| `# Heading text` | Big section heading (H3) |
| `## Heading text` | Small subheading (H4) |
| `**text**` | Bold |
| `*text*` | Italic |
| `` `inline code` `` | Inline code |
| `[link text](url)` | Hyperlink |
| `> blockquote text` | Block quote |
| ` ```python\n...\n``` ` | Code block (replace `python` with the language) |
| `---` | Horizontal divider |
| `^T` at paragraph start | Drop cap on the letter T (must be uppercase) |
| Blank line | Paragraph break |

### Cover images

You can insert **one or more** cover media blocks at the top of the article. All three types can be combined in a single call — they are inserted sequentially after the title. Each supports an optional caption.

| Parameter | Description |
|---|---|
| `coverImageYoutubeUrl` | YouTube URL — pasted on empty line, Medium auto-embeds as iframe |
| `coverImageYoutubeCaption` | Caption for the YouTube embed |
| `coverImageFile` | Absolute path to a local image file — uploaded to Medium's CDN via file chooser |
| `coverImageFileCaption` | Caption for the local file image |
| `coverImageQuery` | Unsplash search term — Medium's native integration, inserts first result with attribution |
| `coverImageQueryCaption` | Caption for the Unsplash image |

Insertion order is always: YouTube → local file → Unsplash. Cover image insertion is non-fatal — if it fails, the article still saves/publishes. Works for both new stories and existing drafts (`postId`).

### Writing guidelines

- Keep paragraphs short — 2-4 sentences. Medium readers scan.
- Use code blocks for ALL code snippets, even single-line ones.
- Use inline code (backticks) for identifiers, field names, and flags inside prose.
- Use `>` blockquotes sparingly — for key takeaways or callouts only.
- Use `---` to separate major sections.
- Do not use emojis.
- Write in English. Imperative, present tense for technical instructions.
- Aim for 5-7 minute read time (~1000-1400 words).

---

## Step 3 — Save as draft

Call `medium-mcp-publish-article` with `isDraft: true`. This writes the content to a new Medium story and saves it automatically. Do not set `isDraft: false` unless the user explicitly confirms they want to publish immediately.

Required parameters:
- `title` — the article title (plain text, no markdown)
- `content` — the article body using the syntax above
- `isDraft` — set to `true` unless user says to publish now
- `tags` — array of 1-5 lowercase strings (optional, only used when publishing)

On success the tool returns a URL. Tell the user to open it to review the draft.

Example call:

```json
{
  "title": "My Article Title",
  "content": "# Introduction\n\nFirst paragraph...\n\n```python\nprint('hello')\n```",
  "isDraft": true,
  "tags": ["python", "tutorial"]
}
```

---

## Step 4 — Review

After saving the draft, ask the user to open the returned URL and check formatting. You can also read the draft back with `medium-mcp-get-article-content` using the `/edit` URL — it extracts title, cover image URL, and all paragraphs from the editor DOM. Common issues to watch for:

- Code blocks not rendering — check that the fence syntax uses a blank line before and after
- Bold/italic not rendering — check for stray spaces inside `**` or `*` markers
- Drop cap not working — the `^` must immediately precede an uppercase letter with no space

---

## Step 5 — Publish

When the user confirms the draft looks good and wants to publish:

1. Call `medium-mcp-login-to-medium` to ensure the session is fresh.
2. Call `medium-mcp-get-my-articles` to list all drafts and get their `postId` values.
3. Call `medium-mcp-publish-article` with `isDraft: false`, `postId` set to the draft's ID, and include `tags`.
   - Using `postId` skips the editor entirely and goes directly to the submission page — much more reliable.
4. Tags must be lowercase, single-word or hyphenated strings. Maximum 5 tags.
5. The returned URL may still show `/submission` — that is normal. The article is live at `https://medium.com/p/<postId>`.

Example call to publish an existing draft:

```json
{
  "title": "My Article Title",
  "content": "placeholder",
  "isDraft": false,
  "postId": "b9c7ae8aadd5",
  "tags": ["python", "tutorial"]
}
```

**Note**: `content` and `title` are ignored when `postId` is provided — the existing draft content is used as-is.

### Step 5b — Verify publication (CRITICAL)

After calling `medium-mcp-publish-article`, **always verify** the article is actually published:

1. Call `medium-mcp-get-article-content` with `url: "https://medium.com/p/<postId>"`.
2. If it returns article content → published successfully. Report the URL to the user.
3. If it returns an error or redirects to login → publication failed silently. Report the failure and check for error banners.

Do NOT assume success based solely on `{"success": true}` from the publish tool.

---

## Step 6 — Delete drafts

To delete draft stories, call `medium-mcp-delete-draft` with the `postId`.

**CRITICAL GUARDRAIL**: `delete-draft` only deletes **drafts**. If the `postId` belongs to a published article, the tool detects the redirect away from `/edit` and returns an error — it will NOT delete published articles. Never attempt to delete published articles.

Workflow to clean up drafts:
1. Call `medium-mcp-get-my-articles` to list all stories.
2. Identify items with `"status": "draft"`.
3. Call `medium-mcp-delete-draft` for each draft `postId` you want to remove.
4. Confirm with the user before deleting drafts that look like real content (long titles, not test articles).

---

## Error handling

- **Login failed / redirected to Google**: session expired. Call `medium-mcp-login-to-medium` and wait for user to complete login.
- **Timeout on editor selector**: Medium's CF challenge is taking too long. Retry once after 10 seconds.
- **Content looks mangled in draft**: the clipboard paste may have failed. Read the article back, compare with input, and retry the publish call.
- **Tags step fails**: ignore tag errors for drafts — they are applied at publish time only.
- **"Submit" button not found on submission page**: Medium's submission page uses "Submit" as the final CTA, not "Publish now". If this fails, the MCP server will return the visible button list in the error message.
- **Draft URL is still `/new-story`**: autosave has not fired yet. Wait 5 seconds and call `medium-mcp-get-my-articles` to find the draft.
- **Rate limit: "maximum of two stories in the past 24 hours"**: Medium limits publishing to 2 stories per 24 hours. Always verify with Step 5b. If rate-limited, inform the user and wait 24 hours before retrying.
- **Cover image insertion fails**: `insertCoverImage` is non-fatal — the draft/publish continues even if the image step fails. Debug screenshots saved to `/tmp/medium-*.png`.
- **delete-draft returns "not a draft"**: the postId belongs to a published article. Do not attempt to delete it.

# Changelog

All notable changes to Medium MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-05-05

### Added
- **Cover media** — Unsplash search, local file upload, and YouTube embed; all three types supported in a single `publish-article` call, inserted sequentially after the title
- **Captions** — `coverImageYoutubeCaption`, `coverImageFileCaption`, `coverImageQueryCaption` parameters; uses figcaption count-based waiting for reliable insertion
- **`delete-draft` tool** — deletes a draft story by `postId`; hard guardrail refuses to delete published articles (detects redirect away from `/edit`)
- **Draft reading** — `get-article-content` now works on `/edit` draft URLs by extracting content from the editor DOM instead of the published article DOM
- **`get-my-articles` includes drafts** — returns both published and draft stories with `postId` and `status` fields
- **GitHub Copilot CLI skill** — `.copilot/skills/medium-publish/SKILL.md` for use with the Copilot CLI agent

### Changed
- `publish-article` cover image logic changed from `else if` (one type only) to sequential insertion (all three types in one call)
- `clickPlusButton()` now uses `window.getSelection()` caret rect for accurate `+` button hover positioning
- Unsplash image selection uses real mouse coordinates (`page.mouse.move` + `page.mouse.click`) instead of DOM `.click()` to avoid pointer-events blocking
- Unsplash search field uses `keyboard.type()` on a `contenteditable` div instead of `.fill()` on an `<input>`
- `delete-draft` navigates to `/p/{postId}/settings` via the `···` menu → "More settings" → "Delete story" button → confirmation modal (`[data-testid="deleteStoryModalConfirmButton"]`)

### Fixed
- Cover image `+` button hover now reliably opens the popover by using the editor caret position
- YouTube caption insertion timing fixed with figcaption count-based waiting

## [1.0.0] - 2024-07-08

### Added
- **Browser-based automation** using Playwright instead of deprecated Medium API
- **MCP Tools**: `publish-article`, `get-my-articles`, `search-medium`, `get-article-content`, `login-to-medium`
- **Session persistence** via `medium-session.json`
- **Anti-detection measures** for realistic browser automation
- **Robust content extraction** handling both preview and full article content


### 🎉 Initial Release

**Major Achievement**: Complete rewrite from API-based to browser automation approach due to Medium's API deprecation.

### Added
- **Browser-based automation** using Playwright instead of deprecated Medium API
- **MCP Tools**:
  - `publish-article` - Publish articles with title, content, tags, and draft option
  - `get-my-articles` - Retrieve user's published articles
  - `search-medium` - Search Medium articles by keywords
  - `get-article-content` - Extract full content from any Medium article
  - `login-to-medium` - Manual login trigger for session management

### Features
- **Session persistence** - Login once, use everywhere via `medium-session.json`
- **Headless operation** - Runs without UI after initial login
- **Anti-detection measures** - Realistic browser automation to avoid blocking
- **Multiple login methods** - Support for email/password and Google login
- **Robust content extraction** - Handles both preview and full article content
- **Enhanced search** - Returns actual article URLs with proper content extraction
- **Error handling** - Comprehensive error messages and recovery strategies

### Technical Implementation
- **TypeScript** with strict mode configuration
- **Playwright** browser automation with Chromium
- **MCP SDK** integration for Claude compatibility
- **Zod** schema validation for type safety
- **Session management** with automatic validation and renewal

### Browser Automation Features
- **Smart selectors** with fallback strategies for UI changes
- **Rate limiting** respect for Medium's servers
- **Timeout handling** for reliable automation
- **Preview detection** for content extraction
- **URL validation** to ensure proper article links

### Documentation
- Comprehensive README with setup instructions
- Troubleshooting guide for common issues
- Contributing guidelines for developers
- Example configurations for Claude integration

### Development Tools
- Multiple test scripts for validation
- Debug utilities for selector updates
- Session management helpers
- Login flow debugging tools

## [0.x.x] - Legacy API Version

### Deprecated
- **Medium API integration** - No longer functional due to Medium's API discontinuation
- **OAuth2 flow** - Replaced with browser-based session management
- **API token authentication** - Not available for new users

---

## Future Roadmap

### Planned Features
- **Publication support** - Publish to Medium publications
- **Article analytics** - Retrieve article performance data
- **Bulk operations** - Mass article management
- **Enhanced tagging** - Better tag management and suggestions
- **Draft management** - Advanced draft handling and scheduling

### Technical Improvements
- **Performance optimization** - Faster browser automation
- **Selector resilience** - Better handling of Medium UI changes
- **Session security** - Enhanced session encryption and management
- **Error recovery** - More robust error handling and retry logic

---

## Migration Guide

### From API Version (0.x.x) to Browser Version (1.0.0)

**Breaking Changes**:
- No more API tokens required
- New authentication flow via browser login
- Different response formats for some tools
- Session management replaces token-based auth

**Migration Steps**:
1. Remove old `.env` API configurations
2. Install Playwright: `npx playwright install chromium`
3. Update Claude MCP configuration
4. Run initial login: `npm start` and complete browser login
5. Test functionality with new browser-based tools

**Benefits of Migration**:
- ✅ No API token limitations
- ✅ Access to full Medium functionality
- ✅ Better content extraction capabilities
- ✅ Support for all Medium features

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 
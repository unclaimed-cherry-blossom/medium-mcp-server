import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface MediumArticle {
  title: string;
  content: string;
  url?: string;
  publishDate?: string;
  tags?: string[];
  claps?: number;
}

export interface PublishOptions {
  title: string;
  content: string;
  tags?: string[];
  isDraft?: boolean;
  postId?: string;           // navigate directly to existing draft's submission page
  coverImageQuery?: string;         // Unsplash search query
  coverImageQueryCaption?: string;  // caption for Unsplash image
  coverImageFile?: string;          // absolute path to a local image file
  coverImageFileCaption?: string;   // caption for local file image
  coverImageYoutubeUrl?: string;    // YouTube URL to embed
  coverImageYoutubeCaption?: string; // caption for YouTube embed
}

export class BrowserMediumClient {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionPath = join(process.cwd(), 'medium-session.json');

  /**
   * Converts a simple markdown-like string to Medium editor HTML.
   *
   * Supported syntax:
   *   # Heading         → <h3> (big title)
   *   ## Heading        → <h4> (small title)
   *   ```lang\n...\n``` → <pre data-code-block-mode="2" data-code-block-lang="lang">
   *   ---               → <hr>
   *   **text**          → <strong>
   *   *text*            → <em>
   *   blank-line sep    → paragraph break
   */
  private toMediumHtml(content: string): string {
    const blocks: string[] = [];
    const lines = content.split('\n');
    let i = 0;

    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Apply inline formatting to already-escaped or raw text.
    // Order matters: code before bold/italic to avoid mangling backtick contents.
    const applyInline = (s: string): string =>
      escapeHtml(s)
        .replace(/`(.+?)`/g, '<code class="markup--code markup--p-code">$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong class="markup--strong markup--p-strong">$1</strong>')
        .replace(/\*(.+?)\*/g, '<em class="markup--em markup--p-em">$1</em>')
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" data-href="$2" class="markup--anchor markup--p-anchor" target="_blank" rel="noopener">$1</a>');

    // Drop cap: ^X where X is the first letter, rest of line follows
    // e.g. "^The quick brown fox" → <p class="graf--hasDropCap"><span class="graf-dropCap">T</span>he quick brown fox</p>
    const applyDropCap = (s: string): string => {
      const match = s.match(/^\^([A-Z])(.*)$/);
      if (!match) return `<p data-testid="editorParagraphText" class="graf graf--p">${applyInline(s)}</p>`;
      return `<p data-testid="editorParagraphText" class="graf graf--p graf--hasDropCapModel graf--hasDropCap"><span class="graf-dropCap">${match[1]}</span>${applyInline(match[2])}</p>`;
    };

    const isBlockStart = (l: string) =>
      l.match(/^```/) || l.match(/^#{1,2}\s/) || l.trim() === '---' || l.match(/^>\s/);

    while (i < lines.length) {
      const line = lines[i];

      // Code block
      const fenceMatch = line.match(/^```(\w*)$/);
      if (fenceMatch) {
        const lang = fenceMatch[1] || 'plain';
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing fence
        const escaped = codeLines.map(l => l === '' ? '&nbsp;' : escapeHtml(l)).join('<br>');
        blocks.push(
          `<pre data-code-block-mode="2" spellcheck="false" data-code-block-lang="${lang}" data-testid="editorCodeBlockParagraph"><span class="pre--content">${escaped}</span></pre>`
        );
        continue;
      }

      // Big heading (# text) → h3
      const h3Match = line.match(/^#\s+(.+)$/);
      if (h3Match) {
        blocks.push(`<h3 data-testid="editorHeadingText" class="graf graf--h3">${applyInline(h3Match[1])}</h3>`);
        i++;
        continue;
      }

      // Small heading (## text) → h4
      const h4Match = line.match(/^##\s+(.+)$/);
      if (h4Match) {
        blocks.push(`<h4 data-testid="editorHeadingText" class="graf graf--h4">${applyInline(h4Match[1])}</h4>`);
        i++;
        continue;
      }

      // Horizontal rule
      if (line.trim() === '---') {
        blocks.push('<hr>');
        i++;
        continue;
      }

      // Blockquote (> text)
      const bqMatch = line.match(/^>\s+(.+)$/);
      if (bqMatch) {
        blocks.push(`<blockquote data-testid="editorParagraphText" class="graf graf--blockquote">${applyInline(bqMatch[1])}</blockquote>`);
        i++;
        continue;
      }

      // Empty line — skip
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Regular paragraph — accumulate until blank line or block element
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !isBlockStart(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      blocks.push(applyDropCap(paraLines.join(' ')));
    }

    return blocks.join('');
  }

  async initialize(): Promise<void> {
    this.browser = await chromium.launch({ 
      headless: false, // Keep visible for login
      slowMo: 100, // Slow down for reliability
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--disable-web-security',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ]
    });

    // Load existing session if available
    const contextOptions: any = {
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };

    if (existsSync(this.sessionPath)) {
      try {
        const sessionData = JSON.parse(readFileSync(this.sessionPath, 'utf8'));
        contextOptions.storageState = sessionData;
      } catch (error) {
        console.error('Failed to load session:', error);
      }
    }

    this.context = await this.browser.newContext(contextOptions);

    // Grant clipboard permissions so navigator.clipboard.writeText() works in page.evaluate()
    await this.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://medium.com' });
    
    // Add script to remove webdriver property
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // Remove automation indicators
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    });
    
    this.page = await this.context.newPage();
  }

  async ensureLoggedIn(): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');

    // First check if we have a saved session
    if (existsSync(this.sessionPath)) {
      console.error('💾 Found existing session file, testing login status...');
    }

    // Try a simpler page first to check login status
    await this.page.goto('https://medium.com');
    await this.page.waitForLoadState('networkidle');
    
    // Check if we're logged in by looking for user-specific elements
    try {
      // Try multiple selectors for logged-in state
      const loginSelectors = [
        '[data-testid="headerUserButton"]',
        '.avatar',
        '[data-testid="user-menu"]',
        'button[aria-label*="user"]',
        'img[alt*="avatar"]',
        '[data-testid="write-button"]', // Write button only appears when logged in
        'a[href="/me/stories"]'
      ];
      
      let isLoggedIn = false;
      for (const selector of loginSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 3000 });
          console.error(`✅ Login detected using selector: ${selector}`);
          isLoggedIn = true;
          break;
        } catch {
          // Try next selector
        }
      }
      
      if (isLoggedIn) {
        console.error('✅ Already logged in to Medium');
        await this.saveSession();
        return true;
      } else {
        throw new Error('Not logged in');
      }
    } catch {
      console.error('❌ Not logged in. Please log in manually...');
      
      // Navigate to login page
      await this.page.goto('https://medium.com/m/signin');
      
      // Wait for user to complete login
      console.error('⏳ Waiting for you to complete login in the browser...');
      console.error('');
      console.error('🔐 LOGIN INSTRUCTIONS:');
      console.error('   1. In the opened browser, choose "Sign in with email"');
      console.error('   2. Use your Medium email/password (avoid Google login if possible)');
      console.error('   3. If you must use Google login:');
      console.error('      - Try clicking "Sign in with Google"');
      console.error('      - If blocked, manually navigate to medium.com in a regular browser');
      console.error('      - Login there first, then come back to this automated browser');
      console.error('   4. Complete any 2FA if prompted');
      console.error('   5. The script will continue automatically once logged in...');
      console.error('');
      
      // Wait for successful login (user button appears)
      try {
        await this.page.waitForSelector('[data-testid="headerUserButton"], .avatar, [data-testid="user-menu"]', { timeout: 300000 }); // 5 minutes
        console.error('✅ Login successful!');
        await this.saveSession();
        return true;
      } catch (error) {
        console.error('❌ Login timeout. Please try again.');
        return false;
      }
    }
  }

  async saveSession(): Promise<void> {
    if (!this.context) return;
    
    try {
      const sessionData = await this.context.storageState();
      writeFileSync(this.sessionPath, JSON.stringify(sessionData, null, 2));
      console.error('💾 Session saved for future use');
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }

  async getUserArticles(): Promise<MediumArticle[]> {
    if (!this.page) throw new Error('Browser not initialized');
    
    await this.ensureLoggedIn();

    const scrape = async (url: string): Promise<MediumArticle[]> => {
      await this.page!.goto(url);
      await this.page!.waitForLoadState('networkidle');
      await this.page!.waitForTimeout(2000);
      return this.page!.evaluate(() => {
        const results: any[] = [];
        const seen = new Set<string>();
        // Find all links to story edit pages or /p/ pages that sit near a heading
        document.querySelectorAll('a[href*="/p/"], a[href*="medium.com/p/"]').forEach(link => {
          const href = (link as HTMLAnchorElement).href;
          const postIdMatch = href.match(/\/p\/([a-zA-Z0-9]+)/);
          if (!postIdMatch) return;
          const postId = postIdMatch[1];
          if (seen.has(postId)) return;
          // Walk up to find a title nearby
          let titleText = '';
          let el: Element | null = link;
          for (let i = 0; i < 6; i++) {
            el = el?.parentElement || null;
            if (!el) break;
            const h = el.querySelector('h1, h2, h3');
            if (h) { titleText = h.textContent?.trim() || ''; break; }
          }
          if (!titleText) {
            // Maybe the link itself contains the title
            titleText = link.textContent?.trim() || '';
          }
          if (!titleText) return;
          seen.add(postId);
          const container = link.closest('article, [data-testid], section, div') as Element | null;
          const dateEl = container?.querySelector('time, [data-testid*="date"]');
          results.push({
            title: titleText,
            content: '',
            url: href,
            publishDate: dateEl?.textContent?.trim() || '',
            tags: [],
            postId,
          });
        });
        return results;
      });
    };

    const drafts = await scrape('https://medium.com/me/stories');
    const published = await scrape('https://medium.com/me/stories?tab=posts-published');

    return [
      ...published.map((a: any) => ({ ...a, status: 'published' })),
      ...drafts.map((a: any) => ({ ...a, status: 'draft' })),
    ];
  }

  async getArticleContent(url: string, requireLogin: boolean = true): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');
    
    console.error(`📖 Fetching article content from: ${url}`);
    
    // Check if we have a saved session first
    let isLoggedIn = false;
    if (existsSync(this.sessionPath)) {
      console.error('💾 Found saved session, checking if still valid...');
      
      // Quick check: try to access Medium homepage and look for login indicators
      try {
        await this.page.goto('https://medium.com');
        await this.page.waitForLoadState('networkidle');
        
        // Try to find login indicators quickly
        const loginIndicators = [
          '[data-testid="headerUserButton"]',
          '[data-testid="write-button"]',
          'a[href="/me/stories"]'
        ];
        
        for (const selector of loginIndicators) {
          try {
            await this.page.waitForSelector(selector, { timeout: 2000 });
            console.error('✅ Session is still valid, user is logged in');
            isLoggedIn = true;
            break;
          } catch {
            // Try next selector
          }
        }
      } catch (error) {
        console.error('⚠️  Could not verify session validity');
      }
    }
    
    if (!isLoggedIn && requireLogin) {
      console.error('🔐 Not logged in. Attempting login for full content access...');
      isLoggedIn = await this.ensureLoggedIn();
    } else if (!isLoggedIn && !requireLogin) {
      console.error('🔓 Skipping login as requested. Will get preview content only.');
    }
    
    if (!isLoggedIn) {
      console.error('⚠️  Warning: Login failed or skipped. You may only get partial content (preview).');
    } else {
      console.error('✅ Ready to fetch full article content with login session');
    }
    
    try {
      console.error(`🌐 Navigating to article: ${url}`);
      await this.page.goto(url, { waitUntil: 'networkidle' });
      
      // Wait a bit more for dynamic content
      await this.page.waitForTimeout(3000);
      
      console.error('📄 Page loaded, extracting content...');

      // Draft editor path — extract title + paragraphs from the editor DOM
      const isDraftEditor = url.includes('/edit') || (await this.page.evaluate(() => !!document.querySelector('.section-editor, [data-testid="editorParagraphText"]')));
      if (isDraftEditor) {
        const draftContent = await this.page.evaluate(() => {
          const title = (document.querySelector('h3[data-testid="storyTitle"], textarea[data-testid="storyTitle"], [data-testid="storyTitle"]') as HTMLElement)?.innerText
            || (document.querySelector('h1.graf--title, h2.graf--title') as HTMLElement)?.innerText || '';
          const paras = Array.from(document.querySelectorAll('[data-testid="editorParagraphText"], .graf--p, .graf--h2, .graf--h3, .graf--blockquote, .graf--pre'))
            .map(el => (el as HTMLElement).innerText?.trim())
            .filter(t => t && t.length > 0);
          const coverImg = (document.querySelector('figure img, .graf--figure img') as HTMLImageElement)?.src || '';
          return { title, paragraphs: paras, coverImage: coverImg };
        });
        let result = '';
        if (draftContent.title) result += `Title: ${draftContent.title}\n\n`;
        if (draftContent.coverImage) result += `Cover image: ${draftContent.coverImage}\n\n`;
        if (draftContent.paragraphs.length > 0) result += draftContent.paragraphs.join('\n\n');
        if (result.trim()) return result;
      }

      // Extract article content with multiple strategies
      const content = await this.page.evaluate(() => {
        const log = (...args: any[]) => {
          // Silent in browser context to avoid JSON interference
        };
        
        log('🔍 Starting content extraction...');
        
        // Strategy 1: Try modern Medium article selectors
        const modernSelectors = [
          'article section p',
          'article div[data-testid="story-content"] p',
          '[data-testid="story-content"] p',
          'article section div p',
          'article p'
        ];
        
        // Strategy 2: Try classic Medium selectors
        const classicSelectors = [
          '.postArticle-content p',
          '.section-content p',
          '.graf--p',
          '.postArticle p'
        ];
        
        // Strategy 3: Generic content selectors
        const genericSelectors = [
          'main p',
          '[role="main"] p',
          '.story p',
          '.post p'
        ];
        
        const allSelectors = [...modernSelectors, ...classicSelectors, ...genericSelectors];
        let extractedContent = '';
        
        // Try each selector strategy
        for (const selector of allSelectors) {
          const elements = document.querySelectorAll(selector);
          log(`🎯 Selector "${selector}" found ${elements.length} paragraphs`);
          
          if (elements.length > 3) { // Need at least a few paragraphs for meaningful content
            const paragraphs: string[] = [];
            
            elements.forEach((element, index) => {
              const text = element.textContent?.trim();
              if (text && text.length > 20) { // Filter out very short paragraphs
                paragraphs.push(text);
              }
            });
            
            if (paragraphs.length > 2) { // Need meaningful content
              extractedContent = paragraphs.join('\n\n');
              log(`✅ Successfully extracted ${paragraphs.length} paragraphs using: ${selector}`);
              break;
            }
          }
        }
        
        // Fallback: Try to get any substantial text content
        if (!extractedContent) {
          log('🔄 Trying fallback content extraction...');
          
          const fallbackSelectors = [
            'article',
            'main',
            '[role="main"]',
            '.story',
            '.post'
          ];
          
          for (const selector of fallbackSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              const text = element.textContent?.trim();
              if (text && text.length > 200) {
                // Clean up the text a bit
                extractedContent = text
                  .replace(/\s+/g, ' ') // Normalize whitespace
                  .replace(/(.{100})/g, '$1\n\n') // Add paragraph breaks
                  .substring(0, 5000); // Limit length
                
                log(`✅ Fallback extraction successful using: ${selector}`);
                break;
              }
            }
          }
        }
        
        // Debug info if still no content
        if (!extractedContent) {
          log('❌ No content found. Page analysis:');
          log('Page title:', document.title);
          log('Page URL:', window.location.href);
          log('Body text length:', document.body.textContent?.length || 0);
          
          // Check if we hit a paywall or login requirement
          const paywallIndicators = [
            'sign up',
            'subscribe',
            'member-only',
            'paywall',
            'premium',
            'upgrade'
          ];
          
          const pageText = document.body.textContent?.toLowerCase() || '';
          const foundIndicators = paywallIndicators.filter(indicator => 
            pageText.includes(indicator)
          );
          
          if (foundIndicators.length > 0) {
            log('🚫 Possible paywall detected:', foundIndicators);
            return `Content may be behind a paywall or require login. Found indicators: ${foundIndicators.join(', ')}`;
          }
          
          return 'Unable to extract article content. The article may be behind a paywall, require login, or use an unsupported layout.';
        }
        
        // Check if we might be getting only a preview (very short content)
        if (extractedContent.length < 500) {
          log('⚠️  Warning: Content seems short, might be preview only');
          
          // Look for "continue reading" or member-only indicators
          const previewIndicators = [
            'continue reading',
            'read more',
            'member-only story',
            'this story is for members only',
            'become a member',
            'sign up to continue',
            'subscribe to read'
          ];
          
          const pageText = document.body.textContent?.toLowerCase() || '';
          const foundPreviewIndicators = previewIndicators.filter(indicator => 
            pageText.includes(indicator)
          );
          
          if (foundPreviewIndicators.length > 0) {
            log('🔒 Preview-only content detected:', foundPreviewIndicators);
            extractedContent = `[PREVIEW ONLY - Login required for full content]\n\n${extractedContent}\n\n[This appears to be only a preview. The full article requires Medium membership or login. Found indicators: ${foundPreviewIndicators.join(', ')}]`;
          }
        }
        
        log(`📊 Final content length: ${extractedContent.length} characters`);
        return extractedContent;
      });

      console.error(`✅ Content extraction completed. Length: ${content.length} characters`);
      return content;
      
    } catch (error) {
      console.error('❌ Error fetching article content:', error);
      throw new Error(`Failed to fetch article content: ${error}`);
    }
  }

  /**
   * Positions the cursor on a fresh empty paragraph at the very top of the article
   * body (below the title), then inserts a cover image using Unsplash, a local file,
   * or a YouTube embed depending on which option is set in `options`.
   *
   * Safe to call after the editor has fully loaded and content has been pasted.
   * Non-fatal: callers should catch and continue on failure.
   */
  private async insertCoverImage(options: PublishOptions): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    // Click the title and go to its end, then press Enter to create a guaranteed-empty
    // paragraph immediately after the title. This works even when the draft already has
    // media blocks at the top (which would cause Meta+ArrowUp to land on a non-empty line).
    const titleEl = this.page.locator('[data-testid="editorTitleParagraph"]').first();
    await titleEl.click();
    await this.page.keyboard.press('Meta+ArrowDown'); // end of title
    await this.page.keyboard.press('End');
    await this.page.keyboard.press('Enter');          // new empty paragraph right after title
    await this.page.waitForTimeout(600);

    // Insert all provided media types sequentially, each on its own line
    if (options.coverImageYoutubeUrl) {
      const before = await this.figcaptionCount();
      await this.insertYoutubeEmbed(options.coverImageYoutubeUrl);
      await this.page.waitForTimeout(500);
      if (options.coverImageYoutubeCaption) await this.typeCaption(options.coverImageYoutubeCaption, before);
    }
    if (options.coverImageFile) {
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(400);
      const before = await this.figcaptionCount();
      await this.insertLocalFile(options.coverImageFile);
      await this.page.waitForTimeout(500);
      if (options.coverImageFileCaption) await this.typeCaption(options.coverImageFileCaption, before);
    }
    if (options.coverImageQuery) {
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(400);
      const before = await this.figcaptionCount();
      await this.insertUnsplashImage(options.coverImageQuery);
      await this.page.waitForTimeout(500);
      if (options.coverImageQueryCaption) await this.typeCaption(options.coverImageQueryCaption, before);
    }
  }

  /** Types a caption into the figcaption of the most recently inserted figure.
   *  Waits until the count of figcaptions exceeds `prevCount` to ensure we target the new one. */
  private async typeCaption(caption: string, prevCount: number = 0): Promise<void> {
    if (!this.page) return;
    // Wait for a new figcaption to appear (count increases after insertion)
    await this.page.waitForFunction(
      (n) => document.querySelectorAll('figcaption.imageCaption').length > n,
      prevCount,
      { timeout: 8000 }
    ).catch(() => {});
    const captionEl = this.page.locator('figcaption.imageCaption').last();
    if (await captionEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      await captionEl.click();
      await this.page.keyboard.type(caption);
      await this.page.waitForTimeout(300);
      console.error(`✅ Caption typed: "${caption}"`);
    } else {
      console.error('⚠️  Could not find figcaption to type caption');
    }
  }

  /** Returns the current number of figcaptions in the editor. */
  private async figcaptionCount(): Promise<number> {
    if (!this.page) return 0;
    return this.page.evaluate(() => document.querySelectorAll('figcaption.imageCaption').length);
  }

  /** Clicks the Medium editor + button on the currently focused empty line. */
  private async clickPlusButton(): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    // Prefer the caret (selection) rect — it tracks the exact cursor position
    // even when document.activeElement is a large contenteditable container.
    const rect = await this.page.evaluate(() => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        // A collapsed range on an empty line has zero width/height — fall back
        // to the startContainer's own rect in that case.
        if (r.width > 0 || r.height > 0) {
          return { x: r.left, y: r.top + r.height / 2 };
        }
        const node = sel.getRangeAt(0).startContainer;
        const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null;
        if (el) {
          const er = el.getBoundingClientRect();
          return { x: er.left, y: er.top + er.height / 2 };
        }
      }
      // Last resort: activeElement
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const r = active.getBoundingClientRect();
        return { x: r.left, y: r.top + r.height / 2 };
      }
      return null;
    });

    const plusX = rect ? Math.max(rect.x - 40, 8) : 8;
    const plusY = rect ? rect.y : 400;

    // Move to just left of the line to reveal the floating + button, then wait for it
    await this.page.mouse.move(plusX, plusY);
    await this.page.waitForTimeout(800);

    // Try named selectors first (they work on some Medium builds)
    const plusSelectors = [
      'button[data-testid="editorAddButton"]',
      'button[data-testid="addPostPopoverButton"]',
      '[data-testid="addSectionButton"]',
      'button[aria-label="Add section"]',
      'button[aria-label="Add"]',
    ];

    for (const sel of plusSelectors) {
      const btn = this.page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click();
        console.error(`✅ Clicked + button via selector: ${sel}`);
        await this.page.waitForTimeout(600);
        return;
      }
    }

    // Fallback: the + button has no data-testid on some Medium builds — find any
    // button rendered near the left margin of the editor (x < 300) that appeared
    // after the hover, and click it directly.
    const plusBtn = await this.page.evaluateHandle(([hoverX, hoverY]: number[]) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      // Find a button visually close to where we hovered
      for (const btn of buttons) {
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (Math.abs(cx - hoverX) < 80 && Math.abs(cy - hoverY) < 60) {
          return btn;
        }
      }
      return null;
    }, [plusX, plusY]);

    const el = plusBtn.asElement();
    if (el) {
      await el.click();
      console.error('✅ Clicked + button via position proximity');
      await this.page.waitForTimeout(600);
      return;
    }

    // Last resort: click directly at the hovered coordinates
    console.error('⚠️  No + button element found — clicking at hover coordinates');
    await this.page.mouse.click(plusX, plusY);
    await this.page.waitForTimeout(600);
  }

  /** Inserts a YouTube embed on the current empty line. */
  private async insertYoutubeEmbed(youtubeUrl: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    console.error(`▶️  Inserting YouTube embed: ${youtubeUrl}`);

    // Medium auto-embeds YouTube URLs when pasted on an empty line and Enter is pressed
    await this.page.evaluate(async (url) => navigator.clipboard.writeText(url), youtubeUrl);
    await this.page.keyboard.press('Meta+v');
    await this.page.waitForTimeout(800);
    // Press Enter to trigger Medium's auto-embed conversion
    await this.page.keyboard.press('Enter');

    // Wait for the iframe embed to appear
    await this.page.waitForFunction(
      () => document.querySelector('figure.graf--iframe, [data-testid="editorParagraphText"].graf--iframe, .iframeContainer') !== null,
      { timeout: 15000 }
    ).catch(() => console.error('⚠️  YouTube embed may not have rendered'));

    await this.page.waitForTimeout(500);
    console.error('✅ YouTube embed inserted');
  }

  /** Uploads a local image file via the Medium editor + → image upload flow. */
  private async insertLocalFile(filePath: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    console.error(`📁 Inserting local file: ${filePath}`);

    await this.clickPlusButton();
    // Screenshot the popover so we can see what options are available
    await this.page.screenshot({ path: '/tmp/medium-upload-popover.png' }).catch(() => {});
    await this.page.waitForTimeout(300);

    // Set up file chooser listener BEFORE clicking the upload button
    const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 15000 });

    // Try hidden file input first (Medium uses a hidden <input type="file">)
    const hiddenInput = this.page.locator('input[type="file"]').first();
    if (await hiddenInput.count() > 0) {
      // Directly set files without clicking — works for hidden inputs
      await hiddenInput.setInputFiles(filePath);
      console.error('✅ Set files directly on hidden file input');
    } else {
      // Click the image upload option in the popover (camera / image icon)
      const imageUploadSelectors = [
        'button[data-action="inline-menu-image"]',
        'button[aria-label="Add an image"]',
        'button[data-testid="imageUploadButton"]',
      ];

      let uploadClicked = false;
      for (const sel of imageUploadSelectors) {
        const btn = this.page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click();
          uploadClicked = true;
          console.error(`✅ Clicked upload button: ${sel}`);
          break;
        }
      }

      if (!uploadClicked) {
        // Dump ALL buttons with full outerHTML for debugging
        const btns = await this.page.evaluate(() =>
          Array.from(document.querySelectorAll('button')).map(b => ({
            text: b.textContent?.trim().slice(0, 40),
            testid: b.getAttribute('data-testid'),
            aria: b.getAttribute('aria-label'),
            outer: b.outerHTML.slice(0, 200),
          }))
        );
        await this.page.screenshot({ path: '/tmp/medium-upload-popover.png' }).catch(() => {});
        throw new Error(`Could not find image upload button. ALL buttons: ${JSON.stringify(btns)}`);
      }

      await fileChooserPromise.then(fc => fc.setFiles(filePath));
    }

    // Wait for upload and insertion
    await this.page.waitForFunction(
      () => document.querySelector('[data-testid="editorImageParagraph"], figure img, .graf--figure img') !== null,
      { timeout: 30000 }
    ).catch(() => console.error('⚠️  Could not confirm image was inserted after upload'));

    await this.page.waitForTimeout(500);
    console.error('✅ Local file inserted');
  }

  /** Inserts an Unsplash image at the current cursor position via the + toolbar. */
  private async insertUnsplashImage(query: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    console.error(`🖼️  Inserting Unsplash image for query: "${query}"`);

    await this.clickPlusButton();

    // Click the Unsplash option in the popover
    const unsplashSelectors = [
      'button[data-action="inline-menu-unsplash-image"]',
      'button[aria-label="Add an image from Unsplash"]',
      'button:has-text("Unsplash")',
    ];

    let unsplashClicked = false;
    for (const sel of unsplashSelectors) {
      const btn = this.page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        unsplashClicked = true;
        console.error(`✅ Clicked Unsplash option: ${sel}`);
        break;
      }
    }

    if (!unsplashClicked) {
      const btns = await this.page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).map(b => ({
          text: b.textContent?.trim().slice(0, 40),
          testid: b.getAttribute('data-testid'),
          aria: b.getAttribute('aria-label'),
          cls: b.className.slice(0, 60),
        }))
      );
      await this.page.screenshot({ path: '/tmp/medium-unsplash-debug.png' }).catch(() => {});
      throw new Error(`Could not find Unsplash option. ALL buttons: ${JSON.stringify(btns)}`);
    }

    await this.page.waitForTimeout(1000);

    // The Unsplash search field is a contenteditable div with class js-unsplashImageInput
    const searchInput = this.page.locator('.js-unsplashImageInput[contenteditable="true"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 10000 });
    await searchInput.click();
    await this.page.keyboard.type(query);
    await this.page.keyboard.press('Enter');

    // Wait for results grid to populate
    await this.page.waitForSelector('.unsplashImageGrid img', { timeout: 10000 });
    await this.page.waitForTimeout(1000);

    // Get bounding box of first image and click the center with real mouse events
    const firstImg = this.page.locator('.unsplashImageGrid img').first();
    if (!(await firstImg.isVisible({ timeout: 5000 }).catch(() => false))) {
      await this.page.screenshot({ path: '/tmp/medium-unsplash-noresults.png' }).catch(() => {});
      throw new Error('No Unsplash search results found');
    }
    const box = await firstImg.boundingBox();
    if (!box) throw new Error('Could not get bounding box of first Unsplash result');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Move mouse to image center to trigger hover state, then click
    await this.page.mouse.move(cx, cy);
    await this.page.waitForTimeout(400);
    await this.page.mouse.click(cx, cy);

    await this.page.waitForFunction(
      () => document.querySelector('[data-testid="editorImageParagraph"], figure img, .graf--figure img') !== null,
      { timeout: 10000 }
    ).catch(() => console.error('⚠️  Could not confirm Unsplash image was inserted'));

    await this.page.waitForTimeout(500);
    console.error('✅ Unsplash image inserted');
  }

  async deleteDraft(postId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.ensureLoggedIn();
    try {
      // Safety check: verify this is actually a draft (edit URL must be accessible)
      // Published articles redirect away from /edit — drafts stay on the edit page
      const response = await this.page.goto(`https://medium.com/p/${postId}/edit`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Wait for the editor to fully load (Cloudflare challenge can delay rendering)
      await this.page.waitForSelector(
        '[data-testid="editorTitleParagraph"], [data-testid="editorParagraphText"], button[data-action="show-post-actions-popover"], button.js-moreActionsButton',
        { timeout: 45000 }
      );
      await this.page.waitForTimeout(500);
      const finalUrl = this.page.url();
      const isDraft = finalUrl.includes('/edit');
      if (!isDraft) {
        return { success: false, error: `Post ${postId} is not a draft (redirected to ${finalUrl}). Only drafts can be deleted.` };
      }

      // Step 1: Open the ··· menu via data-action attribute
      const moreBtn = this.page.locator('button[data-action="show-post-actions-popover"], button.js-moreActionsButton').first();
      await moreBtn.waitFor({ state: 'visible', timeout: 30000 });
      await moreBtn.click();
      await this.page.waitForTimeout(800);

      // Step 2: Click "More settings" link in the popover → navigates to /settings page
      const settingsLink = this.page.locator('a[href*="/settings"]').first();
      if (!(await settingsLink.isVisible({ timeout: 3000 }).catch(() => false))) {
        await this.page.screenshot({ path: `/tmp/medium-delete-${postId}.png` }).catch(() => {});
        return { success: false, error: 'Could not find "More settings" link in popover' };
      }
      await settingsLink.click();
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(1000);

      // Step 3: Click "Delete story" button on the settings page
      const deleteBtn = this.page.locator('button[data-testid="deleteStoryButton"], button').filter({ hasText: /^Delete story$/ }).first();
      if (!(await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
        await this.page.screenshot({ path: `/tmp/medium-delete-${postId}.png` }).catch(() => {});
        return { success: false, error: 'Could not find "Delete story" button on settings page' };
      }
      await deleteBtn.click();
      await this.page.waitForTimeout(500);

      // Step 4: Confirm in the modal dialog
      const confirmBtn = this.page.locator('[data-testid="deleteStoryModalConfirmButton"]').first();
      if (!(await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
        await this.page.screenshot({ path: `/tmp/medium-delete-${postId}.png` }).catch(() => {});
        return { success: false, error: 'Delete confirmation dialog did not appear' };
      }
      await confirmBtn.click();

      await this.page.waitForTimeout(1000);
      console.error(`✅ Deleted draft: ${postId}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async publishArticle(options: PublishOptions): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!this.page) throw new Error('Browser not initialized');

    await this.ensureLoggedIn();

    const hasCoverImage = !!(options.coverImageQuery || options.coverImageFile || options.coverImageYoutubeUrl);

    try {
      if (options.postId) {
        if (hasCoverImage) {
          // Open the draft editor to insert the cover image, then navigate to submission
          await this.page.goto(`https://medium.com/p/${options.postId}/edit`, { waitUntil: 'domcontentloaded', timeout: 45000 });
          // Wait for editor — accept title paragraph or any content block
          await this.page.waitForSelector(
            '[data-testid="editorTitleParagraph"], [data-testid="editorParagraphText"], [data-testid="editorHeadingText"]',
            { timeout: 90000 }
          );
          try {
            await this.insertCoverImage(options);
          } catch (err) {
            console.error('⚠️  Cover image insertion failed (continuing):', err);
          }
          await this.page.waitForTimeout(2000);
          if (options.isDraft) {
            return { success: true, url: this.page.url() };
          }
          await this.page.goto(`https://medium.com/p/${options.postId}/submission`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } else {
          // Fast-path: straight to submission page, no editor needed
          await this.page.goto(`https://medium.com/p/${options.postId}/submission`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        await this.page.waitForSelector('button:has-text("Publish"), input[placeholder*="tag"]', { timeout: 20000 });
        // fall through to tag + publish logic below
      } else {
      // Navigate to the new story page
      await this.page.goto('https://medium.com/new-story', { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait for the editor to load (CF challenge can take up to 30s)
      await this.page.waitForSelector('[data-testid="editorTitleParagraph"]', { timeout: 45000 });

      // Add title via clipboard
      await this.page.click('[data-testid="editorTitleParagraph"]');
      await this.page.evaluate((text) => navigator.clipboard.writeText(text), options.title);
      await this.page.keyboard.press('Meta+v');
      await this.page.waitForTimeout(300);

      // Convert content to Medium HTML and paste as text/html so the editor
      // picks up code blocks, headings, and horizontal rules with proper structure.
      await this.page.click('[data-testid="editorParagraphText"]');
      const html = this.toMediumHtml(options.content);
      await this.page.evaluate(async (htmlContent) => {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const item = new ClipboardItem({ 'text/html': blob });
        await navigator.clipboard.write([item]);
      }, html);
      await this.page.keyboard.press('Meta+v');

      // Wait until the editor has actually processed the paste — poll until
      // more than one content block exists, or fall back after 15 seconds.
      await this.page.waitForFunction(
        () => document.querySelectorAll('[data-testid="editorParagraphText"], [data-testid="editorCodeBlockParagraph"], [data-testid="editorHeadingText"]').length > 1,
        { timeout: 15000 }
      ).catch(() => {/* proceed even if only one block rendered */});

      // Extra settle time so Medium's autosave fires and the URL updates
      await this.page.waitForTimeout(3000);

      // Insert cover image at the top (Unsplash / local file / YouTube)
      if (hasCoverImage) {
        try {
          await this.insertCoverImage(options);
        } catch (err) {
          console.error('⚠️  Cover image insertion failed (continuing):', err);
        }
      }

      if (options.isDraft) {
        // Medium auto-saves drafts. The URL changes from /new-story to the
        // draft edit URL once the first autosave completes.
        await this.page.waitForFunction(
          () => !window.location.href.includes('/new-story'),
          { timeout: 10000 }
        ).catch(() => {/* return whatever URL we have */});
        const currentUrl = this.page.url();
        return { success: true, url: currentUrl };
      }

      // Click the Publish button — navigates to a /submission page
      const publishButton = this.page.locator('button:has-text("Publish")').first();
      if (!await publishButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        return { success: false, error: 'Could not find publish button' };
      }
      await publishButton.click();

      // Clicking "Publish" navigates to a /submission page — wait for it
      await this.page.waitForLoadState('domcontentloaded', { timeout: 20000 });
      await this.page.waitForSelector(
        'button:has-text("Publish"), [data-testid="tag-input"], input[placeholder*="tag"], input[placeholder*="Add a tag"]',
        { timeout: 10000 }
      ).catch(() => {});
      } // end else (new story path)

      // Add tags if provided
      if (options.tags && options.tags.length > 0) {
        const tagInput = this.page.locator(
          '[data-testid="tag-input"], input[placeholder*="tag"], input[placeholder*="Add a tag"]'
        ).first();
        if (await tagInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          for (const tag of options.tags) {
            await tagInput.fill(tag);
            await this.page.keyboard.press('Enter');
            await this.page.waitForTimeout(300);
          }
        }
      }

      // The final CTA on the submission page is "Publish"
      const finalPublishButton = this.page.locator('button:has-text("Publish")').first();
      if (!await finalPublishButton.isVisible({ timeout: 8000 }).catch(() => false)) {
        const btns = await this.page.evaluate(() =>
          Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean)
        );
        return { success: false, error: `Could not find Publish button. Visible: ${btns.join(', ')}` };
      }
      await finalPublishButton.click();
      await this.page.waitForLoadState('domcontentloaded', { timeout: 20000 });

      const currentUrl = this.page.url();
      return { success: true, url: currentUrl };

    } catch (error) {
      return { success: false, error: `Publishing failed: ${error}` };
    }
  }

  async searchMediumArticles(keywords: string[]): Promise<MediumArticle[]> {
    if (!this.page) throw new Error('Browser not initialized');
    
    const searchQuery = keywords.join(' ');
    console.error(`🔍 Searching Medium for: "${searchQuery}"`);
    
    // Try to use saved session if available (but don't force login for search)
    if (existsSync(this.sessionPath)) {
      console.error('💾 Using saved session for search...');
    }
    
    await this.page.goto(`https://medium.com/search?q=${encodeURIComponent(searchQuery)}`);
    await this.page.waitForLoadState('networkidle');
    
    // Wait a bit more for dynamic content to load
    await this.page.waitForTimeout(2000);

    console.error('📄 Current page URL:', this.page.url());

    const articles = await this.page.evaluate((searchQuery) => {
      // Remove console.log from browser context to avoid JSON interference
      const log = (...args: any[]) => {
        // Silent in browser context
      };
      
      log('🔎 Starting search extraction for:', searchQuery);
      
      // Try multiple selectors for different Medium layouts
      const possibleSelectors = [
        // Modern Medium selectors
        'article',
        '[data-testid="story-preview"]',
        '[data-testid="story-card"]',
        '.js-postListItem',
        '.postArticle',
        '.streamItem',
        '.js-streamItem',
        // Fallback selectors
        'div[role="article"]',
        '.story-preview',
        '.post-preview'
      ];

      const articles: any[] = [];
      let elementsFound = 0;

      for (const selector of possibleSelectors) {
        const elements = document.querySelectorAll(selector);
        log(`🎯 Selector "${selector}" found ${elements.length} elements`);
        
        if (elements.length > 0) {
          elementsFound += elements.length;
          
          elements.forEach((element, index) => {
            try {
              // Try multiple title selectors
              const titleSelectors = [
                'h1', 'h2', 'h3', 'h4',
                '[data-testid="story-title"]',
                '.graf--title',
                '.story-title',
                '.post-title',
                'a[data-action="show-post"]'
              ];

              let titleElement = null;
              let titleText = '';

              for (const titleSel of titleSelectors) {
                titleElement = element.querySelector(titleSel);
                if (titleElement && titleElement.textContent?.trim()) {
                  titleText = titleElement.textContent.trim();
                  break;
                }
              }

              // Try multiple approaches to find the actual article URL
              let linkUrl = '';
              
              // Strategy 1: Look for data-href attribute (most reliable for articles)
              const dataHrefElement = element.querySelector('[data-href]');
              if (dataHrefElement) {
                const dataHref = dataHrefElement.getAttribute('data-href');
                if (dataHref && dataHref.includes('medium.com') && dataHref.includes('-')) {
                  linkUrl = dataHref;
                }
              }
              
              // Strategy 2: Look for direct article links if data-href didn't work
              if (!linkUrl) {
                const linkSelectors = [
                  'a[href*="medium.com"][href*="-"]', // Article URLs usually have dashes
                  'a[href*="/@"][href*="-"]',         // Author articles with dashes
                  'a[href*="medium.com"]',
                  'a[href*="/"]',
                  'a'
                ];

                                  for (const linkSel of linkSelectors) {
                    const linkElement = element.querySelector(linkSel);
                    if (linkElement && (linkElement as HTMLAnchorElement).href) {
                      let href = (linkElement as HTMLAnchorElement).href;
                      
                      // Clean up and validate the URL
                      if (href) {
                        // If it's a redirect URL, extract the actual article URL
                        if (href.includes('redirect=')) {
                          const redirectMatch = href.match(/redirect=([^&]+)/);
                          if (redirectMatch) {
                            href = decodeURIComponent(redirectMatch[1]);
                          }
                        }
                        
                        // Check if it's a valid article URL (prioritize actual articles)
                        const isValidArticleUrl = (
                          href.includes('medium.com') && 
                          !href.includes('/search?') &&  // Don't include search pages themselves
                          !href.includes('/signin') &&
                          !href.includes('/bookmark') &&
                          !href.includes('/signup') &&
                          // Prioritize URLs that look like actual articles
                          (href.includes('-') ||  // Article slugs usually have dashes
                           href.includes('/@') || 
                           href.match(/\/[a-f0-9]{8,}/))  // Article IDs (8+ chars)
                        );
                        
                        if (isValidArticleUrl) {
                          // Clean the URL but preserve the path
                          if (href.includes('?')) {
                            // Extract the actual article URL from redirect parameters
                            if (href.includes('redirect=')) {
                              const redirectMatch = href.match(/redirect=([^&]+)/);
                              if (redirectMatch) {
                                linkUrl = decodeURIComponent(redirectMatch[1]);
                              }
                            } else {
                              // Just remove query parameters for cleaner URLs
                              linkUrl = href.split('?')[0];
                            }
                          } else {
                            linkUrl = href;
                          }
                          break;
                        }
                      }
                    }
                  }
                }

              // Try to get author info
              const authorSelectors = [
                '[data-testid="story-author"]',
                '.postMetaInline-authorLockup',
                '.story-author',
                '.author-name'
              ];

              let authorText = '';
              for (const authorSel of authorSelectors) {
                const authorElement = element.querySelector(authorSel);
                if (authorElement && authorElement.textContent?.trim()) {
                  authorText = authorElement.textContent.trim();
                  break;
                }
              }

              // Try to get snippet/preview
              const snippetSelectors = [
                '.story-excerpt',
                '.post-excerpt',
                '.graf--p',
                'p'
              ];

              let snippetText = '';
              for (const snippetSel of snippetSelectors) {
                const snippetElement = element.querySelector(snippetSel);
                if (snippetElement && snippetElement.textContent?.trim()) {
                  snippetText = snippetElement.textContent.trim().substring(0, 200);
                  break;
                }
              }

              log(`📝 Article ${index + 1}:`, {
                title: titleText,
                url: linkUrl,
                author: authorText,
                snippet: snippetText.substring(0, 50) + '...'
              });

              if (titleText && linkUrl) {
                articles.push({
                  title: titleText,
                  content: snippetText,
                  url: linkUrl,
                  publishDate: '',
                  tags: [],
                  claps: 0
                });
              }
            } catch (error) {
              log('❌ Error extracting article:', error);
            }
          });

          // If we found articles with this selector, we can break
          if (articles.length > 0) {
            log(`✅ Successfully extracted ${articles.length} articles using selector: ${selector}`);
            break;
          }
        }
      }

      log(`📊 Total elements found: ${elementsFound}, Articles extracted: ${articles.length}`);
      
      // If no articles found, let's debug what's on the page
      if (articles.length === 0) {
        log('🔍 Debug: Page structure analysis');
        log('Page title:', document.title);
        log('Page text content preview:', document.body.textContent?.substring(0, 500));
        
        // Look for any text that might indicate search results
        const searchResultIndicators = [
          'No stories found',
          'No results',
          'Try different keywords',
          'stories found',
          'results for'
        ];
        
        const pageText = document.body.textContent?.toLowerCase() || '';
        for (const indicator of searchResultIndicators) {
          if (pageText.includes(indicator.toLowerCase())) {
            log(`📍 Found indicator: "${indicator}"`);
          }
        }
      }

      return articles;
    }, searchQuery);

    console.error(`🎉 Search completed. Found ${articles.length} articles`);
    return articles;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
} 
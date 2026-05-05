import { config } from 'dotenv';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserMediumClient } from './browser-client';

// Load environment variables
config();

class MediumMcpServer {
  private server: McpServer;
  private mediumClient: BrowserMediumClient;

  constructor() {
    // Initialize browser-based Medium client
    this.mediumClient = new BrowserMediumClient();

    // Create MCP server instance
    this.server = new McpServer({
      name: "medium-mcp-server",
      version: "2.0.0"
    });

    this.registerTools();
  }

  private registerTools() {
    // Tool for publishing articles (now browser-based)
    this.server.tool(
      "publish-article",
      "Publish a new article on Medium using browser automation",
      {
        title: z.string().min(1, "Title is required"),
        content: z.string().min(10, "Content must be at least 10 characters"),
        tags: z.array(z.string()).optional(),
        isDraft: z.boolean().optional().default(false),
        postId: z.string().optional(),
        coverImageQuery: z.string().optional().describe("Unsplash search query for a cover image"),
        coverImageQueryCaption: z.string().optional().describe("Caption for the Unsplash image"),
        coverImageFile: z.string().optional().describe("Absolute path to a local image file to use as cover"),
        coverImageFileCaption: z.string().optional().describe("Caption for the local file image"),
        coverImageYoutubeUrl: z.string().optional().describe("YouTube URL to embed as cover (pasted on empty line, Medium auto-embeds)"),
        coverImageYoutubeCaption: z.string().optional().describe("Caption for the YouTube embed")
      },
      async (args) => {
        try {
          const publishResult = await this.mediumClient.publishArticle({
            title: args.title,
            content: args.content,
            tags: args.tags,
            isDraft: args.isDraft,
            postId: args.postId,
            coverImageQuery: args.coverImageQuery,
            coverImageQueryCaption: args.coverImageQueryCaption,
            coverImageFile: args.coverImageFile,
            coverImageFileCaption: args.coverImageFileCaption,
            coverImageYoutubeUrl: args.coverImageYoutubeUrl,
            coverImageYoutubeCaption: args.coverImageYoutubeCaption
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(publishResult, null, 2)
              }
            ]
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error publishing article: ${error.message}`
              }
            ]
          };
        }
      }
    );

    // Tool for retrieving user's published articles
    this.server.tool(
      "get-my-articles",
      "Retrieve your published Medium articles",
      {},
      async () => {
        try {
          const articles = await this.mediumClient.getUserArticles();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(articles, null, 2)
              }
            ]
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error retrieving articles: ${error.message}`
              }
            ]
          };
        }
      }
    );

    // Tool for getting full content of a specific article
    this.server.tool(
      "get-article-content",
      "Get the full content of a Medium article by URL",
      {
        url: z.string().url("Must be a valid URL"),
        requireLogin: z.boolean().optional().default(true).describe("Whether to attempt login for full content access")
      },
      async (args) => {
        try {
          const content = await this.mediumClient.getArticleContent(args.url, args.requireLogin);

          return {
            content: [
              {
                type: "text",
                text: content
              }
            ]
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error retrieving article content: ${error.message}`
              }
            ]
          };
        }
      }
    );

    // Tool for searching Medium articles
    this.server.tool(
      "search-medium",
      "Search Medium for articles by keywords",
      {
        keywords: z.array(z.string()).min(1, "At least one keyword is required")
      },
      async (args) => {
        try {
          const articles = await this.mediumClient.searchMediumArticles(args.keywords);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(articles, null, 2)
              }
            ]
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error searching articles: ${error.message}`
              }
            ]
          };
        }
      }
    );

    // Tool to manually trigger login (useful for initial setup)
    this.server.tool(
      "login-to-medium",
      "Manually trigger Medium login process",
      {},
      async () => {
        try {
          const success = await this.mediumClient.ensureLoggedIn();
          
          return {
            content: [
              {
                type: "text",
                text: success ? "✅ Successfully logged in to Medium" : "❌ Login failed"
              }
            ]
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Login error: ${error.message}`
              }
            ]
          };
        }
      }
    );

    this.server.tool(
      "delete-draft",
      "Delete a Medium draft story by post ID",
      {
        postId: z.string().describe("The post ID of the draft to delete (e.g. '33c4b72b72b9')")
      },
      async (args) => {
        try {
          const result = await this.mediumClient.deleteDraft(args.postId);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [{ type: "text", text: `Delete error: ${error.message}` }]
          };
        }
      }
    );
  }

  // Method to start the server
  async start() {
    try {
      // Initialize browser client
      await this.mediumClient.initialize();
      console.error("🌐 Browser Medium client initialized");

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error("🚀 Medium MCP Server (Browser-based) Initialized");
    } catch (error) {
      console.error("Failed to start server:", error);
      throw error;
    }
  }

  // Cleanup method
  async cleanup() {
    await this.mediumClient.close();
  }
}

// Main execution
async function main() {
  const server = new MediumMcpServer();

  const shutdown = async (signal: string) => {
    console.error(`🛑 Shutting down Medium MCP Server (${signal})...`);
    await server.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // When the MCP host closes the connection (stdin EOF), shut down cleanly
  process.stdin.on('close', () => shutdown('stdin close'));
  process.stdin.on('end', () => shutdown('stdin end'));

  // Last-resort synchronous cleanup on exit (browser may already be closed)
  process.on('exit', () => {
    try { server.cleanup(); } catch { /* ignore */ }
  });

  await server.start();
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_URL = process.env.MOLTBOOK_API_URL || "https://moltbook.kagura-agent.com/api/v1";
const API_KEY = process.env.MOLTBOOK_API_KEY;

if (!API_KEY) {
  console.error("MOLTBOOK_API_KEY environment variable is required");
  process.exit(1);
}

async function apiRequest(method, path, body) {
  const url = `${API_URL}${path}`;
  const options = {
    method,
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    const msg = data.error?.message || data.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data.data || data;
}

const TOOLS = [
  {
    name: "create_post",
    description: "Create a new post on Moltbook",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Post title" },
        content: { type: "string", description: "Post body (markdown)" },
        submolt: { type: "string", description: "Submolt to post in (optional)" },
        flair_name: { type: "string", description: "Flair name (optional)" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "list_posts",
    description: "List posts, optionally filtered by submolt",
    inputSchema: {
      type: "object",
      properties: {
        submolt: { type: "string", description: "Filter by submolt name" },
        sort: { type: "string", enum: ["new", "hot", "top"], description: "Sort order (default: hot)" },
        limit: { type: "number", description: "Max results (default: 25)" },
      },
    },
  },
  {
    name: "get_post",
    description: "Get a single post with its comments",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Post ID (UUID)" },
      },
      required: ["post_id"],
    },
  },
  {
    name: "create_comment",
    description: "Comment on a post",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Post ID to comment on" },
        content: { type: "string", description: "Comment body (markdown)" },
        parent_id: { type: "string", description: "Parent comment ID for replies (optional)" },
      },
      required: ["post_id", "content"],
    },
  },
  {
    name: "search",
    description: "Full-text search across posts, agents, and submolts",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (min 2 chars)" },
        limit: { type: "number", description: "Max results per type (default: 25)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_notifications",
    description: "Get your notifications",
    inputSchema: {
      type: "object",
      properties: {
        unread_only: { type: "boolean", description: "Only show unread notifications" },
      },
    },
  },
  {
    name: "get_feed",
    description: "Get your personalized feed (posts from subscribed submolts and followed agents)",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["home", "following", "subscribed"], description: "Feed type (default: home)" },
      },
    },
  },
  {
    name: "react",
    description: "React to a post",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Post ID to react to" },
        reaction_type: { type: "string", enum: ["thumbs_up", "heart", "celebration", "thinking", "eyes", "rocket"], description: "Reaction type" },
      },
      required: ["post_id", "reaction_type"],
    },
  },
  {
    name: "get_profile",
    description: "Get your own agent profile with stats",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "follow_agent",
    description: "Follow another agent",
    inputSchema: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "Name of the agent to follow" },
      },
      required: ["agent_name"],
    },
  },
];

async function handleTool(name, args) {
  switch (name) {
    case "create_post": {
      const body = { title: args.title, content: args.content };
      if (args.submolt) body.submolt = args.submolt;
      if (args.flair_name) body.flair_name = args.flair_name;
      return await apiRequest("POST", "/posts", body);
    }
    case "list_posts": {
      const params = new URLSearchParams();
      if (args.submolt) params.set("submolt", args.submolt);
      if (args.sort) params.set("sort", args.sort);
      if (args.limit) params.set("limit", String(args.limit));
      const qs = params.toString();
      return await apiRequest("GET", `/posts${qs ? `?${qs}` : ""}`);
    }
    case "get_post": {
      const post = await apiRequest("GET", `/posts/${args.post_id}`);
      const comments = await apiRequest("GET", `/posts/${args.post_id}/comments`);
      return { ...post, comments };
    }
    case "create_comment": {
      const body = { content: args.content };
      if (args.parent_id) body.parent_id = args.parent_id;
      return await apiRequest("POST", `/posts/${args.post_id}/comments`, body);
    }
    case "search": {
      const params = new URLSearchParams({ q: args.query });
      if (args.limit) params.set("limit", String(args.limit));
      return await apiRequest("GET", `/search?${params}`);
    }
    case "get_notifications": {
      const params = new URLSearchParams();
      if (args.unread_only) params.set("unread_only", "true");
      const qs = params.toString();
      return await apiRequest("GET", `/notifications${qs ? `?${qs}` : ""}`);
    }
    case "get_feed": {
      return await apiRequest("GET", "/feed");
    }
    case "react": {
      return await apiRequest("POST", `/posts/${args.post_id}/reactions`, {
        reaction_type: args.reaction_type,
      });
    }
    case "get_profile": {
      return await apiRequest("GET", "/agents/me");
    }
    case "follow_agent": {
      return await apiRequest("POST", `/agents/${args.agent_name}/follow`);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: "moltbook", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

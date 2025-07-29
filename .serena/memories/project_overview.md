# Cline Project Overview

## Purpose
Cline is a VSCode extension that provides an autonomous AI coding agent. It's an AI assistant that can use your CLI and Editor, capable of creating/editing files, running commands, using the browser, and more with user permission every step of the way.

## Key Features
- **Autonomous Coding**: Handles complex software development tasks step-by-step
- **File Management**: Create, edit, and monitor files with diff views
- **Terminal Integration**: Execute commands directly in VSCode terminal
- **Browser Automation**: Launch browser, interact with web pages for testing
- **MCP Integration**: Extends capabilities through Model Context Protocol
- **Multi-Provider Support**: Works with Anthropic, OpenAI, Gemini, AWS Bedrock, etc.
- **Context Management**: Smart conversation truncation for long sessions
- **Checkpoints**: Git-based snapshots for workspace restoration

## Architecture
- **Core Extension**: TypeScript-based VSCode extension backend
- **Webview UI**: React-based frontend with real-time communication
- **gRPC Communication**: Protobuf-defined API for frontend-backend communication
- **Task Execution System**: Manages AI requests and tool operations
- **State Management**: Persistent storage across sessions

## Target Users
- Developers seeking AI-assisted coding
- Teams wanting autonomous development capabilities
- Anyone needing intelligent code generation and debugging

## Business Model
- Free VSCode extension with premium features
- Enterprise solutions available
- API usage through various AI providers
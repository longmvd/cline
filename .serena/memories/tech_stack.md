# Cline Technology Stack

## Core Technologies
- **TypeScript**: Primary development language with strict type checking
- **Node.js**: Runtime environment (ES2022 target)
- **VSCode Extension API**: Core platform integration
- **gRPC/Protobuf**: Type-safe communication between extension and webview

## Backend (Extension)
- **esbuild**: Fast bundling and compilation
- **@grpc/grpc-js**: gRPC server implementation
- **@bufbuild/protobuf**: Protocol buffer support
- **simple-git**: Git operations for checkpoints
- **puppeteer-core**: Browser automation
- **chokidar**: File system watching

## Frontend (Webview UI)
- **React 18**: UI framework with hooks
- **Vite**: Build tool and dev server
- **TailwindCSS**: Utility-first CSS framework
- **@heroui/react**: UI component library
- **styled-components**: CSS-in-JS styling
- **framer-motion**: Animation library
- **react-virtuoso**: Virtual scrolling for performance

## AI/ML Integrations
- **@anthropic-ai/sdk**: Claude API integration
- **openai**: OpenAI API support
- **@google/genai**: Google Gemini integration
- **@aws-sdk/client-bedrock-runtime**: AWS Bedrock support
- **@mistralai/mistralai**: Mistral AI integration
- **ollama**: Local model support

## Development Tools
- **ESLint**: Code linting with TypeScript rules
- **Prettier**: Code formatting (tabs, 130 char width)
- **Mocha + Chai**: Testing framework
- **Playwright**: E2E testing
- **Vitest**: Frontend unit testing
- **Husky**: Git hooks for quality checks
- **Changesets**: Version management and release automation

## Build & Deployment
- **esbuild**: Production bundling
- **vsce**: VSCode extension packaging
- **GitHub Actions**: CI/CD pipeline
- **VS Marketplace**: Extension distribution
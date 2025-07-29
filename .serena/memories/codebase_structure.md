# Cline Codebase Structure

## Root Directory
```
cline/
├── src/                    # Extension backend code
├── webview-ui/            # React frontend code
├── proto/                 # gRPC/Protobuf definitions
├── docs/                  # Documentation website
├── scripts/               # Build and utility scripts
├── .clinerules/          # Development guidelines
├── assets/               # Icons and media
├── locales/              # Internationalization
└── build/                # Build artifacts
```

## Backend Structure (/src)
```
src/
├── extension.ts          # VSCode extension entry point
├── config.ts            # Configuration constants
├── api/                 # AI provider integrations
│   └── providers/       # Anthropic, OpenAI, etc.
├── core/                # Core extension logic
│   ├── controller/      # Main orchestrator
│   ├── webview/         # Webview management
│   ├── task/           # Task execution system
│   └── context/        # Context management
├── services/           # Shared services
│   ├── mcp/           # Model Context Protocol
│   └── code-tracker/ # Code statistics
├── integrations/      # External tool integrations
├── shared/           # Shared types and utilities
├── utils/            # Utility functions
└── test/             # Test files
```

## Frontend Structure (/webview-ui)
```
webview-ui/
├── src/
│   ├── App.tsx              # Main React application
│   ├── context/             # React context providers
│   │   └── ExtensionStateContext.tsx
│   ├── components/          # React components
│   │   ├── chat/           # Chat interface
│   │   ├── settings/       # Settings panels
│   │   ├── history/        # Task history
│   │   └── common/         # Shared components
│   ├── services/           # gRPC client services
│   └── utils/              # Frontend utilities
├── index.html              # Entry HTML
├── package.json           # Frontend dependencies
└── vite.config.ts         # Vite build configuration
```

## Protobuf Structure (/proto)
```
proto/
├── cline/              # Core Cline services
│   ├── common.proto    # Shared types
│   ├── state.proto     # State management
│   ├── ui.proto        # UI interactions
│   ├── task.proto      # Task execution
│   ├── mcp.proto       # MCP integration
│   └── models.proto    # AI model configs
└── host/               # Host system services
    ├── workspace.proto # File system operations
    └── env.proto       # Environment info
```

## Key Architecture Patterns

### Extension Backend
- **WebviewProvider**: Manages webview lifecycle
- **Controller**: Central state orchestrator
- **Task**: Executes AI requests and tools
- **StateManager**: Persistent storage

### Frontend (React)
- **App.tsx**: Main application shell
- **ExtensionStateContext**: Global state management
- **gRPC Clients**: Type-safe backend communication
- **Component Hierarchy**: Modular UI components

### Communication Flow
1. User input in React UI
2. gRPC call to extension backend
3. Controller processes request
4. Task executes AI/tool operations
5. Real-time updates streamed back to UI

### Data Flow
- **State**: Controller manages all persistent state
- **Messages**: gRPC streaming for real-time updates
- **Files**: Direct VSCode API integration
- **Tools**: Abstracted through tool execution system
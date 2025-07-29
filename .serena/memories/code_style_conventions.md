# Cline Code Style & Conventions

## TypeScript Configuration
- **Target**: ES2022 with strict type checking
- **Module System**: ESNext with Bundler resolution
- **Path Mapping**: Extensive use of @ aliases (e.g., @core/, @api/, @shared/)
- **Strict Mode**: All strict TypeScript options enabled
- **Source Maps**: Enabled for debugging

## Code Formatting (Prettier)
- **Indentation**: Tabs (not spaces)
- **Tab Width**: 4 characters
- **Line Length**: 130 characters maximum
- **Semicolons**: Disabled (no semicolons)
- **Brackets**: Same line for JSX
- **Line Endings**: LF (Unix-style)

## ESLint Rules
- **Naming Convention**: camelCase for imports, PascalCase for types
- **Curly Braces**: Required for all control statements
- **Equality**: Strict equality (===) required
- **No Throw Literals**: Use Error objects only
- **Custom Rules**: No direct VSCode API usage (use abstractions)
- **Process.env**: Direct access required (no destructuring)

## File Organization
- **Extension Code**: `/src` directory with modular structure
- **Webview Code**: `/webview-ui/src` with React components
- **Protobuf Definitions**: `/proto` with service definitions
- **Tests**: Co-located with source files
- **Scripts**: `/scripts` for build automation

## Naming Conventions
- **Files**: kebab-case for file names
- **Classes**: PascalCase
- **Functions**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Interfaces**: PascalCase (no 'I' prefix)
- **Types**: PascalCase

## Import/Export Patterns
- **Absolute Imports**: Use path aliases (@core/, @api/, etc.)
- **Index Files**: Export collections from index.ts
- **Type Imports**: Use `import type` for type-only imports
- **Default Exports**: Avoid for better tree-shaking

## Error Handling
- **Async Functions**: Always handle Promise rejections
- **Try-Catch**: Wrap external API calls
- **Error Types**: Use custom error classes
- **Logging**: Console errors with context

## React Conventions (Webview)
- **Hooks**: Prefer functional components with hooks
- **State Management**: React Context for global state
- **Event Handlers**: Use callback pattern
- **Props**: Define explicit interfaces
- **Styling**: Styled-components + TailwindCSS utility classes
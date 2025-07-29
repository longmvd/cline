# Cline Development Commands

## Installation & Setup
```bash
# Install all dependencies (extension + webview)
npm run install:all

# Install extension dependencies only
npm install

# Install webview dependencies only
cd webview-ui && npm install
```

## Development
```bash
# Start development (opens new VSCode window with extension)
# Use F5 in VSCode or Run -> Start Debugging

# Watch mode for extension (auto-rebuild)
npm run watch

# Watch mode for webview (Vite dev server)
npm run dev:webview

# Check TypeScript types
npm run check-types
```

## Building
```bash
# Development build
npm run compile

# Production build (for packaging)
npm run package

# Build webview only
npm run build:webview

# Build standalone version
npm run compile-standalone
```

## Protobuf Development
```bash
# Generate TypeScript from .proto files
npm run protos

# Lint protobuf definitions
buf lint
```

## Code Quality
```bash
# Run all linting
npm run lint

# Format code
npm run format:fix

# Check formatting
npm run format
```

## Testing
```bash
# Run all tests
npm run test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e

# Run tests with coverage
npm run test:coverage

# Run webview tests
npm run test:webview

# CI test suite
npm run test:ci
```

## Release Management
```bash
# Create changeset (for versioning)
npm run changeset

# Version packages (processes changesets)
npm run version-packages

# Publish to marketplace
npm run publish:marketplace

# Prerelease publish
npm run publish:marketplace:prerelease
```

## Documentation
```bash
# Start docs development server
npm run docs

# Check documentation links
npm run docs:check-links
```

## Utilities
```bash
# Clean build artifacts
npm run clean

# Report issues (automated bug reporting)
npm run report-issue

# Package extension for testing
vsce package
```

## Windows-Specific Commands
```cmd
# Use cmd.exe or PowerShell
dir          # List directory contents
type file    # View file contents
copy         # Copy files
findstr      # Search in files
```

## Git Operations
```bash
git status
git add .
git commit -m "message"
git push
git pull
```
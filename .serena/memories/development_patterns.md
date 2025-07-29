# Cline Development Patterns & Guidelines

## Architecture Patterns

### Extension Backend Patterns
- **Single Responsibility**: Each class has one clear purpose
- **Dependency Injection**: Pass dependencies through constructors
- **Event-Driven**: Use gRPC streaming for real-time updates
- **State Management**: Controller as single source of truth
- **Error Boundaries**: Graceful error handling at service boundaries

### Frontend (React) Patterns
- **Context Pattern**: Global state through React Context
- **Custom Hooks**: Encapsulate stateful logic
- **Component Composition**: Build complex UIs from simple components
- **Controlled Components**: Form inputs controlled by React state
- **Streaming Updates**: Real-time UI updates via gRPC streams

### Communication Patterns
- **gRPC Streaming**: Bidirectional real-time communication
- **Protobuf First**: Define APIs in .proto files
- **Type Safety**: Generated TypeScript from protobuf
- **Request/Response**: Unary calls for simple operations
- **Publish/Subscribe**: Streaming for ongoing updates

## Design Principles

### Code Organization
- **Feature-Based**: Group related functionality together
- **Layered Architecture**: Clear separation of concerns
- **Interface Segregation**: Small, focused interfaces
- **Dependency Inversion**: Depend on abstractions, not concretions

### Error Handling
- **Fail Fast**: Validate inputs early
- **Graceful Degradation**: Continue operation when possible
- **User Feedback**: Clear error messages to users
- **Logging**: Comprehensive error logging for debugging

### Performance
- **Lazy Loading**: Load components/data when needed
- **Virtual Scrolling**: Handle large lists efficiently
- **Streaming**: Process data incrementally
- **Caching**: Cache expensive operations

## Specific Guidelines

### Protobuf Development
- Define services in domain-specific .proto files
- Use shared types in common.proto
- Follow naming conventions (camelCase RPCs, PascalCase messages)
- Version your APIs carefully

### State Management
- Controller owns all persistent state
- React Context for UI state
- Immutable state updates
- Serialize state for persistence

### Testing Strategy
- Unit tests for business logic
- Integration tests for API endpoints
- E2E tests for user workflows
- Mock external dependencies

### Security Considerations
- Validate all user inputs
- Sanitize data before display
- Secure API key storage
- Principle of least privilege

## Common Anti-Patterns to Avoid

### Backend
- ❌ Direct VSCode API usage (use abstractions)
- ❌ Synchronous file operations
- ❌ Global state mutations
- ❌ Circular dependencies
- ❌ Catching and ignoring errors

### Frontend
- ❌ Direct state mutations
- ❌ Prop drilling
- ❌ Missing error boundaries
- ❌ Inline styles (use styled-components/Tailwind)
- ❌ Uncontrolled components

### General
- ❌ Hard-coded values
- ❌ Magic numbers/strings
- ❌ Overly complex functions
- ❌ Inconsistent naming
- ❌ Missing type annotations
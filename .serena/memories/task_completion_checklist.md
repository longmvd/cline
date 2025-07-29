# Task Completion Checklist

When completing any development task in the Cline project, follow this checklist to ensure quality and consistency:

## Before Starting
- [ ] Create GitHub issue for features (unless small bug fix/typo)
- [ ] Wait for maintainer approval on feature requests
- [ ] Check existing issues to avoid duplicates
- [ ] Review `.clinerules/` for project-specific guidelines

## During Development
- [ ] Follow TypeScript strict mode requirements
- [ ] Use path aliases (@core/, @api/, @shared/, etc.)
- [ ] Maintain consistent code style (tabs, 130 char limit)
- [ ] Add proper error handling and logging
- [ ] Update protobuf definitions if needed (`npm run protos`)
- [ ] Write/update tests for new functionality

## Code Quality Checks
- [ ] Run type checking: `npm run check-types`
- [ ] Run linting: `npm run lint`
- [ ] Format code: `npm run format:fix`
- [ ] Verify no ESLint warnings/errors
- [ ] Check protobuf linting: `buf lint`

## Testing
- [ ] Run unit tests: `npm run test:unit`
- [ ] Run integration tests: `npm run test:integration`
- [ ] Test in development environment (F5 in VSCode)
- [ ] Verify webview functionality if UI changes
- [ ] Test on Windows environment
- [ ] Run full test suite: `npm run test`

## Version Management
- [ ] Create changeset: `npm run changeset`
- [ ] Choose appropriate version bump (major/minor/patch)
- [ ] Write clear changeset description
- [ ] Commit changeset file with changes

## Documentation
- [ ] Update relevant documentation in `/docs`
- [ ] Add JSDoc comments for new functions/classes
- [ ] Update README if adding new features
- [ ] Check for broken documentation links

## Pre-Submission
- [ ] Rebase on latest main branch
- [ ] Ensure clean commit history
- [ ] Remove any debugging code/console logs
- [ ] Verify build works: `npm run package`
- [ ] Test extension packaging works

## Pull Request
- [ ] Reference related GitHub issue
- [ ] Include clear description of changes
- [ ] Add screenshots for UI changes
- [ ] List any breaking changes
- [ ] Include testing instructions
- [ ] Wait for CI checks to pass
- [ ] Address code review feedback

## Special Considerations
- [ ] For protobuf changes: regenerate TypeScript with `npm run protos`
- [ ] For backend changes: test extension reload behavior
- [ ] For UI changes: test in both sidebar and tab modes
- [ ] For MCP changes: test server integration
- [ ] For API changes: verify backward compatibility

## Windows-Specific
- [ ] Test file path handling with backslashes
- [ ] Verify terminal command execution
- [ ] Check line ending handling (LF)
- [ ] Test with Windows-specific paths
# Git Commit Message Rules

## Format

```
Subject Line [Required]

- Detail Line 1 [Optional]
- Detail Line 2 [Optional]
- ...
```

**Important:** There MUST be a blank line between the subject and the detail lines.

## Rules

- Use imperative mood
- Present active tense
- Start with a capital letter
- Start with a verb (Add, Update, Remove, Fix, Refactor, etc)
- Does not include prefix [fix:, feat:, chore:, refactor:, etc]
- Rules apply to subject line and detail lines
- Does not require details, but if change is larger, include it
- Do not include emoji characters

## Examples

### Simple (No Details)

```
Update API POST endpoint to support dynamic paths and improve URL construction
```

```
Rename PlayerController to CharacterController for clarity and consistency
```

```
Remove unused assets and clean up project structure
```

### With Details

```
Enhance ColyseusManager and GameRoom for improved room management and connection handling

- Update ColyseusManager to utilize roomCode from Discord API or URL query parameters for dynamic room joining
- Modify GameRoom to store and log roomCode in metadata for better matchmaking and debugging
- Ensure fallback behavior for roomCode when not provided, enhancing user experience during connection attempts
```

```
Add UICanvas prefab and metadata for UI layout management

- Introduce UICanvas prefab to manage the user interface layout
```

```
Refactor PlayerController and CharacterCreatorUI to streamline character appearance updates

- Introduce UpdateColyseusCharacterAppearance method in PlayerController for better code organization
- Update CharacterCreatorUI to call the new method after saving character options, ensuring consistent state updates across the application
```

## Good Subject Line Verbs

- **Add** - Create a new feature, file, or capability
- **Update** - Modify existing functionality or content
- **Remove** - Delete code, files, or features
- **Fix** - Resolve a bug or issue
- **Refactor** - Restructure code without changing functionality
- **Enhance** - Improve existing functionality
- **Rename** - Change names for clarity
- **Move** - Relocate files or code
- **Extract** - Pull out code into separate components
- **Merge** - Combine branches or features
- **Improve** - Make something better
- **Optimize** - Improve performance
- **Document** - Add or update documentation

## Anti-Patterns (Don't Do This)

❌ **Using conventional commit prefixes:**
```
feat: add new feature
fix: resolve bug
```

❌ **Using emojis:**
```
✨ Add new feature
🐛 Fix bug
```

❌ **Past tense:**
```
Added new feature
Fixed bug
```

❌ **Not starting with a verb:**
```
New feature implementation
Bug in login system
```

❌ **Lowercase first letter:**
```
add new feature
fix bug
```

## Why These Rules?

1. **Imperative mood** - Matches Git's own convention (e.g., "Merge branch...")
2. **Verb-first** - Immediately tells you what the commit does
3. **No prefixes** - Cleaner, more readable commit history
4. **Optional details** - Allows for both quick commits and detailed explanations when needed
5. **Consistent capitalization** - Professional and easy to scan

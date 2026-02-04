# Joplin Typora-like Editor Plugin

A Joplin plugin that provides Markdown export functionality preferred by Typora users, with comprehensive metadata handling and resource management. My typical usage scenario is to work with Typora, mainly for daily note-taking and document writing. Leveraging its clean interface and efficient editing features, it enhances text processing and typesetting efficiency. Joplin is responsible for note organization, backup, and synchronization.

## Pain Points

This plugin aims to solve the following issues:

- **Typora Display Issue**: When using "Switch to External Editor" to edit notes in Typora, the note title annoyingly appears before the YAML frontmatter, causing display confusion in Typora. This is a poor design choice.

- **Limited Export Options**: The default Markdown export in Joplin doesn't allow choosing the export method - only hierarchical structure export is available.

- **Future Feature**: Developing a publish button for the editor toolbar that opens a `push-markdown` interface for publishing notes to WordPress blogs.

## Features

### ✨ Core Features

- **Smart YAML Frontmatter Handling**
  - Automatically generate or update note metadata (title, author, created time, updated time)
  - Preserve user-defined custom fields, only updating core field values
  - Fill in missing core metadata fields

- **Flexible Resource Management**
  - Automatically copy resource files to `assets` directory
  - Convert Joplin internal resource links (`:/resourceID`) to relative paths
  - Cross-platform path support

- **Two Export Modes**
  - **Flat Structure**: All files and resources in the same directory
  - **Hierarchical Structure**: Organized according to Joplin folder structure

- **Batch Export Support**
  - Export single or multiple notes
  - Option to merge all notes into one file or save separately

## Use Cases

### Scenario 1: Export Notes to Local Markdown Editor

Export Joplin notes as standard Markdown files for editing and viewing in Typora, VS Code, Obsidian, and other Markdown editors.

**Target Users**:
- Users who prefer local Markdown editors
- Users who need offline note editing
- Users who want to switch between different tools for note editing

### Scenario 2: Share Notes with Others

Exported Markdown files and resource files can be shared directly, allowing recipients to view complete note content and images without installing Joplin.

**Target Users**:
- Users collaborating with team members
- Users sharing technical documentation
- Users archiving notes

### Scenario 3: Backup Notes

Export Joplin notes as standard Markdown format as an additional backup solution to ensure data security.

**Target Users**:
- Users concerned about data security
- Users who need multiple backups
- Users who want note formats independent of Joplin

### Scenario 4: Maintain Folder Structure

Hierarchical export mode perfectly preserves the folder hierarchy in Joplin, suitable for users who need to maintain the original organizational structure.

**Target Users**:
- Users with complex note organization
- Users managing by project/topic
- Users who need quick note location after export

## Export Mode Comparison

| Feature | Flat Structure | Hierarchical Structure |
|---------|----------------|-------------------------|
| File Organization | All files in same directory | Organized by folder structure |
| Resource Storage | Unified `assets` directory | Independent `assets` directory per folder |
| Use Case | Simple notes, quick export | Complex structure, maintain hierarchy |
| Resource References | `./assets/filename` | `./assets/filename` (relative path) |
| File Path | `export_dir/note_name.md` | `export_dir/folder1/folder2/note_name.md` |

### Flat Structure Example

```
export/
├── note1.md
├── note2.md
├── note3.md
└── assets/
    ├── image1.png
    └── image2.png
```

### Hierarchical Structure Example

```
export/
└── WorkNotes/
    ├── ProjectA/
    │   ├── Requirements.md
    │   └── assets/
    │       └── diagram.png
    └── ProjectB/
        ├── MeetingNotes.md
        └── assets/
            └── whiteboard.jpg
```

## Installation

### Method 1: Install via Joplin Plugin Marketplace (Recommended)

1. Open Joplin
2. Go to **Tools** → **Options** → **Plugins**
3. Search for **"joplin-plugin-typora-like-editor"**
4. Click install

### Method 2: Manual Installation

1. Download the latest `.jpl` plugin file from [Releases](https://github.com/sithphil/joplin-plugin-typora-like-editor/releases)
2. Close Joplin
3. Copy the downloaded `.jpl` file to Joplin plugins directory:
   - **Windows**: `%USERPROFILE%\.config\joplin-desktop\plugins\`
   - **macOS**: `~/Library/Application Support/joplin-desktop/plugins/`
   - **Linux**: `~/.config/joplin-desktop/plugins/`
4. Restart Joplin

### Method 3: Install from Source (Developers)

```bash
# Clone repository
git clone https://github.com/sithphil/joplin-plugin-typora-like-editor.git
cd joplin-plugin-typora-like-editor

# Install dependencies
npm install

# Build plugin
npm run dist

# The generated plugin file is located at publish/io.github.sithphil.joplin-plugin-typora-like-editor.jpl
# Follow Method 2 for manual installation
```

## Usage

### Basic Export

1. Select the note or folder to export in Joplin
2. Click **File** → **Export all**
3. Select **Markdown (No Title From metadata)** format
4. Choose export location and filename
5. Click export

### Configure Export Options

1. Go to **Tools** → **Options** → **Plugins**
2. Find **Typora-like Editor** settings
3. Configure the following options:
   - **Export Path Style**: Choose flat structure or hierarchical structure
   - **Save Merged Content**: Whether to merge all notes into one file

## Export Result Example

### Exported Markdown File Format

```markdown
---
title: ESXi-r740
author: John Doe
created: 2024-01-15T10:30:00.000Z
updated: 2024-01-20T15:45:00.000Z
---

![esxi图形化管理1](./assets/esxi图形化管理1.png)

![esxi-gpumanager](./assets/esxi-gpumanager.png)

ESXi host configuration description...

```

### YAML Frontmatter Field Description

| Field | Description | Format |
|-------|-------------|--------|
| `title` | Note title | String |
| `author` | Author | String (default "Unknown Author") |
| `created` | Creation time | ISO 8601 format |
| `updated` | Update time | ISO 8601 format |

## Technical Features

- **Async Processing**: Efficient async file operations without blocking main thread
- **Error Recovery**: Comprehensive error handling and logging
- **Cross-platform Support**: Automatically adapts to Windows, macOS, Linux paths
- **Resource Deduplication**: Smart resource reference handling, avoiding duplicate storage
- **Path Sanitization**: Automatically removes illegal characters from filenames

## Development Documentation
The program's functionality has only been tested on the Windows platform with Joplin version 3.5.12.

Detailed development documentation is available in the `doc/` directory:

- [导出功能.md](doc/导出功能.md) - Export functionality details (Chinese)
- [触发机制.md](doc/触发机制.md) - Export module event trigger mechanism (Chinese)
- [插件设置.md](doc/插件设置.md) - Plugin configuration (Chinese)
- [日志系统.md](doc/日志系统.md) - Logging system (Chinese)
- [插件开发调试与发布.md](doc/插件开发调试与发布.md) - Development guide (Chinese)

## Feedback

If you encounter issues or have feature suggestions, please:

1. Check the log file: `~/.config/joplin-desktop/logs/joplin-plugin-typora-like-editor.log`
2. Submit an issue on [GitHub Issues](https://github.com/sithphil/joplin-plugin-typora-like-editor/issues)
3. Search or ask on [Joplin Forum](https://discourse.joplinapp.org/)

## License

MIT License

## Acknowledgments

Thanks to the Joplin community and all contributors!
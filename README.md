# Joplin Typora 风格编辑器插件

为 Joplin 提供类似 Typora 的 Markdown 导出功能，支持完善的元数据处理和资源管理。

## 功能特性

### ✨ 核心功能

- **智能 YAML Frontmatter 处理**
  - 自动生成或更新笔记元数据（标题、作者、创建时间、更新时间）
  - 保留用户自定义字段，仅更新核心字段值
  - 补全缺失的核心元数据字段

- **灵活的资源管理**
  - 自动将资源文件复制到 `assets` 目录
  - 将 Joplin 内部资源链接（`:/资源ID`）转换为相对路径
  - 支持跨平台路径处理

- **两种导出模式**
  - **扁平结构**：所有文件和资源放在同一目录
  - **层次结构**：按照 Joplin 文件夹结构组织文件

- **批量导出支持**
  - 支持导出单个或多个笔记
  - 可选择将所有笔记合并为一个文件或分别保存

## 使用场景

### 场景 1：导出笔记到本地 Markdown 编辑器

将 Joplin 中的笔记导出为标准的 Markdown 文件，可在 Typora、VS Code、Obsidian 等 Markdown 编辑器中编辑和查看。

**适用人群**：
- 习惯使用本地 Markdown 编辑器的用户
- 需要离线编辑笔记的用户
- 希望在不同工具间切换编辑笔记的用户

### 场景 2：分享笔记给他人

导出的 Markdown 文件和资源文件可以直接分享，接收方无需安装 Joplin 即可查看完整的笔记内容和图片。

**适用人群**：
- 需要与团队成员协作的用户
- 希望分享技术文档的用户
- 需要归档笔记的用户

### 场景 3：备份笔记

将 Joplin 笔记导出为标准的 Markdown 格式，作为额外的备份方案，确保数据安全。

**适用人群**：
- 注重数据安全的用户
- 需要多重备份的用户
- 希望笔记格式独立于 Joplin 的用户

### 场景 4：保持文件夹结构

层次结构模式可以完美保留 Joplin 中的文件夹层级关系，适合需要维护原有组织结构的用户。

**适用人群**：
- 笔记组织结构复杂的用户
- 需要按项目/主题分类管理的用户
- 希望导出后仍能快速定位笔记的用户

## 导出模式对比

| 特性 | 扁平结构 | 层次结构 |
|------|---------|---------|
| 文件组织 | 所有文件在同一目录 | 按文件夹结构组织 |
| 资源存储 | 统一 `assets` 目录 | 每个文件夹独立的 `assets` 目录 |
| 适用场景 | 简单笔记、快速导出 | 复杂结构、保持层级 |
| 资源引用 | `./assets/文件名` | `./assets/文件名`（相对路径） |
| 文件路径 | `导出目录/笔记名.md` | `导出目录/文件夹1/文件夹2/笔记名.md` |

### 扁平结构示例

```
export/
├── 笔记1.md
├── 笔记2.md
├── 笔记3.md
└── assets/
    ├── image1.png
    └── image2.png
```

### 层次结构示例

```
export/
└── 工作笔记/
    ├── 项目A/
    │   ├── 需求文档.md
    │   └── assets/
    │       └── diagram.png
    └── 项目B/
        ├── 会议记录.md
        └── assets/
            └── whiteboard.jpg
```

## 安装方法

### 方法 1：通过 Joplin 插件市场安装（推荐）

1. 打开 Joplin 应用
2. 进入 **工具** → **选项** → **插件**
3. 搜索 **"joplin-plugin-typora-like-editor"**
4. 点击安装

### 方法 2：手动安装

1. 从 [Releases](https://github.com/sithphil/joplin-plugin-typora-like-editor/releases) 下载最新的 `.jpl` 插件文件
2. 关闭 Joplin
3. 将下载的 `.jpl` 文件复制到 Joplin 插件目录：
   - **Windows**: `%USERPROFILE%\.config\joplin-desktop\plugins\`
   - **macOS**: `~/Library/Application Support/joplin-desktop/plugins/`
   - **Linux**: `~/.config/joplin-desktop/plugins/`
4. 重新启动 Joplin

### 方法 3：从源码安装（开发者）

```bash
# 克隆仓库
git clone https://github.com/sithphil/joplin-plugin-typora-like-editor.git
cd joplin-plugin-typora-like-editor

# 安装依赖
npm install

# 构建插件
npm run dist

# 生成的插件文件位于 publish/io.github.sithphil.joplin-plugin-typora-like-editor.jpl
# 按照方法 2 手动安装
```

## 使用方法

### 基本导出

1. 在 Joplin 中选择要导出的笔记或文件夹
2. 点击 **文件** → **导出所有**
3. 选择 **Markdown (No Title From metadata)** 格式
4. 选择导出位置和文件名
5. 点击导出

### 配置导出选项

1. 进入 **工具** → **选项** → **插件**
2. 找到 **Typora 风格编辑器** 设置
3. 配置以下选项：
   - **导出路径样式**：选择扁平结构或层次结构
   - **保存合并内容**：是否将所有笔记合并为一个文件

## 导出结果示例

### 导出的 Markdown 文件格式

```markdown
---
title: ESXi-r740
author: 张三
created: 2024-01-15T10:30:00.000Z
updated: 2024-01-20T15:45:00.000Z
---

![esxi图形化管理1](./assets/esxi图形化管理1.png)

![esxi-gpumanager](./assets/esxi-gpumanager.png)

ESXi 主机配置说明...

```

### YAML Frontmatter 字段说明

| 字段 | 说明 | 格式 |
|------|------|------|
| `title` | 笔记标题 | 字符串 |
| `author` | 作者 | 字符串（默认"未知作者"） |
| `created` | 创建时间 | ISO 8601 格式 |
| `updated` | 更新时间 | ISO 8601 格式 |

## 技术特点

- **异步处理**：高效的异步文件操作，不阻塞主线程
- **错误恢复**：完善的错误处理和日志记录
- **跨平台支持**：自动适配 Windows、macOS、Linux 路径
- **资源去重**：智能处理资源引用，避免重复存储
- **路径清理**：自动清理文件名中的非法字符

## 开发文档

详细的开发文档位于 `doc/` 目录：

- [导出功能.md](doc/导出功能.md) - 导出功能详细说明
- [触发机制.md](doc/触发机制.md) - 导出模块事件触发机制
- [插件设置.md](doc/插件设置.md) - 插件配置说明
- [日志系统.md](doc/日志系统.md) - 日志系统说明
- [插件开发调试与发布.md](doc/插件开发调试与发布.md) - 开发指南

## 问题反馈

如果您遇到问题或有功能建议，请：

1. 查看日志文件：`~/.config/joplin-desktop/logs/joplin-plugin-typora-like-editor.log`
2. 在 [GitHub Issues](https://github.com/sithphil/joplin-plugin-typora-like-editor/issues) 提交问题
3. 在 [Joplin 论坛](https://discourse.joplinapp.org/) 搜索或提问

## 许可证

MIT License

## 致谢

感谢 Joplin 社区和所有贡献者的支持！

# Joplin Typora 风格编辑器插件

为 Joplin 提供 Typora 用户喜欢的 Markdown 风格文档导出功能，支持完善的元数据处理和资源管理。

## 试图解决的痛点

### 痛点 1：Typora 显示格式混乱

使用"切换外部编辑"进入 Typora 写作界面时，笔记标题烦人地出现在了 YAML 前言之前，导致 Typora 显示格式混乱。这是一个令人困惑的设计。

**解决方案**：将笔记标题从正文中移除，统一放入 YAML Frontmatter 的 `title` 字段，确保在 Typora 中显示格式正确。

### 痛点 2：导出方式单一

默认的 Markdown 导出只能进行层次化结构导出，无法选择扁平结构或其他导出方式。

**解决方案**：提供两种导出模式选择：
- **扁平结构**：所有文件放在同一目录，适合简单笔记快速导出
- **层次结构**：按文件夹层级组织，适合复杂结构笔记

### 痛点 3：无法发布到博客（开发中）

想要为编辑器工具栏提供一个发布按钮，点击它就进入 `push-markdown` 界面，用于发布笔记到 WordPress 博客。

**开发状态**：此功能正在开发中，敬请期待。

## 功能特性

### ✨ 核心功能

- **智能 YAML Frontmatter 处理**
  - 自动生成或更新笔记元数据（标题、作者、创建时间、更新时间）
  - 保留用户自定义字段，仅更新核心字段值
  - 补全缺失的核心元数据字段
  - **解决 Typora 显示问题**：将标题从正文中移除，统一放入 Frontmatter

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

- **Markdown 导入功能**（新增）
  - 导入本地 Markdown 文件到 Joplin
  - 自动识别并导入本地图片资源
  - 智能处理图片引用，转换为 Joplin 内部格式

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

### 场景 5：导入 Markdown 文件（新增）

将本地的 Markdown 文件导入到 Joplin，自动处理其中的本地图片资源，适合从其他 Markdown 编辑器迁移笔记到 Joplin。

**适用人群**：
- 从 Typora、VS Code 等编辑器迁移笔记的用户
- 需要将本地 Markdown 文档集中管理到 Joplin 的用户
- 想要统一笔记管理平台的用户

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

### 导出笔记

#### 基本导出

1. 在 Joplin 中选择要导出的笔记或文件夹
2. 点击 **文件** → **导出所有**
3. 选择 **Markdown (No Title From metadata)** 格式
4. 选择导出位置和文件名
5. 点击导出

#### 配置导出选项

1. 进入 **工具** → **选项** → **插件**
2. 找到 **Typora 风格编辑器** 设置
3. 配置以下选项：
   - **导出路径样式**：选择扁平结构或层次结构
   - **保存合并内容**：是否将所有笔记合并为一个文件

### 导入 Markdown 文件（新增）

#### 基本导入

1. 点击 **文件** → **导入** → **Markdown (with Local Images)**
2. 选择要导入的 Markdown 文件
3. 插件会自动：
   - 读取 Markdown 文件内容
   - 识别并导入本地图片资源
   - 将图片引用转换为 Joplin 内部格式
   - 创建笔记并保存到当前选中的文件夹

#### 导入特性

- **智能图片处理**：
  - 自动识别本地图片路径和 URL
  - 本地图片自动导入到 Joplin 资源库
  - URL 图片保持原引用不变

- **Alt 文本处理**：
  - 空白 alt 自动使用文件名
  - 保留原有 alt 文本

- **路径替换**：
  - 本地路径替换为 Joplin 内部格式 `:/资源ID`
  - 支持相对路径和绝对路径

- **错误处理**：
  - 图片导入失败保留原引用
  - 详细的错误日志记录

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
程序功能仅测试了windows平台的Joplin-3.5.12。

详细的开发文档位于 `doc/` 目录：

- [导出功能.md](doc/导出功能.md) - 导出功能详细说明
- [导入功能.md](doc/导入功能.md) - 导入功能详细说明
- [触发机制.md](doc/触发机制.md) - 导出模块事件触发机制
- [插件设置.md](doc/插件设置.md) - 插件配置说明
- [日志系统.md](doc/日志系统.md) - 日志系统说明
- [插件开发调试与发布.md](doc/插件开发调试与发布.md) - 开发指南

## 多语言支持

- [README.md](README.md) - 中文文档
- [README_EN.md](README_EN.md) - English Documentation

## 问题反馈

如果您遇到问题或有功能建议，请：

1. 查看日志文件：`~/.config/joplin-desktop/logs/joplin-plugin-typora-like-editor.log`
2. 在 [GitHub Issues](https://github.com/sithphil/joplin-plugin-typora-like-editor/issues) 提交问题
3. 在 [Joplin 论坛](https://discourse.joplinapp.org/) 搜索或提问

## 许可证

MIT License

## 致谢

感谢 Joplin 社区和所有贡献者的支持！

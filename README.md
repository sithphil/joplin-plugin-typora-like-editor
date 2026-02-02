# Joplin 插件

本文档详细说明 Joplin 插件的核心导出功能需求。关于插件的构建、调试及发布操作，可参考 GENERATOR_DOC.md。

核心功能：Markdown 导出

该插件支持将 Joplin 笔记导出为 Markdown 格式，针对内容处理、资源存储及前沿信息（frontmatter）处理制定以下专属规则。

## 导出笔记为markdown文件

- 资源存储：与笔记关联的所有资源（如图片、附件等）需保存至 assets 目录，该目录创建于导出的 Markdown 文件同级目录下。Markdown 文件将通过相对路径引用这些资源（示例：./assets/resource-id.png）。

- 标题排除：笔记标题不得作为导出 Markdown 文件的第一行内容，仅保留笔记正文（剔除标题部分）作为主内容区域。


## Manual via file system
- Download the latest released JPL package (io.github.jackgruber.hotfolder.jpl) from here
- Close Joplin
- Copy the downloaded JPL package in your profile plugins folder
- Start Joplin

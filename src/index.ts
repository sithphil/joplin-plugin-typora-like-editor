import joplin from "api";
import { FileSystemItem, ModelType } from "api/types";
const fs = joplin.require("fs-extra");
import * as path from "path"; // 引入路径处理，适配跨平台

// 全局缓存：存储笔记内容、资源映射（解决context共享问题）
let exportGlobalCache = {
  content: "", // 存储累加的笔记正文内容（含处理后的YAML前沿）
  resourceMap: new Map(), // 资源ID -> assets相对路径映射
};

// 处理YAML前沿：生成/替换核心字段，保留自定义字段
const processYamlFrontmatter = (noteBody, note) => {
  // 定义YAML分隔符正则，匹配开头的YAML块
  const yamlRegex = /^---\s*[\s\S]*?\s*---\s*/;
  // 核心元数据（均同步Joplin内部元数据）
  const coreMetadata = {
    title: note.title || "未命名笔记", // title：同步Joplin内部笔记标题元数据
    author: note.author || "未知作者", // author：同步Joplin内部笔记作者元数据（无则用默认值）
    created: new Date(note.created_time).toISOString(), // 符合ISO 8601标准
    updated: new Date(note.updated_time).toISOString(),
  };

  // 情况1：原有YAML前沿，替换核心字段，保留自定义字段
  if (yamlRegex.test(noteBody)) {
    const originalYaml = noteBody.match(yamlRegex)[0];
    let newYaml = "---\n";
    // 拆分原有YAML字段，逐行处理
    const yamlLines = originalYaml.split("\n").filter(line => line.trim() !== "" && line.trim() !== "---");
    // 存储原有自定义字段（排除4个核心字段）
    const customFields = [];
    yamlLines.forEach(line => {
      const [key] = line.split(":").map(item => item.trim());
      if (!["title", "author", "created", "updated"].includes(key)) {
        customFields.push(line.trim());
      }
    });
    // 拼接新YAML：核心字段（同步Joplin元数据） + 自定义字段
    Object.entries(coreMetadata).forEach(([key, value]) => {
      newYaml += `${key}: ${value}\n`;
    });
    if (customFields.length > 0) {
      newYaml += "\n" + customFields.join("\n") + "\n";
    }
    newYaml += "---\n";
    // 替换原有YAML，返回处理后的正文
    const processedBody = noteBody.replace(yamlRegex, newYaml);
    console.log("原有YAML前沿处理完成，替换核心字段（同步Joplin元数据）");
    return processedBody;
  }

  // 情况2：无原有YAML，生成新的YAML前沿（核心字段同步Joplin元数据）
  const newYaml = `---
title: ${coreMetadata.title}
author: ${coreMetadata.author}
created: ${coreMetadata.created}
updated: ${coreMetadata.updated}
---

`;
  const processedBody = newYaml + noteBody;
  console.log("无原有YAML，生成新前沿信息（同步Joplin元数据）");
  return processedBody;
};

// 替换笔记中的资源链接：将Joplin内部ID链接转为assets相对路径
const replaceResourceLinks = (content) => {
  if (!content || exportGlobalCache.resourceMap.size === 0) {
    return content;
  }
  // 匹配Joplin内部资源链接格式：![alt](:/资源ID)
  const resourceRegex = /!\[(.*?)\]\(:\/([a-f0-9]+)\)/g;
  const processedContent = content.replace(resourceRegex, (match, alt, resId) => {
    const localPath = exportGlobalCache.resourceMap.get(resId) || match;
    console.log(`资源链接替换：${match} -> ![${alt}](${localPath})`);
    return `![${alt}](${localPath})`;
  });
  return processedContent;
};

joplin.plugins.register({
  onStart: async function() {
    // eslint-disable-next-line no-console
    console.info("Typora-like Editor Plugin started!");

    await joplin.interop.registerExportModule({
      format: "typora_md",
      description: "Markdown (No Title From metadata)",
      target: FileSystemItem.File,
      isNoteArchive: false,
      fileExtensions: ["md"],

      onInit: async function(context: any) {
        // 初始化缓存，清空上次导出残留数据
        exportGlobalCache.content = "";
        exportGlobalCache.resourceMap.clear();
        console.log("onInit：导出初始化完成，全局缓存已清空");
      },

      onProcessItem: async function(context: any, itemType: number, item: any) {
        console.log("onProcessItem：当前上下文", context);
        if (itemType === ModelType.Note) {
          // 打印笔记基础信息（调试用）
          console.log("【当前处理笔记-基础信息】", item);
          // 获取笔记完整信息（含创建/更新时间、作者，用于前沿生成）
          const note = await joplin.data.get(["notes", item.id], {
            fields: ["id", "title", "body", "created_time", "updated_time", "author"],
          });
          console.log("【当前处理笔记-完整属性】", note);
          // 处理YAML前沿，排除标题（标题仅在前沿中存在）
          let processedBody = processYamlFrontmatter(note.body || "", note);
          // 替换资源链接为assets相对路径
          processedBody = replaceResourceLinks(processedBody);
          console.log("【当前处理笔记-处理后内容】", processedBody);
          // 累加笔记内容（多笔记用空行分隔）
          exportGlobalCache.content += processedBody + "\n\n";
          console.log(`笔记【${note.title}】处理完成，已加入全局缓存`);
        }
      },

      onProcessResource: async function(context: any, resource: any, filePath:string) {
        console.log("【onProcessResource：当前处理资源中】");
        try {
          // 获取资源完整信息（含后缀、原始名称）
          console.log("【当前处理资源-完整属性】", resource);
          const resDetail = await joplin.data.get(["resources", resource.id], {
            fields: ["id", "file_extension", "title"],
          });
          if (!resDetail.file_extension) {
            console.warn("资源信息不完整，跳过处理：", resource.id);
            return;
          }

          // 1. 定义资源存储路径：导出目录/assets/资源文件
          const destDir = path.dirname(context.destPath); // 导出文件所在目录
          const assetsDir = path.join(destDir, "assets"); // assets目录（同级）
          // 资源文件名：优先用原始名称，无则用资源ID
          const resFileName = resDetail.title
            ? `${resDetail.title}`
            : `${resDetail.id}.${resDetail.file_extension}`;
          const resDestPath = path.join(assetsDir, resFileName); // 资源目标路径
          const resRelativePath = `./assets/${resFileName}`; // 笔记中使用的相对路径

          // 2. 创建assets目录（若不存在）
          if (!await fs.pathExists(assetsDir)) {
            await fs.mkdir(assetsDir);
            console.log("创建assets资源目录：", assetsDir);
          }

          // 3. 复制Joplin内部资源到assets目录
          await fs.copyFile(filePath, resDestPath);
          console.log(`资源复制完成：${filePath} -> ${resDestPath}`);

          // 4. 记录资源映射，供后续链接替换使用
          exportGlobalCache.resourceMap.set(resDetail.id, resRelativePath);
        } catch (error) {
          console.error("资源处理失败：", error);
        }
      },

      onClose: async function(context: any) {
        try {
          const finalContent = exportGlobalCache.content || "";
          // 写入最终处理后的内容（含YAML前沿、修正后的资源链接）
          await fs.writeFile(context.destPath, finalContent, "utf8");
          // 打印导出结果（调试用）
          console.log(`导出成功！文件路径：${context.destPath}`);
          console.log(`导出内容长度：${finalContent.length} 字符`);
          console.log(
            `资源总数：${exportGlobalCache.resourceMap.size} 个，存储目录：${
              path.join(path.dirname(context.destPath), "assets")
            }`,
          );
        } catch (error) {
          console.error("导出失败：", error);
        } finally {
          // 兜底：重置缓存，避免多次导出污染
          exportGlobalCache.content = "";
          exportGlobalCache.resourceMap.clear();
        }
      },
    });
  },
});

import joplin from "api";
import { SettingItemType } from "api/types";
import { getLogger } from "./logger";

const logger = getLogger("joplin-plugin-typora-like-editor");

/**
 * 导出路径样式枚举
 */
export enum ExportPathStyle {
  /**
   * 扁平结构：所有文件和资源放在同一目录下
   * 例如：
   * - export.md
   * - assets/image1.png
   * - assets/image2.png
   */
  Flat = 0,

  /**
   * 层次结构：按照文件夹结构组织文件
   * 例如：
   * - Notebook1/
   *   - note1.md
   *   - assets/
   *     - image1.png
   * - Notebook2/
   *   - note2.md
   *   - assets/
   *     - image2.png
   */
  Hierarchical = 1,
}

/**
 * 导出路径样式标签映射
 */
const exportPathStyleLabels: Record<ExportPathStyle, string> = {
  [ExportPathStyle.Flat]: "扁平结构",
  [ExportPathStyle.Hierarchical]: "层次结构",
};

/**
 * 设置键名常量
 */
export const SETTINGS_KEYS = {
  /**
   * 导出路径样式
   */
  EXPORT_PATH_STYLE: "exportPathStyle",
  /**
   * 保存合并内容开关
   */
  SAVE_MERGED_CONTENT: "saveMergedContent",
} as const;

/**
 * 设置部分名称
 */
export const SETTINGS_SECTION = "typoraLikeEditor";

/**
 * 设置部分显示信息
 */
export const SETTINGS_SECTION_INFO = {
  label: "Typora风格编辑器",
  iconName: "fas fa-pen",
  description: "配置 Typora 风格导出插件的参数",
};

/**
 * 注册插件设置
 *
 * 在插件启动时调用此函数来注册所有插件设置。
 * 设置值会自动持久化，下次启动时自动恢复。
 *
 * @example
 * ```typescript
 * joplin.plugins.register({
 *   onStart: async function() {
 *     await registerSettings();
 *   }
 * });
 * ```
 */
export async function registerSettings(): Promise<void> {
  logger.logFunctionStart("registerSettings");

  try {
    // 注册设置部分
    await joplin.settings.registerSection(SETTINGS_SECTION, SETTINGS_SECTION_INFO);

    // 使用 registerSettings 一次性注册所有设置项
    await joplin.settings.registerSettings({
      [SETTINGS_KEYS.EXPORT_PATH_STYLE]: {
        type: SettingItemType.Int,
        value: ExportPathStyle.Flat,
        label: "导出路径样式",
        description: "选择导出时的文件和资源组织方式",
        public: true,
        section: SETTINGS_SECTION,
        isEnum: true,
        options: {
          [ExportPathStyle.Flat]: exportPathStyleLabels[ExportPathStyle.Flat],
          [ExportPathStyle.Hierarchical]: exportPathStyleLabels[ExportPathStyle.Hierarchical],
        },
        advanced: false,
      },
      [SETTINGS_KEYS.SAVE_MERGED_CONTENT]: {
        type: SettingItemType.Bool,
        value: false,
        label: "保存合并内容",
        description: "是否将所有笔记合并为一个文件保存（默认为分别保存每个笔记）",
        public: true,
        section: SETTINGS_SECTION,
        advanced: false,
      },
    });

    logger.info("插件设置注册完成", {
  exportPathStyleOptions: {
    [ExportPathStyle.Flat]: exportPathStyleLabels[ExportPathStyle.Flat],
    [ExportPathStyle.Hierarchical]: exportPathStyleLabels[ExportPathStyle.Hierarchical],
  }
});
  } catch (error) {
    logger.logError(error, "注册插件设置失败");
    throw error;
  }

  logger.logFunctionEnd("registerSettings");
}

/**
 * 获取导出路径样式设置值
 *
 * @returns 当前设置的导出路径样式
 */
export async function getExportPathStyle(): Promise<ExportPathStyle> {
  const value = await joplin.settings.value(SETTINGS_KEYS.EXPORT_PATH_STYLE);
  return value as ExportPathStyle;
}

/**
 * 设置导出路径样式
 *
 * @param style 要设置的导出路径样式
 */
export async function setExportPathStyle(style: ExportPathStyle): Promise<void> {
  await joplin.settings.setValue(SETTINGS_KEYS.EXPORT_PATH_STYLE, style);
}

/**
 * 获取保存合并内容开关设置值
 *
 * @returns 当前设置的保存合并内容开关状态
 */
export async function getSaveMergedContent(): Promise<boolean> {
  const value = await joplin.settings.value(SETTINGS_KEYS.SAVE_MERGED_CONTENT);
  return value as boolean;
}

/**
 * 设置保存合并内容开关
 *
 * @param enabled 是否启用保存合并内容
 */
export async function setSaveMergedContent(enabled: boolean): Promise<void> {
  await joplin.settings.setValue(SETTINGS_KEYS.SAVE_MERGED_CONTENT, enabled);
}

/**
 * 获取所有插件设置值
 *
 * @returns 包含所有设置值的对象
 */
export async function getAllSettings(): Promise<Record<string, unknown>> {
  const settings = await joplin.settings.values(Object.values(SETTINGS_KEYS));
  logger.debug("获取所有插件设置", { settings });
  return settings;
}

/**
 * 验证设置值是否有效
 *
 * @param key 设置键名
 * @param value 设置值
 * @returns 是否有效
 */
export function validateSettingValue(key: string, value: unknown): boolean {
  if (key === SETTINGS_KEYS.EXPORT_PATH_STYLE) {
    return Object.values(ExportPathStyle).includes(value as ExportPathStyle);
  }
  if (key === SETTINGS_KEYS.SAVE_MERGED_CONTENT) {
    return typeof value === "boolean";
  }
  return false;
}

/**
 * 获取设置的默认值
 *
 * @param key 设置键名
 * @returns 默认值
 */
export function getSettingDefaultValue(key: string): unknown {
  if (key === SETTINGS_KEYS.EXPORT_PATH_STYLE) {
    return ExportPathStyle.Flat;
  }
  if (key === SETTINGS_KEYS.SAVE_MERGED_CONTENT) {
    return false;
  }
  return null;
}

/**
 * 重置所有设置为默认值
 */
export async function resetAllSettings(): Promise<void> {
  logger.warn("重置所有插件设置为默认值");

  for (const key of Object.values(SETTINGS_KEYS)) {
    const defaultValue = getSettingDefaultValue(key);
    if (defaultValue !== null) {
      await joplin.settings.setValue(key, defaultValue);
    }
  }

  logger.info("所有设置已重置");
}
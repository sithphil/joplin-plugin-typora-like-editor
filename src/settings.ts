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
  /**
   * 默认用户名
   */
  DEFAULT_AUTHOR: "defaultAuthor",
  /**
   * 外部编辑器路径
   */
  EXTERNAL_EDITOR_PATH: "externalEditorPath",
  /**
   * 临时目录路径
   */
  TEMP_DIR_PATH: "tempDirPath",
  /**
   * 自动同步开关
   */
  AUTO_SYNC: "autoSync",
  /**
   * 同步间隔（毫秒）
   */
  SYNC_INTERVAL: "syncInterval",
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

    // 准备设置项配置
    const settingsConfig: Record<string, any> = {
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
      [SETTINGS_KEYS.DEFAULT_AUTHOR]: {
        type: SettingItemType.String,
        value: "Unknown Author",
        label: "默认作者",
        description: "导出笔记时使用的默认作者名称（当笔记没有设置作者时使用）",
        public: true,
        section: SETTINGS_SECTION,
        advanced: false,
      },
      [SETTINGS_KEYS.EXTERNAL_EDITOR_PATH]: {
        type: SettingItemType.String,
        value: "Typora",
        label: "外部编辑器",
        description: "指定用于打开笔记的外部编辑器（如 Typora、code、obsidian）。在 Windows/macOS 上可以使用应用名称，在 Linux 上需要完整路径",
        public: true,
        section: SETTINGS_SECTION,
        advanced: false,
      },
      [SETTINGS_KEYS.TEMP_DIR_PATH]: {
        type: SettingItemType.String,
        value: "",
        label: "临时目录",
        description: "指定临时导出文件的目录，留空则使用插件数据目录",
        public: true,
        section: SETTINGS_SECTION,
        advanced: true,
      },
      [SETTINGS_KEYS.AUTO_SYNC]: {
        type: SettingItemType.Bool,
        value: true,
        label: "自动同步",
        description: "检测到文件修改时自动同步回 Joplin。禁用后会在检测到修改时提示用户选择是否同步",
        public: true,
        section: SETTINGS_SECTION,
        advanced: false,
      },
      [SETTINGS_KEYS.SYNC_INTERVAL]: {
        type: SettingItemType.Int,
        value: 5000,
        label: "同步间隔（毫秒）",
        description: "文件变化后等待的时间，用于防抖（避免频繁触发同步）",
        public: true,
        section: SETTINGS_SECTION,
        advanced: true,
      },
    };

    // 注册设置项
    await joplin.settings.registerSettings(settingsConfig);

    logger.info("插件设置注册完成", {
      exportPathStyleOptions: {
        [ExportPathStyle.Flat]: exportPathStyleLabels[ExportPathStyle.Flat],
        [ExportPathStyle.Hierarchical]: exportPathStyleLabels[ExportPathStyle.Hierarchical],
      },
      settingsConfig: {
        [SETTINGS_KEYS.EXPORT_PATH_STYLE]: settingsConfig[SETTINGS_KEYS.EXPORT_PATH_STYLE].value,
        [SETTINGS_KEYS.SAVE_MERGED_CONTENT]: settingsConfig[SETTINGS_KEYS.SAVE_MERGED_CONTENT].value,
        [SETTINGS_KEYS.DEFAULT_AUTHOR]: settingsConfig[SETTINGS_KEYS.DEFAULT_AUTHOR].value,
        [SETTINGS_KEYS.EXTERNAL_EDITOR_PATH]: settingsConfig[SETTINGS_KEYS.EXTERNAL_EDITOR_PATH].value,
        [SETTINGS_KEYS.TEMP_DIR_PATH]: settingsConfig[SETTINGS_KEYS.TEMP_DIR_PATH].value,
        [SETTINGS_KEYS.AUTO_SYNC]: settingsConfig[SETTINGS_KEYS.AUTO_SYNC].value,
        [SETTINGS_KEYS.SYNC_INTERVAL]: settingsConfig[SETTINGS_KEYS.SYNC_INTERVAL].value,
      },
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
 * 获取默认作者设置值
 *
 * @returns 当前设置的默认作者名称
 */
export async function getDefaultAuthor(): Promise<string> {
  const value = await joplin.settings.value(SETTINGS_KEYS.DEFAULT_AUTHOR);
  return value as string || "Unknown";
}

/**
 * 设置默认作者
 *
 * @param author 要设置的默认作者名称
 */
export async function setDefaultAuthor(author: string): Promise<void> {
  await joplin.settings.setValue(SETTINGS_KEYS.DEFAULT_AUTHOR, author);
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
  if (key === SETTINGS_KEYS.DEFAULT_AUTHOR) {
    return typeof value === "string";
  }
  if (key === SETTINGS_KEYS.EXTERNAL_EDITOR_PATH) {
    return typeof value === "string";
  }
  if (key === SETTINGS_KEYS.TEMP_DIR_PATH) {
    return typeof value === "string";
  }
  if (key === SETTINGS_KEYS.AUTO_SYNC) {
    return typeof value === "boolean";
  }
  if (key === SETTINGS_KEYS.SYNC_INTERVAL) {
    return typeof value === "number" && value > 0;
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
  if (key === SETTINGS_KEYS.DEFAULT_AUTHOR) {
    return "Unknown Author";
  }
  if (key === SETTINGS_KEYS.EXTERNAL_EDITOR_PATH) {
    return "Typora";
  }
  if (key === SETTINGS_KEYS.TEMP_DIR_PATH) {
    return "";
  }
  if (key === SETTINGS_KEYS.AUTO_SYNC) {
    return true;
  }
  if (key === SETTINGS_KEYS.SYNC_INTERVAL) {
    return 5000;
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

/**
 * 获取外部编辑器路径设置值
 *
 * @returns 当前设置的外部编辑器路径
 */
export async function getExternalEditorPath(): Promise<string> {
  const value = await joplin.settings.value(SETTINGS_KEYS.EXTERNAL_EDITOR_PATH);
  return value as string || "Typora";
}

/**
 * 获取临时目录路径设置值
 *
 * @returns 当前设置的临时目录路径，如果为空则返回 null
 */
export async function getTempDirPath(): Promise<string | null> {
  const value = await joplin.settings.value(SETTINGS_KEYS.TEMP_DIR_PATH);
  return value as string || null;
}
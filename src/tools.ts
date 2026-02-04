/**
 * 从单行Markdown图片文本中提取信息，返回完整匹配串+alt+文件路径
 * 规则：1. 先匹配![alt]，仅在其后文本中处理括号 2. 取最左(和最右)，截取中间为filePath
 * @param lineText 输入的单行文本（如：![风景1](D:/图片/春天(花海).png)）
 * @returns 匹配结果对象，无合法匹配时所有字段为null
 *          fullMatch: 完整匹配串（![alt](xxx)整段）| null
 *          alt: 图片alt文本（空则为''）| null
 *          filePath: 括号中间的文件路径 | null
 */
function extractPathInBrackets(lineText: string): {
    fullMatch: string | null;
    alt: string | null;
    filePath: string | null;
} {
    // 初始化默认返回值：无匹配时所有字段为null
    const defaultResult = {
        fullMatch: null,
        alt: null,
        filePath: null,
    };

    // 步骤1：匹配![alt]部分，捕获完整alt串和起始/结束位置（非贪婪匹配，支持空alt）
    const altMatch = lineText.match(/(!\[.*?\])/);
    if (!altMatch) return defaultResult;

    const [altFullStr] = altMatch; // altFullStr: 完整的![alt]串（如![风景1]、![]）
    const altStartIndex = altMatch.index!; // ![alt]的起始索引
    const altEndIndex = altStartIndex + altFullStr.length; // ![alt]的结束索引（]的位置+1）

    // 步骤2：提取纯alt文本（去除前后的![和]）
    const alt = altFullStr.slice(2, -1) || ''; // 空alt时返回''，如![] → slice(2,-1)为空

    // 步骤3：截取![alt]之后的剩余文本，查找最左(和最右)
    const textAfterAlt = lineText.slice(altEndIndex);
    const firstLeftBracketIndex = textAfterAlt.indexOf('(');
    const lastRightBracketIndex = textAfterAlt.lastIndexOf(')');

    // 步骤4：校验括号合法性（同时存在、(在)左侧）
    if (
        firstLeftBracketIndex === -1 ||
        lastRightBracketIndex === -1 ||
        firstLeftBracketIndex >= lastRightBracketIndex
    ) {
        return defaultResult;
    }

    // 步骤5：提取文件路径（跳过(，截止到)，去首尾空白）
    const filePath = textAfterAlt
        .slice(firstLeftBracketIndex + 1, lastRightBracketIndex)
        .trim();

    // 步骤6：提取完整匹配串fullMatch（从![开始 到 最后一个)结束）
    const fullMatchEndIndex = altEndIndex + lastRightBracketIndex + 1;
    const fullMatch = lineText.slice(altStartIndex, fullMatchEndIndex);

    // 返回最终结果：所有字段赋值
    return {
        fullMatch,
        alt,
        filePath,
    };
}

/**
 * 按!号截断行文本：n个!拆分为n个子行，截断点在第2、3...n个!前
 * @param line 待截断的行文本
 * @returns 截断后的子行数组
 */
function splitLineByExclamation(line: string): string[] {
    const exclamationIndices: number[] = [];
    // 遍历行文本，收集所有!号的索引位置
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '!') {
            exclamationIndices.push(i);
        }
    }

    const subLines: string[] = [];
    const len = exclamationIndices.length;
    // 无!号/1个!号，直接返回原行
    if (len <= 1) {
        subLines.push(line);
        return subLines;
    }

    // 多个!号：按第2、3...n个!为截断点拆分
    for (let i = 0; i < len; i++) {
        const start = exclamationIndices[i];
        // 最后一个!号，截取到行尾；否则截取到下一个!号前
        const end = i === len - 1 ? line.length : exclamationIndices[i + 1];
        subLines.push(line.slice(start, end).trim());
    }

    return subLines;
}

/**
 * 匹配 Markdown 图片引用，提取 alt 文本和图片路径（兼容路径含成对 ()、按!号拆分单行多图）
 * @param markdownText 原始 Markdown 单行、多行文本
 * @returns 匹配结果数组，包含每一张图片的 alt、完整路径、匹配行号（无匹配则返回空数组）
 */
export function parseMarkdownImages(markdownText: string): Array<{
    alt: string;
    imagePath: string;
    lineNumber: number; // 图片所在行号（从1开始）
}> {
    const result: Array<{ alt: string; imagePath: string; lineNumber: number }> = [];
    // 按行拆分文本，兼容 Windows(\r\n) 和 Linux/macOS(\n) 换行符
    const lines = markdownText.split(/\r?\n/);

    // 遍历每一行处理
    lines.forEach((rawLine, lineIdx) => {
        const lineNumber = lineIdx + 1;
        const originalLine = rawLine.trim();
        if (!originalLine) return; // 空行直接跳过

        // 核心步骤1：按!号截断为多个子行
        const subLines = splitLineByExclamation(originalLine);

        // 核心步骤2：遍历每个子行，提取图片信息
        subLines.forEach(subLine => {
            if (!subLine) return; // 空自行跳过
            const matchResult = extractPathInBrackets(subLine);
            // 过滤无效匹配，仅保留有完整匹配和路径的结果
            if (matchResult.fullMatch && matchResult.filePath) {
                result.push({
                    alt: matchResult.alt || '',
                    imagePath: matchResult.filePath,
                    lineNumber,
                });
            }
        });
    });

    return result;
}

// ------------------- 测试示例 -------------------
if (require.main === module) {
    // 测试文本：包含多!号单行多图、成对()、空alt、多括号等所有场景
    const testMd = `
  # 测试图片
  ![风景1](D:/图片/春天(花海).png)
  ![风景2](E:/笔记/(2026)工作/(技术)Joplin.png)![头像](F:/avatar.png)![logo](G:/img/(logo).png)
  ![] (H:/files/(测试文件).jpg)普通文本![尾图](I:/img/test.png)
  ![多括号](J:/docs/(前端)/(TS)/工具函数.png)xxx!普通文本带!号![最后一张](K:/final/(demo).png)
  无!号纯文本行
  `;

    // 执行匹配
    const images = parseMarkdownImages(testMd);
    // 打印结果
    console.log('Markdown 图片匹配结果：\n');
    images.forEach((img, idx) => {
        console.log(`[${idx + 1}] 行号：${img.lineNumber}，alt：${img.alt || '空'}，路径：${img.imagePath}`);
    });
}
#!/bin/bash
set -e # 脚本执行出错立即退出

# ========================== 配置项（需根据自己的项目/平台修改）==========================
GITHUB_TOKEN="$GITHUB_API_TOKEN_JOPLIN"      # 替换为自己的平台令牌
REPO_OWNER="sithphil"                        # 如：github.com/xxx/yyy → 填xxx
REPO_NAME="joplin-plugin-typora-like-editor"  # 如：github.com/xxx/yyy → 填yyy
BIN_BUILD_CMD="npm run dist"                 # 二进制文件构建命令（如无构建可设为""）
BIN_SOURCE_PATH="./publish"                   # 二进制文件/目录原始路径
BIN_OUTPUT_NAME="io.github.sithphil.joplin-plugin-typora-like-editor.jpl" # 最终上传的二进制文件名，{{TAG}}会自动替换为版本标签
BIN_UPLOAD_LABEL="node-dist-package"          # 二进制文件在Release中的标签（便于识别，可自定义）
# ========================================================================================

# 步骤1：获取当前本地最新的Git标签（确保已打标并推送到远程）
echo "【1/6】获取当前Git版本标签..."
TAG=$(git describe --abbrev=0 --tags 2>/dev/null)
if [ -z "$TAG" ]; then
    echo "错误：本地未检测到Git标签，请先执行 git tag -a vx.y.z -m '说明' 打标！"
    exit 1
fi
echo "当前版本标签：$TAG"

# 步骤2：构建二进制文件（若BUILD_CMD非空）
if [ -n "$BIN_BUILD_CMD" ]; then
    echo "【2/6】执行构建命令：$BIN_BUILD_CMD..."
    $BIN_BUILD_CMD
    if [ ! -e "$BIN_SOURCE_PATH/$BIN_OUTPUT_NAME" ]; then
        echo "错误：构建完成后，未找到二进制文件/目录：$BIN_SOURCE_PATH/$BIN_OUTPUT_NAME"
        exit 1
    fi
fi

# 步骤3：调用GitHub API，检查当前标签是否已存在Release，不存在则创建
echo "【3/6】检查并创建Release..."
RELEASE_API_URL="https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/tags/$TAG"
CREATE_RELEASE_API_URL="https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases"
# 检查Release是否存在
RELEASE_RESP=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "$RELEASE_API_URL")
if echo "$RELEASE_RESP" | jq -e '.id' >/dev/null 2>&1; then
    # 存在Release，提取upload_url（需去除{?name,label}后缀）
    echo "Release 已经存在"
    UPLOAD_URL=$(echo "$RELEASE_RESP" | jq -r '.upload_url' | sed 's/{?name,label}//')
else
    # 不存在Release，创建新的Release
    echo "当前标签未创建Release，正在自动创建..."
    CREATE_RESP=$(curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"tag_name\": \"$TAG\",
            \"name\": \"$TAG\",
            \"body\": \"自动发布：$TAG 版本二进制包\",
            \"draft\": false,
            \"prerelease\": false
        }" "$CREATE_RELEASE_API_URL")
    UPLOAD_URL=$(echo "$CREATE_RESP" | jq -r '.upload_url' | sed 's/{?name,label}//')
fi
if [ -z "$UPLOAD_URL" ] || [ "$UPLOAD_URL" = "null" ]; then
    echo "错误：获取Release上传地址失败，API响应：$RELEASE_RESP $CREATE_RESP"
    exit 1
fi
echo "获取二进制上传地址：$UPLOAD_URL"

# 步骤4：上传二进制文件到Release
echo "【4/6】上传二进制文件 $BIN_FINAL_NAME 到Release..."
BIN_FINAL_NAME="$BIN_SOURCE_PATH/$BIN_OUTPUT_NAME"
UPLOAD_RESP=$(curl -s -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @"$BIN_FINAL_NAME" \
    "$UPLOAD_URL?name=$BIN_FINAL_NAME&label=$BIN_UPLOAD_LABEL")

# 校验上传结果
if echo "$UPLOAD_RESP" | jq -e '.id' >/dev/null 2>&1; then
    echo -e "\n✅ 二进制文件上传成功！"
    echo -e "🔗 Release地址：https://github.com/$REPO_OWNER/$REPO_NAME/releases/tag/$TAG"
    # 可选：删除本地打包的二进制文件（避免冗余）
    # rm -f "$BIN_FINAL_NAME"
else
    echo -e "\n❌ 二进制文件上传失败！API响应：$UPLOAD_RESP"
    rm -f "$BIN_FINAL_NAME"
    exit 1
fi

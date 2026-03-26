#!/bin/bash

# 一键构建 Docker 镜像并打包部署文件
# 用法: ./package.sh
#
# 产出物: t3-app_<hash>_<timestamp>.tar.gz
# 解压后目录结构:
#   deploy_package/
#   ├── build_info.sh          # 构建元信息（镜像名、hash 等）
#   ├── t3-app_<hash>.tar      # Next.js 应用镜像
#   ├── t3-app-nginx_<hash>.tar # Nginx 镜像
#   ├── docker-compose.yml     # compose 编排文件
#   ├── nginx.conf             # nginx 配置
#   ├── .env.example           # 环境变量模板
#   ├── deploy/
#   │   └── manage.sh          # 管理脚本
#   └── DEPLOY.md              # 部署说明

set -euo pipefail

# 日志函数
log_info() { echo -e "\033[0;32m[INFO]\033[0m $*"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $*" >&2; }

# 清理函数（仅在错误时调用）
cleanup() {
    log_info "Cleaning up temporary files..."
    rm -rf deploy_package
}

# 错误处理
handle_error() {
    log_error "An error occurred on line $1"
    cleanup
    exit 1
}

# 设置错误处理（仅 ERR，不在正常退出时清理，因为 tar 打包后 deploy_package 仍需保留到打包完成）
trap 'handle_error $LINENO' ERR

# 检查必需工具
check_requirements() {
    local required_tools="docker git"
    for tool in $required_tools; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            log_error "Required tool not found: $tool"
            exit 1
        fi
    done
}

# 构建 Docker 镜像（runner + nginx 两个 target）
build_docker_images() {
    log_info "Building app image (runner target)..."
    docker build -t "${appImageTag}" --target runner .

    log_info "Building nginx image (nginx target)..."
    docker build -t "${nginxImageTag}" --target nginx .
}

# 计算文件 MD5
calc_md5() {
    if command -v md5sum >/dev/null 2>&1; then
        md5sum "$1" | awk '{ print $1 }'
    else
        md5 -q "$1"
    fi
}

# 准备部署文件
prepare_deployment_files() {
    log_info "Preparing deployment files..."
    mkdir -p deploy_package/deploy

    # 保存两个镜像
    local app_tar="${appImageTag//:/_}.tar"
    local nginx_tar="${nginxImageTag//:/_}.tar"

    log_info "Exporting app image..."
    docker save "${appImageTag}" -o "deploy_package/${app_tar}"

    log_info "Exporting nginx image..."
    docker save "${nginxImageTag}" -o "deploy_package/${nginx_tar}"

    # 复制部署所需的配置文件
    cp docker-compose.yml deploy_package/
    cp nginx.conf deploy_package/
    cp .env.example deploy_package/
    cp deploy/manage.sh deploy_package/deploy/

    # 计算 MD5
    local app_md5
    app_md5=$(calc_md5 "deploy_package/${app_tar}")
    local nginx_md5
    nginx_md5=$(calc_md5 "deploy_package/${nginx_tar}")

    # 写入构建信息
    cat > deploy_package/build_info.sh << EOF
hash="${gitHash}"
build_at="${dateTime}"
branch="${gitBranch}"
app_image_tag="${appImageTag}"
nginx_image_tag="${nginxImageTag}"
app_docker_md5="${app_md5}"
nginx_docker_md5="${nginx_md5}"
EOF

    # 生成部署说明
    cat > deploy_package/DEPLOY.md << 'DEPLOYEOF'
# 部署说明

## 前置条件

- Docker + Docker Compose (v2)
- 服务器已开放对应端口（默认 5000）

## 首次部署

```bash
# 1. 上传部署包到服务器
scp t3-app_*.tar.gz user@server:/opt/t3-app/

# 2. 在服务器上解压（仅用于获取 manage.sh 和初始文件）
ssh user@server
cd /opt/t3-app
tar -xzf t3-app_*.tar.gz
cp -r deploy_package/* .
rm -rf deploy_package

# 3. 初始化（创建 .env 模板）
./deploy/manage.sh init

# 4. 编辑 .env，填入生产配置
vi .env
#   必填: DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL

# 5. 从部署包更新（加载镜像 + 启动服务）
./deploy/manage.sh update t3-app_*.tar.gz

# 6. 验证
./deploy/manage.sh status
./deploy/manage.sh health
```

## 后续更新

```bash
# 上传新部署包后，一条命令完成更新
./deploy/manage.sh update t3-app_<new_hash>_<timestamp>.tar.gz
```

update 会自动：加载镜像 → 更新配置 → 重启服务 → 健康检查 → 失败自动回滚。
.env（数据库、密钥等）不会被覆盖。

## 版本管理

```bash
./deploy/manage.sh history              # 查看部署历史
./deploy/manage.sh rollback             # 回退到上一版本
./deploy/manage.sh rollback abc1234     # 回退到指定版本
```

## 其他命令

```bash
./deploy/manage.sh help                 # 查看所有命令
```
DEPLOYEOF
}

# 主函数
main() {
    local start_time=$(date +%s)

    # 检查依赖
    check_requirements

    # 定义变量
    gitBranch=$(git rev-parse --abbrev-ref HEAD)
    gitHash=$(git rev-parse --short HEAD)
    dateTime=$(date "+%Y-%m-%d_%H-%M-%S")
    imagePrefix='t3-app'
    appImageTag="${imagePrefix}:${gitHash}"
    nginxImageTag="${imagePrefix}-nginx:${gitHash}"
    packageName="${imagePrefix}_${gitHash}_${dateTime}.tar.gz"

    log_info "=========================================="
    log_info "构建信息:"
    log_info "  分支:       ${gitBranch}"
    log_info "  Hash:       ${gitHash}"
    log_info "  App 镜像:   ${appImageTag}"
    log_info "  Nginx 镜像: ${nginxImageTag}"
    log_info "=========================================="

    # 执行构建步骤
    build_docker_images
    prepare_deployment_files

    # 创建部署包
    log_info "Creating deployment package..."
    tar -czf "${packageName}" deploy_package

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # 清理中间产物
    rm -rf deploy_package

    log_info "=========================================="
    log_info "构建完成！耗时 ${duration} 秒"
    log_info "部署包: ${packageName}"
    log_info "App 镜像:   ${appImageTag}"
    log_info "Nginx 镜像: ${nginxImageTag}"
    log_info ""
    log_info "部署步骤:"
    log_info "  1. scp ${packageName} user@server:/opt/t3-app/"
    log_info "  2. ./deploy/manage.sh update ${packageName}"
    log_info "=========================================="
}

# 执行主函数
main "$@"

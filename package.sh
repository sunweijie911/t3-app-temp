#!/bin/bash

# 一键构建 Docker 镜像并打包部署文件
# 用法: ./package.sh [--skip-build]
#   --skip-build  跳过 pnpm build，直接使用已有构建产物

set -euo pipefail

# 日志函数
log_info() { echo -e "\033[0;32m[INFO]\033[0m $*"; }
log_warn() { echo -e "\033[0;33m[WARN]\033[0m $*"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $*" >&2; }

# 清理函数
cleanup() {
    log_info "Cleaning up temporary files..."
    rm -rf deploy_package build_info.sh
}

# 错误处理
handle_error() {
    log_error "An error occurred on line $1"
    cleanup
    exit 1
}

# 设置错误处理
trap 'handle_error $LINENO' ERR
trap cleanup EXIT

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

# 构建 Next.js 应用（在 Docker 内完成）
build_docker_image() {
    log_info "Building Docker image..."
    docker build -t "${imageTagName}" .
}

# 准备部署文件
prepare_deployment_files() {
    log_info "Preparing deployment files..."
    mkdir -p deploy_package
    cp deploy/manage.sh deploy_package/

    # 保存镜像
    local saved_image_name="${imageTagName//:/\_}.tar"
    docker save "${imageTagName}" -o "deploy_package/${saved_image_name}"

    # 计算 MD5 并写入构建信息
    local md5
    if command -v md5sum >/dev/null 2>&1; then
        md5=$(md5sum "deploy_package/${saved_image_name}" | awk '{ print $1 }')
    else
        md5=$(md5 -q "deploy_package/${saved_image_name}")
    fi

    cat > deploy_package/build_info.sh << EOF
hash=${gitHash}
build_at=${dateTime}
branch=${gitBranch}
image_tag=${imageTagName}
docker_md5=${md5}
EOF
}

# 主函数
main() {
    local start_time=$(date +%s)

    # 解析参数
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --skip-build)
                log_warn "--skip-build is not applicable (build happens inside Docker)"
                shift
                ;;
            *)
                log_error "未知参数: $1"
                echo "用法: $0"
                exit 1
                ;;
        esac
    done

    # 检查依赖
    check_requirements

    # 定义变量
    gitBranch=$(git rev-parse --abbrev-ref HEAD)
    gitHash=$(git rev-parse --short HEAD)
    dateTime=$(date "+%Y-%m-%d_%H-%M-%S")
    imagePrefix='t3-app'
    imageTagName="${imagePrefix}:${gitHash}"
    packageName="${imagePrefix}_${gitHash}_${dateTime}.tar.gz"

    log_info "=========================================="
    log_info "构建信息:"
    log_info "  分支: ${gitBranch}"
    log_info "  Hash: ${gitHash}"
    log_info "  镜像: ${imageTagName}"
    log_info "=========================================="

    # 执行构建步骤
    build_docker_image
    prepare_deployment_files

    # 创建部署包
    log_info "Creating deployment package..."
    tar -czf "${packageName}" deploy_package

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    log_info "=========================================="
    log_info "Successfully completed in ${duration} seconds!"
    log_info "Deployment package: ${packageName}"
    log_info "Docker image: ${imageTagName}"
    log_info "=========================================="
}

# 执行主函数
main "$@"

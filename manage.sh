#!/bin/bash

# 生产环境管理脚本
# 用法: ./manage.sh [init|update|start|stop|restart|status|logs|health|clean|help]

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 切换到脚本所在目录（与 docker-compose.yml 同级）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 加载环境变量
# .env: 应用配置（DATABASE_URL、密钥等）+ HOST_PORT
# build_info.sh: 镜像版本（APP_IMAGE、NGINX_IMAGE）
if [ -f ".env" ]; then
    set -a; source .env; set +a
fi
if [ -f "build_info.sh" ]; then
    set -a; source build_info.sh; set +a
fi

PORT="${HOST_PORT:-5000}"

# 日志函数
log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_blue() { echo -e "${BLUE}[INFO]${NC} $*"; }

# 检查 Docker 和 Docker Compose
check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed."
        exit 1
    fi
    if ! docker compose version >/dev/null 2>&1; then
        log_error "Docker Compose is not available."
        exit 1
    fi
}

# ── 首次部署初始化 ──────────────────────────────────────────

init_deployment() {
    log_info "初始化部署环境..."

    # 检查 .env
    if [ -f ".env" ]; then
        log_info ".env 已存在，跳过创建"
    elif [ -f ".env.example" ]; then
        cp .env.example .env
        log_warn ".env 已从模板创建，请编辑填入生产配置："
        log_blue "  vi ${SCRIPT_DIR}/.env"
        log_blue ""
        log_blue "  必填项："
        log_blue "    DATABASE_URL        — PostgreSQL 连接串"
        log_blue "    BETTER_AUTH_SECRET   — openssl rand -base64 32"
        log_blue "    BETTER_AUTH_URL      — 应用访问地址"
    else
        log_warn "未找到 .env.example 模板，请手动创建 .env 文件"
    fi

    # 检查 build_info.sh
    if [ -f "build_info.sh" ]; then
        log_info "build_info.sh 已存在（当前镜像版本配置）"
    else
        log_info "build_info.sh 尚未创建，请先执行 update 命令加载部署包"
    fi

    # 检查 docker-compose.yml
    if [ -f "docker-compose.yml" ]; then
        log_info "docker-compose.yml 已就绪"
    else
        log_warn "docker-compose.yml 不存在，将在首次 update 时从部署包中复制"
    fi

    log_info ""
    log_info "初始化完成。下一步："
    log_blue "  1. 编辑 .env 填入生产配置"
    log_blue "  2. 执行 ./manage.sh update <部署包.tar.gz>"
}

# ── 从部署包更新 ────────────────────────────────────────────

update_deploy() {
    local pkg_file="${1:-}"

    # 验证参数
    if [ -z "$pkg_file" ]; then
        log_error "请指定部署包文件"
        log_info "用法: $0 update <package.tar.gz>"
        exit 1
    fi

    if [ ! -f "$pkg_file" ]; then
        log_error "部署包文件不存在: $pkg_file"
        exit 1
    fi

    if [ ! -r "$pkg_file" ]; then
        log_error "部署包文件不可读: $pkg_file"
        exit 1
    fi

    # 解压到临时目录
    local tmp_dir
    tmp_dir=$(mktemp -d /tmp/t3-deploy-XXXX)
    trap "rm -rf '$tmp_dir'" EXIT

    log_info "解压部署包..."
    tar -xzf "$pkg_file" -C "$tmp_dir"

    # 定位解压后的目录（可能是 deploy_package/ 子目录）
    local pkg_dir="$tmp_dir"
    if [ -d "$tmp_dir/deploy_package" ]; then
        pkg_dir="$tmp_dir/deploy_package"
    fi

    # 验证 build_info.sh 存在
    if [ ! -f "$pkg_dir/build_info.sh" ]; then
        log_error "无效的部署包：缺少 build_info.sh"
        exit 1
    fi

    # 读取构建信息
    local COMMIT_HASH="" BUILD_AT="" BRANCH="" APP_IMAGE="" NGINX_IMAGE=""
    source "$pkg_dir/build_info.sh"

    if [ -z "$APP_IMAGE" ] || [ -z "$NGINX_IMAGE" ]; then
        log_error "build_info.sh 缺少镜像信息（APP_IMAGE / NGINX_IMAGE）"
        exit 1
    fi

    log_info "=========================================="
    log_info "部署包信息:"
    log_info "  分支:       ${BRANCH:-unknown}"
    log_info "  Commit:     ${COMMIT_HASH:-unknown}"
    log_info "  构建时间:   ${BUILD_AT:-unknown}"
    log_info "  App 镜像:   ${APP_IMAGE}"
    log_info "  Nginx 镜像: ${NGINX_IMAGE}"
    log_info "=========================================="

    # 加载 Docker 镜像
    log_info "加载 Docker 镜像..."
    local app_tar="" nginx_tar=""
    for f in "$pkg_dir"/t3-app_*.tar; do
        [ -f "$f" ] && app_tar="$f" && break
    done
    for f in "$pkg_dir"/t3-app-nginx_*.tar; do
        [ -f "$f" ] && nginx_tar="$f" && break
    done

    if [ -z "$app_tar" ] || [ -z "$nginx_tar" ]; then
        log_error "部署包中缺少镜像 tar 文件"
        exit 1
    fi

    docker load -i "$app_tar"
    log_info "App 镜像加载完成"
    docker load -i "$nginx_tar"
    log_info "Nginx 镜像加载完成"

    # 备份当前 build_info.sh（用于回滚）
    local is_first_deploy=false
    if [ -f "build_info.sh" ]; then
        cp build_info.sh build_info.sh.bak
        log_info "已备份当前 build_info.sh → build_info.sh.bak"
    else
        is_first_deploy=true
    fi
    [ -f "docker-compose.yml" ] && cp docker-compose.yml docker-compose.yml.bak
    [ -f "nginx.conf" ] && cp nginx.conf nginx.conf.bak

    # 从包中更新文件（不覆盖 .env）
    cp "$pkg_dir/build_info.sh" build_info.sh
    log_info "已更新 build_info.sh"

    if [ -f "$pkg_dir/docker-compose.yml" ]; then
        cp "$pkg_dir/docker-compose.yml" docker-compose.yml
        log_info "已更新 docker-compose.yml"
    fi
    if [ -f "$pkg_dir/nginx.conf" ]; then
        cp "$pkg_dir/nginx.conf" nginx.conf
        log_info "已更新 nginx.conf"
    fi
    if [ -f "$pkg_dir/manage.sh" ]; then
        cp "$pkg_dir/manage.sh" manage.sh
        chmod +x manage.sh
        log_info "已更新 manage.sh"
    fi
    if [ -f "$pkg_dir/.env.example" ]; then
        cp "$pkg_dir/.env.example" .env.example
    fi

    # 重新加载 build_info.sh
    set -a; source build_info.sh; set +a

    # 显式提示 .env 不被覆盖
    log_info "保留现有 .env 不覆盖（生产环境配置由运维手动管理）"

    # 对比 .env.example 与 .env，提示缺少的变量
    check_env_diff

    # 检查 .env 是否存在（首次部署可能还没有）
    if [ ! -f ".env" ]; then
        log_warn ".env 文件不存在！服务启动可能失败"
        log_warn "请先执行: $0 init"
    fi

    # 启动/更新服务
    log_info "重新创建容器..."
    local up_ok=true
    docker compose up -d --force-recreate || up_ok=false

    # 健康检查
    log_info "等待服务就绪（10s）..."
    sleep 10
    if [ "$up_ok" = true ] && health_check 3; then
        rm -f build_info.sh.bak docker-compose.yml.bak nginx.conf.bak
        log_info "=========================================="
        log_info "更新成功！当前版本: ${COMMIT_HASH:-${APP_IMAGE##*:}}"
        log_info "=========================================="
        # 清理悬空镜像
        docker image prune -f >/dev/null 2>&1 || true
    else
        log_error "健康检查失败！"
        if [ "$is_first_deploy" = true ]; then
            rm -f docker-compose.yml.bak nginx.conf.bak
            log_error "首次部署失败，请检查 .env 配置和容器日志："
            log_blue "  $0 logs"
            exit 1
        fi
        # 非首次部署：回滚到上一版本
        log_error "正在回滚到上一版本..."
        mv build_info.sh.bak build_info.sh
        [ -f "docker-compose.yml.bak" ] && mv docker-compose.yml.bak docker-compose.yml
        [ -f "nginx.conf.bak" ] && mv nginx.conf.bak nginx.conf
        set -a; source build_info.sh; set +a
        if docker compose up -d --force-recreate; then
            log_error "已回滚到上一版本，请检查新版本问题"
        else
            log_error "回滚也失败！请手动检查容器状态"
        fi
        exit 1
    fi
}

# 对比 .env.example 和 .env，提示缺少的变量
check_env_diff() {
    if [ ! -f ".env.example" ] || [ ! -f ".env" ]; then
        return 0
    fi

    local missing=""
    while IFS= read -r line; do
        # 跳过注释和空行
        [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
        # 提取变量名
        local var_name="${line%%=*}"
        # 检查 .env 中是否存在该变量（不管有没有值）
        if ! grep -q "^${var_name}=" .env 2>/dev/null; then
            missing="${missing}  ${var_name}\n"
        fi
    done < .env.example

    if [ -n "$missing" ]; then
        log_warn "以下变量在 .env.example 中存在但 .env 中缺失："
        echo -e "$missing"
        log_warn "如果是新增的配置项，请手动添加到 .env 中"
    fi
}

# ── 从远程仓库拉取部署（CI 使用）────────────────────────────

pull_deploy() {
    local app_image="${1:-}"
    local nginx_image="${2:-}"

    if [ -z "$app_image" ] || [ -z "$nginx_image" ]; then
        log_error "请指定 App 和 Nginx 镜像"
        log_info "用法: $0 pull-deploy <app_image> <nginx_image>"
        exit 1
    fi

    log_info "=========================================="
    log_info "拉取部署:"
    log_info "  App 镜像:   ${app_image}"
    log_info "  Nginx 镜像: ${nginx_image}"
    log_info "=========================================="

    # 备份当前 build_info.sh（用于回滚）
    local is_first_deploy=false
    if [ -f "build_info.sh" ]; then
        cp build_info.sh build_info.sh.bak
        log_info "已备份当前 build_info.sh → build_info.sh.bak"
    else
        is_first_deploy=true
    fi

    # 生成新的 build_info.sh
    cat > build_info.sh << EOF
APP_IMAGE="${app_image}"
NGINX_IMAGE="${nginx_image}"
EOF
    log_info "已更新 build_info.sh"

    # 重新加载环境变量
    set -a; source build_info.sh; set +a

    # 拉取镜像
    log_info "拉取镜像..."
    if ! docker compose pull; then
        log_error "镜像拉取失败"
        if [ "$is_first_deploy" = false ]; then
            mv build_info.sh.bak build_info.sh
            log_info "已恢复 build_info.sh"
        fi
        exit 1
    fi

    # 启动/更新服务
    log_info "重新创建容器..."
    local up_ok=true
    docker compose up -d --force-recreate --remove-orphans || up_ok=false

    # 健康检查
    log_info "等待服务就绪（10s）..."
    sleep 10
    if [ "$up_ok" = true ] && health_check 3; then
        rm -f build_info.sh.bak
        log_info "=========================================="
        log_info "部署成功！当前版本: ${app_image##*:}"
        log_info "=========================================="
        docker image prune -f >/dev/null 2>&1 || true
    else
        log_error "健康检查失败！"
        if [ "$is_first_deploy" = true ]; then
            log_error "首次部署失败，请检查 .env 配置和容器日志："
            log_blue "  $0 logs"
            exit 1
        fi
        log_error "正在回滚到上一版本..."
        mv build_info.sh.bak build_info.sh
        set -a; source build_info.sh; set +a
        docker compose pull || log_warn "拉取旧版镜像失败，将尝试使用本地缓存"
        if docker compose up -d --force-recreate; then
            log_error "已回滚到上一版本，请检查新版本问题"
        else
            log_error "回滚也失败！请手动检查容器状态"
        fi
        exit 1
    fi
}

# ── 服务管理 ────────────────────────────────────────────────

# 启动服务
start_services() {
    log_info "Starting services..."
    docker compose up -d
    log_info "Services started!"
    log_blue "Access the application at: http://localhost:${PORT}"
    show_status
}

# 停止服务
stop_services() {
    log_info "Stopping services..."
    docker compose down
    log_info "Services stopped"
}

# 重启服务
restart_services() {
    log_info "Restarting services..."
    docker compose down
    docker compose up -d
    log_info "Services restarted!"
    show_status
}

# 显示状态
show_status() {
    log_blue "Service Status:"
    docker compose ps
}

# 显示日志
show_logs() {
    local service="${1:-}"
    if [ -n "$service" ]; then
        docker compose logs -f "$service"
    else
        docker compose logs -f
    fi
}

# ── 健康检查 ────────────────────────────────────────────────

health_check() {
    local max_retries="${1:-1}"
    local url="http://localhost:${PORT}/api/health"

    for i in $(seq 1 "$max_retries"); do
        local status
        status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)
        if [ "$status" = "200" ]; then
            log_info "Health check passed (attempt ${i}/${max_retries})"
            curl -s "$url" | python3 -m json.tool 2>/dev/null || curl -s "$url"
            return 0
        fi
        if [ "$i" -lt "$max_retries" ]; then
            log_warn "Health check attempt ${i}/${max_retries} failed (status=${status}), retrying in 5s..."
            sleep 5
        fi
    done

    log_error "Health check failed (status=${status:-unknown})"
    return 1
}

# ── 清理 ────────────────────────────────────────────────────

clean_images() {
    log_info "清理前磁盘占用："
    docker system df
    echo ""
    log_info "清理悬空镜像..."
    docker image prune -f
    echo ""
    log_info "清理后磁盘占用："
    docker system df
}

# ── 帮助 ────────────────────────────────────────────────────

show_help() {
    cat <<EOF
${BLUE}生产环境管理脚本${NC}

Usage: $0 [COMMAND]

${GREEN}部署命令:${NC}
  init              首次部署初始化（创建 .env、检查环境）
  update <pkg>      从离线部署包更新（docker load + 更新配置 + 重启）
  pull-deploy <app> <nginx>  从远程仓库拉取部署（CI 使用，docker pull + 重启）

${GREEN}服务管理:${NC}
  start             启动所有服务
  stop              停止所有服务
  restart           重启所有服务

${GREEN}状态查看:${NC}
  status            查看服务状态
  logs [service]    查看日志（可选指定服务: t3-app, t3-nginx）
  health            健康检查

${GREEN}维护:${NC}
  clean             清理悬空 Docker 镜像，释放磁盘空间
  help              显示此帮助信息

${GREEN}版本回退:${NC}
  回退方式：上传旧版本部署包，执行 ./manage.sh update <旧版本.tar.gz>

${GREEN}环境变量:${NC}
  HOST_PORT         Nginx 监听端口（在 .env 中配置，默认 5000）

${GREEN}文件说明:${NC}
  .env              应用配置（数据库、密钥、HOST_PORT 等）—— 手动管理，update 不会覆盖
  build_info.sh     镜像版本 + 构建元信息 —— update 自动管理

${GREEN}示例:${NC}
  $0 init                                    # 首次部署初始化
  $0 update t3-app_abc1234_2026-03-26.tar.gz # 从部署包更新
  $0 update t3-app_old_hash_2026-03-20.tar.gz # 回退到旧版本
  $0 status                                  # 查看服务状态
  $0 logs t3-app                             # 查看 App 日志
  $0 health                                  # 健康检查
  $0 clean                                   # 清理悬空镜像

EOF
}

# ── 主函数 ──────────────────────────────────────────────────

main() {
    check_docker

    local command="${1:-help}"

    case "$command" in
        init)           init_deployment ;;
        update)         update_deploy "${2:-}" ;;
        pull-deploy)    pull_deploy "${2:-}" "${3:-}" ;;
        start)          start_services ;;
        stop)           stop_services ;;
        restart)        restart_services ;;
        status)         show_status ;;
        logs)           show_logs "${2:-}" ;;
        health)         health_check "${2:-1}" ;;
        clean)          clean_images ;;
        help|--help|-h) show_help ;;
        *)
            log_error "未知命令: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@"

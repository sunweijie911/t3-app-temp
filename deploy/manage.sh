#!/bin/bash

# Docker Compose 管理脚本
# 用法: ./manage.sh [build|start|stop|restart|deploy|update|status|logs|pull|health|history|rollback|clean|help]

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 切换到 docker-compose.yml 所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(dirname "$SCRIPT_DIR")"
cd "$COMPOSE_DIR"

# 加载环境变量（.env 供 docker compose 使用，.deploy.env 供 CI 部署使用）
if [ -f ".env" ]; then
    set -a; source .env; set +a
fi
if [ -f ".deploy.env" ]; then
    set -a; source .deploy.env; set +a
fi

PORT="${HOST_PORT:-5000}"
HISTORY_MAX="${HISTORY_MAX:-10}"
[ "$HISTORY_MAX" -lt 2 ] && HISTORY_MAX=2
HISTORY_FILE="${COMPOSE_DIR}/.deploy-history"

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

# 封装 docker compose 命令，自动处理 profile
compose_cmd() {
    local profile="${1:-}"
    shift
    if [ "$profile" = "dev" ]; then
        docker compose --profile dev "$@"
    else
        docker compose "$@"
    fi
}

# 构建镜像
build_images() {
    log_info "Building images..."
    docker compose build
    log_info "Images built successfully"
}

# 启动服务
start_services() {
    local profile="${1:-}"
    log_info "Starting services..."
    compose_cmd "$profile" up -d
    log_info "Services started!"
    log_blue "Access the application at: http://localhost:${PORT}"
    show_status
}

# 停止服务
stop_services() {
    local profile="${1:-}"
    log_info "Stopping services..."
    compose_cmd "$profile" down
    log_info "Services stopped"
}

# 重启服务
restart_services() {
    local profile="${1:-}"
    log_info "Restarting services..."
    compose_cmd "$profile" down
    compose_cmd "$profile" up -d
    log_info "Services restarted!"
    show_status
}

# 构建 + 启动（一键部署）
deploy_services() {
    local profile="${1:-}"
    build_images
    log_info "Recreating services..."
    compose_cmd "$profile" up -d --force-recreate
    log_info "Deploy complete!"
    log_blue "Access the application at: http://localhost:${PORT}"
    show_status
    log_info "Running health check in 10s..."
    sleep 10
    health_check 3
    save_deploy_history
}

# 更新代码并重新部署
update_deploy() {
    local profile="${1:-}"
    log_info "Pulling latest code..."
    git pull || { log_error "Git pull failed, aborting deploy"; exit 1; }
    deploy_services "$profile"
}

# 显示状态（始终带 --profile dev，对非 dev 模式无影响）
show_status() {
    log_blue "Service Status:"
    docker compose --profile dev ps
}

# 显示日志（始终带 --profile dev，使 db 服务可查）
show_logs() {
    local service="${1:-}"
    if [ -n "$service" ]; then
        docker compose --profile dev logs -f "$service"
    else
        docker compose --profile dev logs -f
    fi
}

# 拉取镜像
pull_images() {
    if [ -z "${APP_IMAGE:-}" ] || [ -z "${NGINX_IMAGE:-}" ]; then
        log_error "镜像未配置。请先通过 CI 部署，或手动设置环境变量"
        log_info "Usage: APP_IMAGE=ghcr.io/... NGINX_IMAGE=ghcr.io/... $0 pull"
        exit 1
    fi
    log_info "Pulling images..."
    docker compose pull
    log_info "Images pulled successfully"
    save_deploy_history
}

# 健康检查
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

# 记录部署历史
save_deploy_history() {
    local app_image="${APP_IMAGE:-}"
    if [ -z "$app_image" ]; then
        return 0
    fi
    local nginx_image="${NGINX_IMAGE:-}"
    local version="${app_image##*:}"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S")
    local new_line="${timestamp}|${version}|${app_image}|${nginx_image}"

    if [ -f "$HISTORY_FILE" ]; then
        # 去重：移除同版本的旧记录，保留最近 N-1 条
        local max_old=$((HISTORY_MAX - 1))
        grep -vF "|${version}|" "$HISTORY_FILE" | head -"$max_old" > "${HISTORY_FILE}.tmp" 2>/dev/null || true
        echo "$new_line" | cat - "${HISTORY_FILE}.tmp" > "$HISTORY_FILE"
        rm -f "${HISTORY_FILE}.tmp"
    else
        echo "$new_line" > "$HISTORY_FILE"
    fi
    log_info "部署记录已保存 (版本: ${version})"
}

# 查看部署历史
show_history() {
    if [ ! -f "$HISTORY_FILE" ] || [ ! -s "$HISTORY_FILE" ]; then
        log_warn "暂无部署历史记录"
        return 0
    fi
    log_blue "部署历史（最近 ${HISTORY_MAX} 条）："
    printf "  %-4s %-22s %-14s %s\n" "#" "时间" "版本" "镜像"
    printf "  %-4s %-22s %-14s %s\n" "---" "--------------------" "------------" "----"
    local idx=0
    while IFS='|' read -r ts ver app_img _nginx_img; do
        idx=$((idx + 1))
        local mark=""
        if [ "$idx" -eq 1 ]; then
            mark=" ← 当前"
        fi
        printf "  %-4s %-22s %-14s %s%s\n" "$idx" "${ts/T/ }" "$ver" "$app_img" "$mark"
    done < "$HISTORY_FILE"
}

# 回退到指定版本
rollback_service() {
    local target_ver="${1:-}"
    local target_line=""

    if [ ! -f "$HISTORY_FILE" ] || [ ! -s "$HISTORY_FILE" ]; then
        log_error "无部署历史记录，无法回退"
        exit 1
    fi

    local total
    total=$(wc -l < "$HISTORY_FILE" | tr -d ' ')

    if [ -z "$target_ver" ]; then
        # 无参数：回退到上一个版本（第 2 行）
        if [ "$total" -lt 2 ]; then
            log_error "只有一条部署记录，没有可回退的版本"
            exit 1
        fi
        target_line=$(sed -n '2p' "$HISTORY_FILE")
    else
        # 有参数：匹配版本标识
        target_line=$(grep -F "|${target_ver}|" "$HISTORY_FILE" | head -1 || true)
        if [ -z "$target_line" ]; then
            log_error "未找到版本 '${target_ver}' 的部署记录"
            log_info "使用 '$0 history' 查看可用版本"
            exit 1
        fi
    fi

    local target_ts target_version target_app target_nginx
    target_ts=$(echo "$target_line" | cut -d'|' -f1)
    target_version=$(echo "$target_line" | cut -d'|' -f2)
    target_app=$(echo "$target_line" | cut -d'|' -f3)
    target_nginx=$(echo "$target_line" | cut -d'|' -f4)

    # 检查是否与当前版本相同
    local current_version="${APP_IMAGE:+${APP_IMAGE##*:}}"
    if [ "$target_version" = "$current_version" ]; then
        log_warn "当前已是版本 ${target_version}，无需回退"
        return 0
    fi

    log_info "回退目标："
    log_blue "  版本: ${target_version}"
    log_blue "  时间: ${target_ts/T/ }"
    log_blue "  App:  ${target_app}"
    log_blue "  Nginx: ${target_nginx}"

    # 备份当前 .deploy.env
    cp .deploy.env .deploy.env.bak
    log_info "已备份当前配置到 .deploy.env.bak"

    # 更新 .deploy.env（保留 HOST_PORT）
    printf 'APP_IMAGE=%s\nNGINX_IMAGE=%s\nHOST_PORT=%s\n' \
        "$target_app" "$target_nginx" "$PORT" > .deploy.env

    # 重新加载环境变量
    set -a; source .deploy.env; set +a

    # 拉取目标版本镜像
    log_info "拉取目标版本镜像..."
    if ! docker compose pull 2>/dev/null; then
        log_error "镜像拉取失败，可能已从仓库中删除"
        mv .deploy.env.bak .deploy.env
        log_info "已恢复原配置"
        exit 1
    fi

    # 重新创建容器
    log_info "重新创建容器..."
    local up_ok=true
    docker compose up -d --force-recreate || up_ok=false

    # 健康检查
    log_info "等待服务就绪..."
    sleep 5
    if [ "$up_ok" = true ] && health_check 3; then
        rm -f .deploy.env.bak
        save_deploy_history
        log_info "回退成功！当前版本: ${target_version}"
        # 清理悬空镜像
        docker image prune -f >/dev/null 2>&1 || true
    else
        log_error "回退后健康检查失败，正在恢复到回退前版本..."
        mv .deploy.env.bak .deploy.env
        set -a; source .deploy.env; set +a
        docker compose pull 2>/dev/null || true
        if docker compose up -d --force-recreate; then
            log_error "已恢复到回退前版本，请检查目标版本是否存在问题"
        else
            log_error "恢复也失败！服务可能处于宕机状态，请手动检查容器状态"
        fi
        exit 1
    fi
}

# 清理悬空 Docker 镜像
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

# 显示帮助
show_help() {
    cat <<EOF
${BLUE}Docker Compose Management Script${NC}

Usage: $0 [COMMAND]

${GREEN}Commands:${NC}
  build           Build Docker images locally
  start [dev]     Start all services (add 'dev' to include database)
  stop [dev]      Stop all services (add 'dev' to include database)
  restart [dev]   Restart all services (add 'dev' to include database)
  deploy [dev]    Build + start (one-step deploy, add 'dev' to include database)
  update [dev]    Git pull + build + start (update & redeploy)
  status          Show service status
  logs [svc]      Show logs (optionally for a specific service: t3-app, t3-nginx, db)
  pull            Pull images from registry
  health          Run health check against /api/health
  history         查看部署历史记录
  rollback [ver]  回退到上一版本，或指定版本（ver 为镜像 tag）
  clean           清理悬空 Docker 镜像，释放磁盘空间
  help            Show this help message

${GREEN}Environment Variables:${NC}
  HOST_PORT     Host port for nginx (default: 5000)
  APP_IMAGE     App image (for pull command)
  NGINX_IMAGE   Nginx image (for pull command)
  HISTORY_MAX   部署历史保留条数 (default: 10)

${GREEN}Examples:${NC}
  $0 deploy dev               # First deploy (build + start with database)
  $0 update dev               # Pull code + rebuild + restart
  $0 start dev                # Start services with database
  $0 logs t3-app              # View app logs only
  $0 health                   # Run health check
  $0 restart                  # Restart all services
  $0 history                  # 查看部署历史
  $0 rollback                 # 回退到上一个版本
  $0 rollback abc1234         # 回退到指定版本
  $0 clean                    # 清理悬空镜像

EOF
}

# 主函数
main() {
    check_docker

    local command="${1:-help}"

    case "$command" in
        build)          build_images ;;
        start)          start_services "${2:-}" ;;
        stop)           stop_services "${2:-}" ;;
        restart)        restart_services "${2:-}" ;;
        deploy)         deploy_services "${2:-}" ;;
        update)         update_deploy "${2:-}" ;;
        status)         show_status ;;
        logs)           show_logs "${2:-}" ;;
        pull)           pull_images ;;
        health)         health_check "${2:-1}" ;;
        history)        show_history ;;
        rollback)       rollback_service "${2:-}" ;;
        clean)          clean_images ;;
        help|--help|-h) show_help ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@"

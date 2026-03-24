#!/bin/bash

# Docker Compose 管理脚本
# 用法: ./manage.sh [build|start|stop|restart|deploy|update|status|logs|pull|health|help]

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

# 加载 CI 部署写入的镜像配置
if [ -f ".deploy.env" ]; then
    set -a; source .deploy.env; set +a
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
  help            Show this help message

${GREEN}Environment Variables:${NC}
  HOST_PORT     Host port for nginx (default: 5000)
  APP_IMAGE     App image (for pull command)
  NGINX_IMAGE   Nginx image (for pull command)

${GREEN}Examples:${NC}
  $0 deploy dev               # First deploy (build + start with database)
  $0 update dev               # Pull code + rebuild + restart
  $0 start dev                # Start services with database
  $0 logs t3-app              # View app logs only
  $0 health                   # Run health check
  $0 restart                  # Restart all services

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

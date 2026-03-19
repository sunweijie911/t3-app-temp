#!/bin/bash

# Docker Compose 管理脚本
# 用法: ./manage.sh [start|stop|restart|status|logs|health|pull]

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
    docker compose stop
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
  start       Start all services
  stop        Stop all services
  restart     Restart all services (down + up)
  status      Show service status
  logs [svc]  Show logs (optionally for a specific service: t3-app, t3-nginx, db)
  pull        Pull images from registry
  health      Run health check against /api/health
  help        Show this help message

${GREEN}Environment Variables:${NC}
  HOST_PORT     Host port for nginx (default: 5000)
  APP_IMAGE     App image (for pull command)
  NGINX_IMAGE   Nginx image (for pull command)

${GREEN}Examples:${NC}
  $0 start                    # Start all services
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
        start)          start_services ;;
        stop)           stop_services ;;
        restart)        restart_services ;;
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

#!/bin/bash

# Docker 容器管理脚本
# 用法: ./manage.sh [start|stop|restart|remove|status|logs|build]

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置变量
CONTAINER_NAME="t3-app"
IMAGE_NAME="${IMAGE_NAME:-t3-app:local}"
PORT="${PORT:-3000}"
APP_PORT=3000

# 日志函数
log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_blue() { echo -e "${BLUE}[INFO]${NC} $*"; }

# 检查 Docker 是否安装
check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
}

# 检查容器是否存在
container_exists() {
    docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# 检查容器是否运行
container_running() {
    docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# 检查镜像是否存在
image_exists() {
    docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${IMAGE_NAME}$"
}

# 加载镜像（从 tar 文件）
load_image() {
    local tar_file=$(find . -name "t3-app*.tar" -type f | head -1)

    if [ -n "$tar_file" ]; then
        log_info "Found Docker image tar: $tar_file"
        log_info "Loading Docker image..."
        docker load -i "$tar_file"

        # 获取加载的镜像名称并重新标记
        local loaded_image=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 't3-app' | head -1)
        if [ -n "$loaded_image" ] && [ "$loaded_image" != "$IMAGE_NAME" ]; then
            log_info "Tagging image as $IMAGE_NAME"
            docker tag "$loaded_image" "$IMAGE_NAME"
        fi
        return 0
    fi
    return 1
}

# 构建镜像
build_image() {
    log_info "Building Docker image..."

    cd ..

    # 检查 Dockerfile
    if [ ! -f "Dockerfile" ]; then
        log_error "Dockerfile not found."
        exit 1
    fi

    docker build -t "$IMAGE_NAME" .

    cd - >/dev/null
    log_info "Docker image built successfully: $IMAGE_NAME"
}

# 启动容器
start_container() {
    if container_running; then
        log_warn "Container '$CONTAINER_NAME' is already running"
        show_status
        return 0
    fi

    if container_exists; then
        log_info "Starting existing container '$CONTAINER_NAME'..."
        docker start "$CONTAINER_NAME"
    else
        # 检查镜像
        if ! image_exists; then
            log_warn "Docker image '$IMAGE_NAME' not found"

            # 尝试加载镜像
            if load_image; then
                log_info "Image loaded successfully"
            else
                log_info "No tar file found. Building image from source..."
                build_image
            fi
        fi

        log_info "Creating and starting container '$CONTAINER_NAME'..."
        log_blue "Mapping port: ${PORT} -> ${APP_PORT}"

        # 构建 env-file 参数
        local env_file_args=()
        if [ -f ".env" ]; then
            log_info "Loading environment variables from .env"
            env_file_args=(--env-file .env)
        fi

        docker run -d \
            --name "$CONTAINER_NAME" \
            -p "${PORT}:${APP_PORT}" \
            --add-host=host.docker.internal:host-gateway \
            "${env_file_args[@]}" \
            -e DATABASE_URL="${DATABASE_URL:-}" \
            -e BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-}" \
            --restart unless-stopped \
            "$IMAGE_NAME"
    fi

    # 等待容器启动
    sleep 2

    if container_running; then
        log_info "Container started successfully!"
        log_blue "Access the application at: http://localhost:${PORT}"
        show_status
    else
        log_error "Failed to start container"
        exit 1
    fi
}

# 停止容器
stop_container() {
    if ! container_running; then
        log_warn "Container '$CONTAINER_NAME' is not running"
        return 0
    fi

    log_info "Stopping container '$CONTAINER_NAME'..."
    docker stop "$CONTAINER_NAME"
    log_info "Container stopped successfully"
}

# 重启容器
restart_container() {
    if container_exists; then
        log_info "Restarting container '$CONTAINER_NAME'..."
        docker restart "$CONTAINER_NAME"
        sleep 2
        log_info "Container restarted successfully"
        show_status
    else
        log_warn "Container does not exist. Starting new container..."
        start_container
    fi
}

# 删除容器
remove_container() {
    if ! container_exists; then
        log_warn "Container '$CONTAINER_NAME' does not exist"
        return 0
    fi

    if container_running; then
        log_info "Stopping container first..."
        docker stop "$CONTAINER_NAME"
    fi

    log_info "Removing container '$CONTAINER_NAME'..."
    docker rm "$CONTAINER_NAME"
    log_info "Container removed successfully"
}

# 显示容器状态
show_status() {
    if container_exists; then
        log_blue "Container Status:"
        docker ps -a --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"

        if container_running; then
            echo ""
            log_blue "Quick Links:"
            echo "  Application: http://localhost:${PORT}"
        fi
    else
        log_warn "Container '$CONTAINER_NAME' does not exist"
    fi
}

# 显示容器日志
show_logs() {
    if ! container_exists; then
        log_error "Container '$CONTAINER_NAME' does not exist"
        exit 1
    fi

    log_info "Showing logs for '$CONTAINER_NAME' (press Ctrl+C to exit)..."
    docker logs -f "$CONTAINER_NAME"
}

# 显示帮助信息
show_help() {
    cat <<EOF
${BLUE}Docker Container Management Script${NC}

Usage: $0 [COMMAND]

${GREEN}Commands:${NC}
  start       Start the container (create if not exists)
  stop        Stop the running container
  restart     Restart the container
  remove      Remove the container
  status      Show container status
  logs        Show and follow container logs
  build       Build Docker image from source
  help        Show this help message

${GREEN}Environment Variables:${NC}
  PORT              Host port to bind (default: 3000)
  DATABASE_URL      PostgreSQL connection string
  BETTER_AUTH_SECRET  Auth secret key

${GREEN}Examples:${NC}
  $0 start              # Start container on port 3000
  PORT=8080 $0 start    # Start container on port 8080
  $0 stop               # Stop container
  $0 restart            # Restart container
  $0 logs               # View logs
  $0 remove             # Remove container
  $0 build              # Build image from source

${GREEN}Configuration:${NC}
  Container name: $CONTAINER_NAME
  Image name:     $IMAGE_NAME
  Default port:   $PORT

EOF
}

# 主函数
main() {
    check_docker

    local command="${1:-help}"

    case "$command" in
        start)
            start_container
            ;;
        stop)
            stop_container
            ;;
        restart)
            restart_container
            ;;
        remove|rm)
            remove_container
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs
            ;;
        build)
            build_image
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@"

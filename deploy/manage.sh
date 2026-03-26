#!/bin/bash

# 生产环境管理脚本（离线部署包模式）
# 用法: ./deploy/manage.sh [init|update|start|stop|restart|status|logs|health|history|rollback|clean|help]

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

# 加载环境变量（.env 供 docker compose 使用，.deploy.env 供部署版本管理）
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

# ── 首次部署初始化 ──────────────────────────────────────────

init_deployment() {
    log_info "初始化部署环境..."

    # 检查目录结构
    mkdir -p deploy

    # 检查 .env
    if [ -f ".env" ]; then
        log_info ".env 已存在，跳过创建"
    elif [ -f ".env.example" ]; then
        cp .env.example .env
        log_warn ".env 已从模板创建，请编辑填入生产配置："
        log_blue "  vi ${COMPOSE_DIR}/.env"
        log_blue ""
        log_blue "  必填项："
        log_blue "    DATABASE_URL        — PostgreSQL 连接串"
        log_blue "    BETTER_AUTH_SECRET   — openssl rand -base64 32"
        log_blue "    BETTER_AUTH_URL      — 应用访问地址"
    else
        log_warn "未找到 .env.example 模板，请手动创建 .env 文件"
    fi

    # 检查 .deploy.env
    if [ -f ".deploy.env" ]; then
        log_info ".deploy.env 已存在（当前镜像版本配置）"
    else
        log_info ".deploy.env 尚未创建，请先执行 update 命令加载部署包"
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
    log_blue "  2. 执行 ./deploy/manage.sh update <部署包.tar.gz>"
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
    local hash="" build_at="" branch="" app_image_tag="" nginx_image_tag=""
    source "$pkg_dir/build_info.sh"

    if [ -z "$app_image_tag" ] || [ -z "$nginx_image_tag" ]; then
        log_error "build_info.sh 缺少镜像信息（app_image_tag / nginx_image_tag）"
        exit 1
    fi

    log_info "=========================================="
    log_info "部署包信息:"
    log_info "  分支:       ${branch:-unknown}"
    log_info "  Commit:     ${hash:-unknown}"
    log_info "  构建时间:   ${build_at:-unknown}"
    log_info "  App 镜像:   ${app_image_tag}"
    log_info "  Nginx 镜像: ${nginx_image_tag}"
    log_info "=========================================="

    # 加载 Docker 镜像
    log_info "加载 Docker 镜像..."
    local app_tar_pattern nginx_tar_pattern
    # 查找镜像 tar 文件（t3-app_*.tar 和 t3-app-nginx_*.tar）
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

    # 备份当前配置（用于回滚）
    local is_first_deploy=false
    if [ -f ".deploy.env" ]; then
        cp .deploy.env .deploy.env.bak
        log_info "已备份当前 .deploy.env → .deploy.env.bak"
    else
        is_first_deploy=true
    fi
    [ -f "docker-compose.yml" ] && cp docker-compose.yml docker-compose.yml.bak
    [ -f "nginx.conf" ] && cp nginx.conf nginx.conf.bak

    # 写入新的 .deploy.env
    printf 'APP_IMAGE=%s\nNGINX_IMAGE=%s\nHOST_PORT=%s\n' \
        "$app_image_tag" "$nginx_image_tag" "$PORT" > .deploy.env
    log_info "已更新 .deploy.env"

    # 重新加载环境变量
    set -a; source .deploy.env; set +a

    # 从包中更新配置文件（不覆盖 .env）
    if [ -f "$pkg_dir/docker-compose.yml" ]; then
        cp "$pkg_dir/docker-compose.yml" docker-compose.yml
        log_info "已更新 docker-compose.yml"
    fi
    if [ -f "$pkg_dir/nginx.conf" ]; then
        cp "$pkg_dir/nginx.conf" nginx.conf
        log_info "已更新 nginx.conf"
    fi
    if [ -f "$pkg_dir/deploy/manage.sh" ]; then
        cp "$pkg_dir/deploy/manage.sh" deploy/manage.sh
        chmod +x deploy/manage.sh
        log_info "已更新 deploy/manage.sh"
    fi
    if [ -f "$pkg_dir/.env.example" ]; then
        cp "$pkg_dir/.env.example" .env.example
    fi

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
        rm -f .deploy.env.bak docker-compose.yml.bak nginx.conf.bak
        save_deploy_history
        log_info "=========================================="
        log_info "更新成功！当前版本: ${hash:-${app_image_tag##*:}}"
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
        mv .deploy.env.bak .deploy.env
        [ -f "docker-compose.yml.bak" ] && mv docker-compose.yml.bak docker-compose.yml
        [ -f "nginx.conf.bak" ] && mv nginx.conf.bak nginx.conf
        set -a; source .deploy.env; set +a
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

    # 备份当前配置（用于回滚）
    local is_first_deploy=false
    if [ -f ".deploy.env" ]; then
        cp .deploy.env .deploy.env.bak
        log_info "已备份当前 .deploy.env → .deploy.env.bak"
    else
        is_first_deploy=true
    fi

    # 写入新的 .deploy.env
    printf 'APP_IMAGE=%s\nNGINX_IMAGE=%s\nHOST_PORT=%s\n' \
        "$app_image" "$nginx_image" "$PORT" > .deploy.env
    log_info "已更新 .deploy.env"

    # 重新加载环境变量
    set -a; source .deploy.env; set +a

    # 拉取镜像
    log_info "拉取镜像..."
    if ! docker compose pull; then
        log_error "镜像拉取失败"
        if [ "$is_first_deploy" = false ]; then
            mv .deploy.env.bak .deploy.env
            log_info "已恢复 .deploy.env"
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
        rm -f .deploy.env.bak
        save_deploy_history
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
        mv .deploy.env.bak .deploy.env
        set -a; source .deploy.env; set +a
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

# ── 部署历史 ────────────────────────────────────────────────

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

# ── 回滚 ────────────────────────────────────────────────────

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

    # 检查本地是否存在目标镜像，不存在则尝试拉取（pull 模式部署的镜像可能来自远程仓库）
    for img in "$target_app" "$target_nginx"; do
        [ -z "$img" ] && continue
        if ! docker image inspect "$img" >/dev/null 2>&1; then
            log_warn "本地不存在镜像: ${img}，尝试从远程拉取..."
            if ! docker pull "$img" 2>/dev/null; then
                log_error "镜像不可用: ${img}"
                log_info "补救方式："
                log_info "  - 离线模式: 重新上传对应版本的部署包并执行 update"
                log_info "  - 在线模式: docker pull ${img} 或重新触发 CI"
                exit 1
            fi
        fi
    done

    log_info "回退目标："
    log_blue "  版本: ${target_version}"
    log_blue "  时间: ${target_ts/T/ }"
    log_blue "  App:  ${target_app}"
    log_blue "  Nginx: ${target_nginx}"

    # 备份当前 .deploy.env
    if [ ! -f ".deploy.env" ]; then
        log_error ".deploy.env 不存在，无法备份当前配置。请先执行 update 完成一次部署"
        exit 1
    fi
    cp .deploy.env .deploy.env.bak
    log_info "已备份当前配置到 .deploy.env.bak"

    # 更新 .deploy.env（保留 HOST_PORT）
    printf 'APP_IMAGE=%s\nNGINX_IMAGE=%s\nHOST_PORT=%s\n' \
        "$target_app" "$target_nginx" "$PORT" > .deploy.env

    # 重新加载环境变量
    set -a; source .deploy.env; set +a

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
        docker image prune -f >/dev/null 2>&1 || true
    else
        log_error "回退后健康检查失败，正在恢复到回退前版本..."
        mv .deploy.env.bak .deploy.env
        set -a; source .deploy.env; set +a
        if docker compose up -d --force-recreate; then
            log_error "已恢复到回退前版本，请检查目标版本是否存在问题"
        else
            log_error "恢复也失败！服务可能处于宕机状态，请手动检查容器状态"
        fi
        exit 1
    fi
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

${GREEN}版本管理:${NC}
  history           查看部署历史记录
  rollback [ver]    回退到上一版本，或指定版本（ver 为镜像 tag，如 abc1234）

${GREEN}维护:${NC}
  clean             清理悬空 Docker 镜像，释放磁盘空间
  help              显示此帮助信息

${GREEN}环境变量:${NC}
  HOST_PORT         Nginx 监听端口（默认 5000）
  HISTORY_MAX       部署历史保留条数（默认 10）

${GREEN}文件说明:${NC}
  .env              应用配置（数据库、密钥等）—— 手动管理，update 不会覆盖
  .deploy.env       镜像版本配置 —— update 自动管理
  .deploy-history   部署历史记录 —— 自动生成

${GREEN}示例:${NC}
  $0 init                                    # 首次部署初始化
  $0 update t3-app_abc1234_2026-03-26.tar.gz # 从部署包更新
  $0 status                                  # 查看服务状态
  $0 logs t3-app                             # 查看 App 日志
  $0 health                                  # 健康检查
  $0 history                                 # 查看部署历史
  $0 rollback                                # 回退到上一个版本
  $0 rollback abc1234                        # 回退到指定版本
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
        history)        show_history ;;
        rollback)       rollback_service "${2:-}" ;;
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

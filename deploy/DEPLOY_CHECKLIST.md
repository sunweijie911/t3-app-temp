# 部署 Checklist

## 1. GitHub Secrets

在仓库 **Settings → Secrets and variables → Actions** 中配置：

- [ ] `DEPLOY_SERVER_HOST` — ECS 公网 IP 或域名
- [ ] `DEPLOY_SERVER_USER` — SSH 登录用户名（如 `root`）
- [ ] `DEPLOY_SERVER_PATH` — 部署目标路径（如 `/home/deploy/workspace/t3-app-temp`）
- [ ] `DEPLOY_SSH_PRIVATE_KEY` — SSH 私钥（完整内容，包括 BEGIN/END 行）

> **注意**：镜像推送到 GHCR 使用 `GITHUB_TOKEN`，无需额外配置。

## 2. ECS 服务器准备

- [ ] 安装 Docker
- [ ] 安装 PostgreSQL 16（见下方步骤）
- [ ] 将 SSH 公钥添加到 `~/.ssh/authorized_keys`
- [ ] 创建部署目录（与 `DEPLOY_SERVER_PATH` 一致）
- [ ] 安全组放通 5000 端口（TCP 入方向）
- [ ] 安全组**不要**放通 5432 端口（数据库仅本机访问）
- [ ] 服务器可访问 `ghcr.io`（用于拉取镜像）

### PostgreSQL 安装与初始化

```bash
# 安装
sudo apt update && sudo apt install -y postgresql-16

# 创建数据库和用户
sudo -u postgres psql <<EOF
CREATE USER t3app WITH PASSWORD '替换为强密码';
CREATE DATABASE t3app OWNER t3app;
EOF

# 验证连接
psql postgresql://t3app:替换为强密码@localhost:5432/t3app -c 'SELECT 1;'

# 允许 Docker 容器通过 host.docker.internal 访问 PostgreSQL
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" /etc/postgresql/16/main/postgresql.conf
echo "host all all 172.17.0.0/16 md5" | sudo tee -a /etc/postgresql/16/main/pg_hba.conf
sudo systemctl restart postgresql
```

## 3. 应用运行时环境变量

在 ECS 部署目录下创建 `.env` 文件：

```bash
# 生成 BETTER_AUTH_SECRET
openssl rand -base64 32
```

```env
# 必填 — 用户名密码与上一步创建的一致
DATABASE_URL=postgresql://t3app:替换为强密码@host.docker.internal:5432/t3app
BETTER_AUTH_SECRET=openssl生成的随机字符串
BETTER_AUTH_URL=http://<ECS公网IP>:5000

# 可选
ADMIN_PHONES=13800138000
```

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | 本机 PostgreSQL 连接串 |
| `BETTER_AUTH_SECRET` | 生产必填 | 认证密钥，`openssl rand -base64 32` 生成 |
| `BETTER_AUTH_URL` | 生产必填 | 应用访问地址，如 `http://<IP>:5000` 或 `https://yourdomain.com` |
| `ADMIN_PHONES` | 否 | 管理员手机号，多个用逗号分隔 |

## 4. 镜像分发方式

### 方式一：GHCR（默认，推荐）

CI 自动构建镜像并推送到 `ghcr.io/<owner>/t3-app`，服务器通过 `docker pull` 拉取。

### 方式二：离线部署（fallback）

如果服务器无法访问 `ghcr.io`，使用 `package.sh` 打包离线部署包：

```bash
# 开发机：构建打包
./package.sh
# 产出: t3-app_<hash>_<timestamp>.tar.gz

# 上传到服务器
scp t3-app_*.tar.gz user@server:/opt/t3-app/

# 服务器：首次需先 init，然后 update
ssh user@server
cd /opt/t3-app
./deploy/manage.sh init          # 仅首次
./deploy/manage.sh update t3-app_*.tar.gz
```

## 5. 验证

- [ ] 推送代码到 `main`/`master`/`release/**` 分支
- [ ] 确认 Check Quality workflow 通过（4 个 job 并行运行）
- [ ] 确认 Build and Deploy workflow 成功（镜像推送到 GHCR）
- [ ] 访问 `http://<ECS_IP>:5000` 验证应用运行
- [ ] 健康检查：`curl http://<ECS_IP>:5000/api/health` 返回 `{"status":"ok"}`

# AI Interview Simulator

本地运行的 AI 模拟面试软件。它提供面试准备、候场、实时语音面试、共享白板、反馈报告和历史记录；数据保存在本机，服务只监听 `127.0.0.1`。

![面试设置页](docs/audit-screenshots/01-setup.png)

## 直接使用

### 方式一：下载 App 发布包

1. 在 GitHub 仓库右侧打开 **Releases**，下载最新的 `AI-Interview-Simulator-GitHub.zip`。
2. 解压 ZIP，不要只把 `.app` 单独移出文件夹。
3. 双击 **AI Interview Simulator.app**。
4. 如果 macOS 第一次阻止打开，请右键 App → **打开** → 再次确认 **打开**。

### 方式二：一键打开源码包

下载并解压仓库后，双击 **Start AI Interview Simulator.command**。第一次启动会自动创建本地配置、安装依赖并构建软件，耗时取决于网络速度；之后启动会复用指纹一致的健康进程，代码或 `.env` 变化时会自动重建并重启。

### Windows 一键打开

下载并解压同一个 ZIP，双击 **Start AI Interview Simulator.bat**。请保留完整文件夹，不要单独移动启动文件。Windows 第一次启动也会自动安装依赖、构建软件并打开浏览器；代码或 `.env` 变化时会自动重建并重启。

运行要求：

- macOS 12+ 或 Windows 10/11
- [Node.js 20.9+](https://nodejs.org/)（建议当前 LTS）
- [Python 3.10+](https://www.python.org/downloads/)
- 首次安装依赖时需要网络

> macOS App 是轻量启动器，必须和解压后的项目文件放在一起。当前版本不是签名公证的独立安装包。Windows 使用一键 `.bat` 启动器。

## 配置与操作

1. 启动软件后打开 **API settings**，至少配置一个实时语音服务：
   OpenAI Realtime 或 Google Gemini Live。
2. 如需自动生成面试计划，再在同一页面配置 Planning text model。
   页面把密钥直接交给本机后端写入 `.env`，不会保存或回填到浏览器。
3. 也可以手工编辑项目 `.env`；完成后重启启动器并回到
   **API settings** 检查就绪状态。
4. 返回 **Setup**，选择岗位、面试重点、时长和难度；可以粘贴题目或主题。
5. 生成计划后进入候场室，检查摄像头、麦克风，再开始面试。
6. 面试中可使用语音、文字回答和共享白板；结束后在报告页查看反馈并导出 PDF。

所有服务密钥只由后端 `.env` 持久化。API settings 表单只把新密钥
提交给 `127.0.0.1` 上的本机后端，浏览器不会持久化、回填或读取密钥。
`.env` 已被 Git 忽略，严禁把真实密钥上传到 GitHub。

## 软件包含什么

- `frontend/`：Next.js 面试界面、语音客户端和白板
- `backend/`：FastAPI 接口及模型服务连接
- `director/`：确定性的面试流程与控制规则
- `reporting/`：报告与评分逻辑
- `tests/`：后端、流程、报告和前端单元测试
- `docs/`：产品、架构、界面和验收说明

当前界面使用本地图片和短视频呈现面试官，不含 3D 模型或 WebGL 渲染器。发布 ZIP 不包含依赖缓存、构建结果、API 密钥、运行日志、历史面试记录或素材参考图。

## 手动开发

首次安装：

```bash
cp .env.example .env
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

分别启动两个服务：

```bash
npm run dev:backend
npm run dev:frontend
```

- 前端：<http://127.0.0.1:3001>
- 后端：<http://127.0.0.1:8000>
- 健康检查：<http://127.0.0.1:8000/health>

完整验证：

```bash
npm run verify
```

手工验收清单见 [docs/09_TESTING.md](docs/09_TESTING.md)，架构说明见 [docs/02_TECH_ARCHITECTURE.md](docs/02_TECH_ARCHITECTURE.md)。

## 上传 GitHub

解压发布 ZIP 后，可直接把文件上传到新仓库；更推荐使用 Git：

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

不要上传 `.env`、`.venv`、`node_modules`、`.next`、`.runtime-logs` 或 `data/interview_records`。如需给普通用户直接下载，把生成的 `AI-Interview-Simulator-GitHub.zip` 上传到 GitHub **Releases**。

维护者可运行 `./scripts/build-release.sh`，重新生成干净的发布 ZIP 和 SHA-256 校验文件。

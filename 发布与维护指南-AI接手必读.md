# 爱优特门户（aqt-portal）— 修改与发布手册

> **给接手修改本项目的 AI / 开发者必读**。看完这份文档再动手，避免破坏线上数据。
>
> 代码版本：**2026-08-21**（git `4f120bf`，含 PG jsonb 修复 + 全部安全加固）
> 线上地址：**https://aqtapp.airquality.com.cn**
> 数据状态：14 个分类 + 10 个应用，version=2

---

## ⚡ 30 秒速览（最快上手）

**这个项目发布在哪、怎么发：**

| 东西 | 是什么 | 地址 / 名称 |
|---|---|---|
| **GitHub 仓库** | 唯一的代码发布源 | `https://github.com/Julia-Wu-China/aqt-portal.git`（分支 `main`）|
| **Render 服务** | 线上运行的服务，**已存在，不要新建** | 服务名 `aqt-portal`，面板 https://dashboard.render.com → 找到 `aqt-portal` → 它已连接上面那个 GitHub 仓库 |
| **线上域名** | 用户访问的地址 | `https://aqtapp.airquality.com.cn` |

**发布 = 把代码推到上面那个 GitHub 仓库的 `main` 分支**，Render 监听 push 自动重新部署，1-3 分钟生效。Render 不需要你做任何新建操作，它的环境变量（企微密钥、数据库、管理员密码）都已配好，**新建服务反而会连不上**。

**一句话发布（推荐，自动帮你连仓库再推送）：**
```bash
cd "<当前文件夹路径>"
node _publish.js "你的改动说明"
```

**手动发布（等价，适合大改动）：**
```bash
git clone https://github.com/Julia-Wu-China/aqt-portal.git
cd aqt-portal
# ……修改代码……
git add -A
git commit -m "你的改动说明"
git push origin main
```

---

## 一、这是什么

爱优特（AQT）内部的**应用门户**：把公司常用的网页应用（云之家、纷享销客CRM、销售数据看板等）集中在一个门户里，按部门/人员做权限控制，员工用企业微信登录后一键打开。

功能：应用管理（增删改/分类归属/可见性授权）、分类管理（多级嵌套）、部门/人员权限控制、回收站、数据导出 CSV、搜索、客户只读模式。

**三个角色**：全局管理员（全部权限）/ 普通员工（看自己可见的应用）/ 客户（只看标记了客户可见的应用）。

## 二、技术栈与架构

```
浏览器 (index.html 单页，原生 JS，无框架无构建)
   │  fetch /api/*
   ▼
Node.js 后端 (server.js，express + pg，无构建步骤)
   ├─ PostgreSQL（Render 免费实例）→ 主存储 portal_store 表
   ├─ 本地文件 data/portal-store.json → 文件兜底（双写）
   ├─ 备份表 portal_store_backup → 每次 PUT 前自动备份
   └─ 企业微信 API → 登录 + 通讯录（部门/人员）
```

- 前端是**单文件** `index.html`（所有 UI/权限/本地缓存逻辑都在里面）
- 后端 `server.js` 同时托管静态文件 + 提供 API
- **无前端构建步骤**，改完直接部署生效
- 依赖仅 `pg`，包管理**必须用 yarn**（勿用 npm install）

## 三、文件职责表

| 文件 | 职责 | 需要改时 |
|---|---|---|
| `index.html` | 前端全部逻辑：UI、权限判断、分类/应用管理、本地缓存、种子注入 | 界面/交互/前端权限 |
| `server.js` | 后端：静态托管、API（登录/通讯录/portal-data/store/status）、PG+文件双写、签名校验、防清空保护 | 接口/存储/安全 |
| `package.json` / `yarn.lock` | 依赖（pg）；`yarn install` | 一般不动 |
| `render.yaml` | Render 部署配置 | 一般不动 |
| `.env.example` | 环境变量模板 | 新增变量时同步更新 |
| `data/` | 本地文件存储兜底 | 一般不动 |
| `functions/` | Cloudflare Pages 版 API（备用方案） | 一般不动 |
| `WW_verify_aluUvkMMhpVILogR.txt` | 企微域名归属校验文件 | **禁止删除** |
| `_smoke_test.js` / `_client_test.js` / `_empty_store_test.js` / `_catvis_patch_test.js` | 回归测试（共 110 项） | 改完必须跑 |
| `_backup_portal.js` | 每日备份脚本（拉线上数据存本地） | 一般不动 |
| `_publish.js` | **一键发布脚本**（自动连 GitHub 仓库并推送，触发 Render 部署） | 每次发布用：`node _publish.js "说明"` |
| `_restore_from_backup.js` | 从备份 JSON 恢复线上数据 | 数据丢失时用 |
| `_restore_apps_cli.js` / `_restore_apps_console.js` | 批量追加应用（CLI / 浏览器控制台） | 补录应用时用 |
| `备份包/` | 每日备份输出目录（企微微盘同步） | 只读 |

## 四、本地环境准备

```bash
node -v          # 需 >= 18
yarn -v          # 必须用 yarn
yarn install     # 安装依赖（只装 pg）
```

复制 `.env.example` 为 `.env` 并填变量（见第八节）。本地起服务：`node server.js`（默认端口 3001，`PORT` 可改）。

## 五、修改代码的硬性规则（违反会出事故）

1. **app.id 是字符串**（格式 `app_时间戳_随机串`），**绝不能用 `Number()` 转换**，否则变成 NaN 导致查找/保存失败。category.id、user.id 是数字，按原始类型比较。
2. **只改被指定的问题**，不要顺手重构/改样式/动无关逻辑。改前先确认预期行为。
3. **UI 偏好**：主色调 `#008CD6`（统一蓝色外观），**无 hover 变色效果**；界面要像素级对齐。
4. **数据安全优先**：前端修改数据一律走 PUT `/api/portal-data`（带乐观锁 version）；服务端写失败必须报错，不能假装成功。
5. 种子数据（13 个部门一级分类）只允许在**全新浏览器完全无数据**时注入一次，**永远不要覆盖用户已有数据**。
6. 部署到线上前**必须跑完全部测试**（见第六节），并核对线上数据（14 分类 + 10 应用）不能被清空。

## 六、测试（110 项，全过才能发布）

```bash
node _smoke_test.js      # 79 项
node _client_test.js     # 13 项
node _empty_store_test.js # 4 项
node _catvis_patch_test.js # 14 项
```

改完任何代码后 4 个都跑一遍，必须全部 PASS。另可 `node --check server.js` 查后端语法；前端内联 JS 用 `new Function(script)` 方式抽块编译检查。

## 七、发布部署流程（核心）

### 7.1 先搞清发布链路（发到哪、谁在收）

```
GitHub 仓库（唯一发布源，代码只从这里出去）
  https://github.com/Julia-Wu-China/aqt-portal.git    分支：main
        │  git push origin main
        ▼
Render Web Service（线上服务，已经挂在那个仓库上 —— 已存在，不要新建！）
  服务名：aqt-portal
  面板：https://dashboard.render.com → 服务列表找到 aqt-portal
  它已连接 GitHub 仓库 Julia-Wu-China/aqt-portal，监听 main 分支
  一旦检测到 push → 自动重新部署（自动装依赖 + node server.js，约 1-3 分钟）
  它的环境变量（企微密钥 / DATABASE_URL / ADMIN_PASSWORD）在 Render 面板已配好
        │
        ▼
线上域名（用户实际访问）
  https://aqtapp.airquality.com.cn
```

**结论：你只需要做「推到 GitHub 仓库 main 分支」这一件事，剩下的全自动。**
**⚠️ 绝对不要新建 Render 服务**——新建的服务没有环境变量，会连不上企业微信和数据库。要改动配置去面板里改现有的 `aqt-portal`。

### 7.2 方式一：一键发布脚本（推荐，AI 改完代码一条命令搞定）

> 你拿到的这个文件夹**默认不是 git 仓库**（交付包里没有 `.git`），所以直接用它自带的 `_publish.js`，脚本会自动帮你完成：连 GitHub 仓库 → 对齐历史（不覆盖你改的文件）→ 提交 → 推送。

```bash
cd "<当前文件夹路径>"
node _publish.js "你的改动说明"
```

- 第一次运行会自动 `git init` + 连接仓库，之后每次只跑这一条
- `备份包/`、`data/`、`.env` 会被自动忽略，不会传上去
- 推送需要 GitHub 凭据：首次会弹登录窗口（登录 Julia-Wu-China 账号）；失败则向门户管理员要 Token

### 7.3 方式二：手动 clone 发布（适合大改动 / 想用完整 git 流程）

```bash
# 1. 克隆仓库（如果还没克隆过）
git clone https://github.com/Julia-Wu-China/aqt-portal.git
cd aqt-portal

# 2. 修改代码（把改好的 index.html / server.js 等复制进来覆盖）

# 3. 跑测试（见第六节）

# 4. 提交并推送（推送即触发 Render 部署）
git add -A
git commit -m "你的改动说明"
git push origin main
```

### 7.4 推送后：等待 + 验证

**⚠️ Render 有时不会自动触发部署**。如果 push 后 2 分钟线上还没变化，用**空提交强制触发**：
```bash
git commit --allow-empty -m "force redeploy" && git push origin main
```
或在 Render 面板（dashboard.render.com → aqt-portal）手动点 **Deploy**。

**部署后必做验证（一条命令）：**

```bash
curl -s https://aqtapp.airquality.com.cn/api/portal-data
# 期望：version=2，categories=14，apps=10
curl -s https://aqtapp.airquality.com.cn/api/store/status
# 期望：storeMode=pg，pgOk=true，store 非 null，pgDiag 主表有数据
```

**页面验证**：用全局管理员账号打开门户 → 确认 10 个应用、14 个分类都在 → 再让普通员工（如郁王平）刷新确认。

**部署后若发现数据异常（分类/应用数量不对）：立即用备份恢复，见第九/十节。**

> 本地开发参考：`yarn install` 后 `node server.js`（默认端口 3001，`PORT` 可改）。本地起服务不会影响线上。

## 八、环境变量（Render 面板配置）

| 变量 | 说明 | 必填 |
|---|---|---|
| `WECOM_CORPID` | 企微企业 ID | 是 |
| `WECOM_CONTACT_SECRET` | 企微通讯录 Secret（读部门/人员） | 是 |
| `WECOM_APP_SECRET` | 企微自建应用 Secret（登录） | 是 |
| `WECOM_AGENT_ID` | 企微自建应用 AgentId | 是 |
| `ADMIN_PASSWORD` | **管理员签名密钥**（HMAC 签名 admin token 用）| 是 |
| `DATABASE_URL` | PostgreSQL 连接串（不填则回退文件存储，**部署会丢数据**）| 是 |
| `PORT` | 端口（默认 3001） | 否 |
| `FRONTEND_URL` | 前端域名（默认线上地址） | 否 |
| `PGSSL` | 设为 `0` 关闭 SSL（仅连接报 SSL 错误时） | 否 |

> **凭据怎么拿**：Render 面板对应服务的 Environment 里查看/修改。`ADMIN_PASSWORD` 的值**不要写进任何文档/代码**，需要时找门户管理员要，用完即忘。

## 九、数据保护机制（改代码时不能破坏）

线上数据有三层保护，改任何一层都要保持行为不变：

1. **签名 admin token**：`server.js` 用 `ADMIN_PASSWORD` 对 token 做 HMAC-SHA256 签名（格式 `admin.载荷.签名`），未签名/伪造 token 一律 401。**没有密钥就无法篡改数据。**
2. **PUT 防清空**：当前存在应用时，请求把 `apps` 清空会被 400 拒绝（除非 URL 带 `?force=1`）。防止误操作/恶意清空。
3. **空库 503 保护**：主存储（PG+文件）读不到、但备份表/备份文件有历史数据时，GET 返回 503 而不是假空——前端收到 503 保留本地数据并提示，**绝不触发种子覆盖**。

**历史事故教训（必须记住）：**
- 曾因 `readStoreFromPg` 对 jsonb 列二次 `JSON.parse`（node-postgres 已自动解析成对象）导致**永远读不到 PG 数据**，全屏文件兜底，部署重启后文件丢失 → 假空 → 前端种子覆盖 → 应用全没。**读取 PG 的 value 时必须兼容对象和字符串两种形态**。
- 种子 `apps=[]`，一旦被触发会把应用清空。所以"全新浏览器种子注入"路径已被 503 保护堵死，**不要破坏这条链**。

## 十、备份与恢复

**每日自动备份**（已配置定时任务，每天 09:30 自动跑）：
```bash
node _backup_portal.js
```
- 拉取线上数据存到 `备份包/portal-YYYY-MM-DD.json`（当前在企微微盘目录，自动同步云端）
- **只保留最近 30 份**，自动清理更早的
- 每次拉取都会让 Render 免费 PG 产生活跃连接，**防止 90 天无连接自动删库**
- 备份数据校验：分类/应用全为 0 时拒绝写入并报错

**手动恢复**（数据丢失时）：
```bash
# 需要管理员密码（找门户管理员要），密码只在本命令用，不落盘
ADMIN_PASSWORD="<密码>" node _restore_from_backup.js "<备份文件路径>"
# 例：ADMIN_PASSWORD="xxx" node _restore_from_backup.js "备份包/portal-2026-08-21.json"
```

**权威备份文件**：`D:\Desktop\爱优特应用门户备份_20260820.json`（用户手工导出的完整备份，含 14 分类 + 10 应用，是最可信的恢复源）。

## 十一、常见问题排查

| 现象 | 排查路径 |
|---|---|
| 应用/分类数量不对或全空 | `curl /api/store/status` 看 `store` 和 `pgDiag`：主表有没有数据、能否读到；再看 `backup` 有没有历史 → 有则用第九/十节恢复 |
| 登录后看不到应用 | 检查该应用 `visibility_dept_ids`/`visibility_user_ids` 是否包含该用户；全局管理员应全可见 |
| PUT 返回 409 | 乐观锁冲突：前端版本过期，刷新页面重试 |
| PUT 返回 401 | admin token 无效/过期，重新登录 |
| PUT 返回 400 "检测到清空全部应用" | 防清空保护触发，确认是否真要清空（带 `?force=1`） |
| 企微登录报错 60020 | 服务器出口 IP 不在企微应用 IP 白名单，需加白名单 |
| 部署后数据"消失" | 99% 是部署窗口期种子/旧逻辑覆盖 → 立即用备份恢复，然后查 store/status |

## 十二、交接清单（发布完成后确认）

- [ ] 4 个测试文件全部 PASS（110 项）
- [ ] 已推送 GitHub 仓库 `Julia-Wu-China/aqt-portal` 的 `main` 分支（`node _publish.js "说明"` 或手动 push）
- [ ] push 后线上 HTML 已更新（curl 首页确认新代码特征）
- [ ] `/api/portal-data` 返回 14 分类 + 10 应用
- [ ] `/api/store/status` 显示 pg 存储正常、主表非空
- [ ] 管理员和普通员工（郁王平）刷新均正常看到应用
- [ ] 每日备份任务正常（`备份包/` 下有今天的文件）

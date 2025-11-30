# 智能网络爬虫系统

一个功能强大的多线程网络爬虫系统，具备实时监控、任务管理和数据分析功能。

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Python](https://img.shields.io/badge/python-3.8+-green.svg)
![License](https://img.shields.io/badge/license-MIT-orange.svg)

## 🌟 核心特性

### 爬虫引擎
- ✅ **多线程爬取**: 支持1-10个并发线程，可配置
- ✅ **深度控制**: 可设置最大爬取深度(1-10层)
- ✅ **多种策略**: 广度优先(BFS)、深度优先(DFS)、优先级策略
- ✅ **智能去重**: URL去重和内容去重机制
- ✅ **错误重试**: 可配置的重试次数和延迟
- ✅ **请求间隔**: 防止过于频繁的请求
- ✅ **robots.txt**: 可选的robots协议遵守
- ✅ **跨域爬取**: 支持同域限制或跨域爬取
- ✅ **全文件类型**: 支持HTML、图片、PDF、视频等所有文件类型

### 任务管理
- ✅ **任务CRUD**: 创建、查看、编辑、删除任务
- ✅ **状态控制**: 开始、暂停、继续、停止任务
- ✅ **任务列表**: 显示所有任务的状态和进度
- ✅ **任务切换**: 在不同任务间快速切换监控
- ✅ **持久化**: 任务配置和状态的SQLite数据库存储

### 实时监控
- ✅ **多线程状态**: 显示每个线程的实时状态、当前URL、速度
- ✅ **进度跟踪**: 基于已发现URL总数的准确进度计算
- ✅ **流量图表**: 总流量和各线程流量的实时图表
- ✅ **统计信息**: 成功率、错误数、下载字节数、响应时间
- ✅ **智能轮询**: 根据任务状态调整监控频率

### 数据分析
- ✅ **URL记录**: 存储每个URL的状态、响应码、文件大小等
- ✅ **文件分类**: 按文件类型统计和分析
- ✅ **域名统计**: 访问的域名数量统计
- ✅ **数据导出**: 支持导出爬取结果为JSON

### 用户界面
- ✅ **响应式布局**: 适配不同屏幕尺寸
- ✅ **暗色主题**: 支持明暗主题切换
- ✅ **标签页管理**: 实时监控、结果查看、数据分析、任务管理
- ✅ **实时通信**: WebSocket实时通信和状态提醒
- ✅ **操作日志**: 详细的操作和错误日志

## 📋 系统要求

- Python 3.8+
- 现代浏览器（Chrome、Firefox、Safari、Edge）
- 2GB+ RAM
- 稳定的网络连接

## 🚀 快速开始

### 方式1: 一键启动（推荐）

**Windows用户 - 三个启动脚本任选其一:**
```bash
# 方式A: 最简单（推荐）
quick-start.bat

# 方式B: 完整版（英文界面，无乱码）
run.bat

# 方式C: 原版（可能有中文乱码）
start.bat
```

**Linux/Mac用户:**
```bash
chmod +x start.sh
./start.sh
```

### 方式2: 手动启动

**1. 克隆项目**
```bash
git clone <repository-url>
cd net3
```

**2. 创建虚拟环境**

Windows:
```bash
python -m venv venv
venv\Scripts\activate
```

Linux/Mac:
```bash
python3 -m venv venv
source venv/bin/activate
```

**3. 安装依赖**
```bash
pip install -r requirements.txt
```

**4. 启动服务**
```bash
python app.py
```

服务将在 `http://localhost:8000` 启动

### 5. 访问界面

在浏览器中打开 `http://localhost:8000`

## 📖 使用指南

### 创建任务

1. 点击侧边栏的 **"新建任务"** 按钮
2. 填写任务信息：
   - **任务名称**: 给任务起一个描述性的名称
   - **起始URL**: 爬虫的起始地址
   - **爬取策略**: 选择BFS、DFS或优先级策略
   - **最大深度**: 设置爬取的最大深度（1-10）
   - **线程数**: 设置并发线程数（1-10）
   - **请求间隔**: 设置请求之间的延迟（秒）
   - **重试次数**: 设置失败重试次数
   - **robots.txt**: 是否遵守robots协议
   - **跨域爬取**: 是否允许爬取其他域名
3. 点击 **"创建任务"**

### 启动任务

1. 在任务列表中选择一个任务
2. 点击 **"开始"** 按钮启动爬虫
3. 实时监控页面将显示爬取进度和统计信息

### 控制任务

- **暂停**: 暂停正在运行的任务
- **继续**: 继续已暂停的任务
- **停止**: 完全停止任务
- **删除**: 删除任务及其所有数据

### 查看结果

1. 切换到 **"URL列表"** 标签页
2. 查看所有已爬取的URL及其详细信息
3. 使用过滤器筛选不同状态的URL
4. 点击 **"导出"** 按钮导出数据

### 数据分析

1. 切换到 **"数据分析"** 标签页
2. 查看文件类型分布图表
3. 查看状态分布统计
4. 查看访问的域名数量

## 🏗️ 项目结构

```
net3/
├── app.py                  # 主应用文件
├── requirements.txt        # Python依赖
├── Dockerfile             # Docker配置
├── .gitignore            # Git忽略文件
├── README.md             # 项目文档
├── crawler.db            # SQLite数据库（自动生成）
├── crawler.log           # 日志文件（自动生成）
└── web/                  # 前端文件
    ├── index.html        # 主页面
    ├── css/
    │   └── style.css     # 样式文件
    └── js/
        └── app.js        # 前端逻辑
```

## 🔧 配置说明

### 爬取策略

- **广度优先(BFS)**: 先爬取同一深度的所有链接，适合全面爬取
- **深度优先(DFS)**: 先深入爬取，适合快速到达深层页面
- **优先级策略**: HTML > 图片 > 其他，适合优先获取重要内容

### 线程数建议

- **1-3个线程**: 适合小型网站或测试
- **3-5个线程**: 适合中型网站
- **5-10个线程**: 适合大型网站（注意服务器负载）

### 请求间隔

- **0.1-0.5秒**: 快速爬取（可能被封禁）
- **1-2秒**: 推荐设置
- **3-5秒**: 保守设置，适合敏感网站

## 🐳 Docker部署

### 构建镜像

```bash
docker build -t web-crawler .
```

### 运行容器

```bash
docker run -d -p 8000:8000 -v $(pwd)/data:/app/data web-crawler
```

### 使用Docker Compose

```yaml
version: '3.8'
services:
  crawler:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

```bash
docker-compose up -d
```

## 📊 API文档

### 任务管理

#### 获取所有任务
```
GET /api/v1/tasks
```

#### 创建任务
```
POST /api/v1/tasks
Content-Type: application/json

{
  "name": "任务名称",
  "url": "https://example.com",
  "strategy": "bfs",
  "max_depth": 3,
  "thread_count": 3,
  "request_interval": 1.0,
  "retry_times": 3,
  "respect_robots": true,
  "allow_cross_domain": false
}
```

#### 获取单个任务
```
GET /api/v1/tasks/{id}
```

#### 删除任务
```
DELETE /api/v1/tasks/{id}
```

#### 启动任务
```
POST /api/v1/tasks/{id}/start
```

#### 暂停任务
```
POST /api/v1/tasks/{id}/pause
```

#### 继续任务
```
POST /api/v1/tasks/{id}/resume
```

#### 停止任务
```
POST /api/v1/tasks/{id}/stop
```

### 监控数据

#### 获取实时监控数据
```
GET /api/v1/monitor/{id}/current
```

#### 获取URL列表
```
GET /api/v1/tasks/{id}/urls?page=1&page_size=50&status=completed
```

#### 获取统计信息
```
GET /api/v1/tasks/{id}/stats
```

#### 导出数据
```
GET /api/v1/tasks/{id}/export
```

## 🔍 常见问题

### Q: 爬虫被网站封禁怎么办？

A: 尝试以下方法：
1. 增加请求间隔
2. 减少线程数
3. 启用robots.txt遵守
4. 使用代理（需要自行扩展）

### Q: 如何提高爬取速度？

A: 
1. 增加线程数（注意服务器负载）
2. 减少请求间隔（注意被封禁风险）
3. 使用SSD存储数据库
4. 优化网络连接

### Q: 数据库文件太大怎么办？

A: 
1. 定期清理旧任务
2. 导出数据后删除任务
3. 使用外部数据库（需要修改代码）

### Q: 如何爬取需要登录的网站？

A: 当前版本不支持，需要扩展代码添加Cookie和Session管理

## 🛠️ 技术栈

### 后端
- **Flask**: Web框架
- **Flask-SocketIO**: WebSocket实时通信
- **SQLite**: 轻量级数据库
- **requests**: HTTP请求库
- **BeautifulSoup**: HTML解析
- **threading**: 多线程支持

### 前端
- **原生JavaScript**: 无框架依赖
- **Chart.js**: 图表组件
- **Socket.IO**: WebSocket客户端
- **CSS3**: 现代样式和动画
- **FontAwesome**: 图标库

## 📝 开发计划

- [ ] 支持代理池和IP轮换
- [ ] 支持Cookie和Session管理
- [ ] 支持JavaScript渲染（Selenium/Playwright）
- [ ] 支持分布式爬取
- [ ] 支持定时任务
- [ ] 支持数据提取规则配置
- [ ] 支持插件系统
- [ ] 支持更多数据库（MySQL、PostgreSQL）

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

1. Fork项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 👨‍💻 作者

智能网络爬虫系统开发团队

## 🙏 致谢

感谢所有开源项目的贡献者！

---

**注意**: 请遵守网站的robots.txt协议和服务条款，合理使用爬虫，不要对目标网站造成过大负担。

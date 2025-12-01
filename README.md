# 智能网络爬虫系统

一个功能强大的多线程网络爬虫系统，具备实时监控、任务管理和数据分析功能。

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Python](https://img.shields.io/badge/python-3.8+-green.svg)
![License](https://img.shields.io/badge/license-MIT-orange.svg)

---

## 📋 目录

1. [项目概述](#项目概述)
2. [开发平台与技术栈](#开发平台与技术栈)
3. [语言优势分析](#语言优势分析)
4. [系统架构设计](#系统架构设计)
5. [网络协议与通信机制](#网络协议与通信机制)
6. [RESTful API接口详解](#restful-api接口详解)
7. [模块化处理](#模块化处理)
8. [数据库设计](#数据库设计)
9. [核心功能详解](#核心功能详解)
10. [代码结构分析](#代码结构分析)
11. [快速开始](#快速开始)
12. [使用指南](#使用指南)
13. [总结与展望](#总结与展望)

---

## 项目概述

### 项目定位
功能强大的多线程网络爬虫系统，支持实时监控、任务管理、数据分析、元数据提取。

### 核心能力
- **多线程爬取**: 支持1-10个并发线程
- **实时监控**: 流量图表、线程状态、进度跟踪
- **任务管理**: 完整的任务生命周期管理
- **数据分析**: 多维度统计和可视化
- **元数据提取**: 自动提取标题、作者、摘要、关键词、发布时间

### 设计理念
- 模块化、可扩展、易维护、用户友好

### 目标用户
- 数据采集工程师、网站分析师、内容监控人员、研究人员

### 性能特点
- 高并发(1-10线程)、低延迟、智能调度、断点续爬

---

## 开发平台与技术栈

### 后端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **Python** | 3.8+ | 主开发语言 |
| **Flask** | 2.3.3 | 轻量级Web框架，提供RESTful API |
| **SQLite** | 内置 | 嵌入式关系型数据库 |
| **Threading** | 内置 | 多线程并发处理 |
| **Requests** | 2.31.0 | HTTP/HTTPS请求库 |
| **BeautifulSoup4** | 4.12.2 | HTML/XML解析 |
| **lxml** | 4.9.3 | 高性能XML/HTML解析器 |
| **Flask-CORS** | 4.0.0 | 跨域资源共享支持 |

### 前端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **HTML5** | - | 页面结构 |
| **CSS3** | - | 样式和动画，支持CSS变量主题切换 |
| **JavaScript** | ES6+ | 交互逻辑，异步请求 |
| **Chart.js** | CDN | 数据可视化图表 |
| **Font Awesome** | 6.4.0 | 图标库 |
| **JSZip** | 3.10.1 | 文件压缩导出 |

---

## 语言优势分析

### Python优势
- ✅ 丰富的爬虫生态系统(requests, BeautifulSoup, lxml)
- ✅ 简洁的语法，开发效率高
- ✅ 强大的字符串和正则处理能力
- ✅ 完善的多线程支持(threading, queue)
- ✅ 跨平台兼容性好(Windows/Linux/Mac)
- ✅ 活跃的社区和丰富的文档

### JavaScript优势
- ✅ 原生浏览器支持，无需编译
- ✅ 异步编程模型成熟(async/await, fetch)
- ✅ 丰富的DOM操作能力
- ✅ 实时数据更新和图表渲染
- ✅ 良好的用户交互体验
- ✅ 支持模块化开发

---

## 系统架构设计

### 四层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      前端展示层 (Web UI)                         │
│   index.html │ style.css │ app.js │ Chart.js │ Font Awesome     │
├─────────────────────────────────────────────────────────────────┤
│                      API接口层 (Flask REST)                      │
│   /api/v1/tasks │ /api/v1/monitor │ /api/v1/urls │ /api/v1/stats │
├─────────────────────────────────────────────────────────────────┤
│                      业务逻辑层 (Core Engine)                    │
│   CrawlerThread │ Database │ URLQueue │ MetadataExtractor       │
├─────────────────────────────────────────────────────────────────┤
│                      数据存储层 (SQLite)                         │
│   tasks表 │ url_records表 │ 索引优化 │ 外键约束                  │
└─────────────────────────────────────────────────────────────────┘
```

### 数据流向

```
用户操作 → 前端JS → HTTP请求 → Flask API → 业务逻辑 → SQLite数据库
                                    ↓
                              CrawlerThread
                                    ↓
                         HTTP请求目标网站 (requests)
                                    ↓
                         HTML解析 (BeautifulSoup)
                                    ↓
                         数据存储 → 实时监控数据 → 前端展示
```

---

## 网络协议与通信机制

### 1. HTTP/HTTPS协议

本系统基于HTTP/HTTPS协议进行网络通信，主要体现在以下方面：

#### 1.1 爬虫请求（Requests库）

```python
# 请求头配置
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive'
}

# HTTP GET请求
response = requests.get(url, headers=headers, timeout=30, allow_redirects=True)

# 响应处理
status_code = response.status_code      # HTTP状态码 (200, 404, 500等)
content_type = response.headers.get('Content-Type')  # MIME类型
content_length = len(response.content)  # 响应体大小
response_time = response.elapsed.total_seconds()  # 响应时间
```

#### 1.2 HTTP状态码处理

| 状态码 | 含义 | 系统处理 |
|--------|------|----------|
| **2xx** | 成功 | 解析内容，提取链接和元数据 |
| **3xx** | 重定向 | 自动跟随重定向(allow_redirects=True) |
| **4xx** | 客户端错误 | 记录失败，标记URL状态为failed |
| **5xx** | 服务器错误 | 重试机制，达到重试次数后标记失败 |

#### 1.3 HTTP请求方法

| 方法 | 用途 | 应用场景 |
|------|------|----------|
| **GET** | 获取资源 | 爬取网页、获取任务列表、监控数据 |
| **POST** | 创建/操作资源 | 创建任务、启动/暂停/停止任务 |
| **PUT** | 更新资源 | 更新任务配置 |
| **DELETE** | 删除资源 | 删除任务 |

### 2. RESTful API设计规范

本系统采用RESTful架构风格设计API接口：

#### 2.1 URL设计规范

```
基础路径: /api/v1/
资源命名: 使用名词复数形式
层级关系: /资源/ID/子资源

示例:
GET    /api/v1/tasks              # 获取所有任务
POST   /api/v1/tasks              # 创建新任务
GET    /api/v1/tasks/{id}         # 获取单个任务
PUT    /api/v1/tasks/{id}         # 更新任务
DELETE /api/v1/tasks/{id}         # 删除任务
POST   /api/v1/tasks/{id}/start   # 启动任务（动作）
GET    /api/v1/tasks/{id}/urls    # 获取任务的URL列表
```

#### 2.2 请求/响应格式

**请求格式**: `Content-Type: application/json`

```json
// POST /api/v1/tasks 请求体
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

**响应格式**: 统一JSON结构

```json
// 成功响应
{
    "success": true,
    "data": { ... }
}

// 失败响应
{
    "success": false,
    "error": "错误信息"
}
```

### 3. 前后端通信机制

#### 3.1 HTTP轮询（Polling）

系统采用HTTP轮询方式实现实时监控数据更新：

```javascript
// 前端轮询实现
function startPolling() {
    pollingInterval = setInterval(() => {
        if (currentTaskId) {
            fetchMonitorData(currentTaskId);
        }
    }, 2000);  // 每2秒轮询一次
}

async function fetchMonitorData(taskId) {
    const response = await fetch(`${API_BASE}/api/v1/monitor/${taskId}/current`);
    const result = await response.json();
    if (result.success) {
        updateMonitorDisplay(result.data);
    }
}
```

#### 3.2 CORS跨域处理

```python
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # 允许所有来源的跨域请求
```

### 4. robots.txt协议

系统支持遵守robots.txt协议：

```python
from urllib.robotparser import RobotFileParser

class CrawlerThread:
    def _init_robot_parser(self):
        """初始化robots.txt解析器"""
        try:
            parsed = urlparse(self.config['url'])
            robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
            
            self.robot_parser = RobotFileParser()
            self.robot_parser.set_url(robots_url)
            self.robot_parser.read()
        except Exception as e:
            logger.warning(f"Failed to load robots.txt: {e}")
    
    def can_fetch(self, url):
        """检查是否允许爬取"""
        if self.robot_parser:
            return self.robot_parser.can_fetch('*', url)
        return True
```

### 5. URL处理与规范化

```python
from urllib.parse import urljoin, urlparse, urldefrag

@staticmethod
def normalize_url(url):
    """URL规范化处理"""
    # 移除URL片段(#后面的部分)
    url, _ = urldefrag(url)
    
    # 解析URL
    parsed = urlparse(url)
    
    # 规范化处理
    # - 统一协议小写
    # - 移除默认端口
    # - 路径规范化
    
    return normalized_url

def extract_links(self, base_url, html, depth):
    """提取并转换为绝对URL"""
    for link in links:
        absolute_url = urljoin(base_url, link)  # 相对URL转绝对URL
        absolute_url = self.normalize_url(absolute_url)
```

---

## RESTful API接口详解

### 1. 任务管理接口

#### 1.1 获取所有任务
```http
GET /api/v1/tasks
```

**响应示例**:
```json
{
    "success": true,
    "data": [
        {
            "id": 1,
            "name": "示例任务",
            "url": "https://example.com",
            "status": "running",
            "queue_status": "active",
            "progress": 45.5,
            "total_urls": 100,
            "completed_urls": 45,
            "failed_urls": 1
        }
    ]
}
```

#### 1.2 创建任务
```http
POST /api/v1/tasks
Content-Type: application/json
```

**请求体**:
```json
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

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 任务名称 |
| url | string | 是 | 起始URL |
| strategy | string | 否 | 爬取策略: bfs/dfs/priority，默认bfs |
| max_depth | int | 否 | 最大深度1-10，默认3 |
| thread_count | int | 否 | 线程数1-10，默认3 |
| request_interval | float | 否 | 请求间隔(秒)，默认1.0 |
| retry_times | int | 否 | 重试次数，默认3 |
| respect_robots | bool | 否 | 遵守robots.txt，默认true |
| allow_cross_domain | bool | 否 | 允许跨域，默认false |

#### 1.3 获取单个任务
```http
GET /api/v1/tasks/{task_id}
```

#### 1.4 更新任务配置
```http
PUT /api/v1/tasks/{task_id}
Content-Type: application/json
```

**注意**: 任务运行中无法修改配置，需先停止任务。

#### 1.5 删除任务
```http
DELETE /api/v1/tasks/{task_id}
```

**注意**: 会同时删除任务关联的所有URL记录。

### 2. 任务控制接口

#### 2.1 启动任务
```http
POST /api/v1/tasks/{task_id}/start
```

**功能**: 
- 创建CrawlerThread实例
- 启动工作线程
- 更新任务状态为running
- 重置队列状态为active

#### 2.2 暂停爬取
```http
POST /api/v1/tasks/{task_id}/pause
```

**功能**: 暂停所有工作线程，保持URL队列状态。

#### 2.3 继续爬取
```http
POST /api/v1/tasks/{task_id}/resume
```

**功能**: 
- 如果任务在运行中：恢复工作线程
- 如果任务已暂停/完成/停止/失败：重新启动爬虫

#### 2.4 暂停队列
```http
POST /api/v1/tasks/{task_id}/pause-queue
```

**功能**: 停止发现新URL，但继续处理已有队列中的URL。

#### 2.5 继续队列
```http
POST /api/v1/tasks/{task_id}/resume-queue
```

**功能**: 恢复URL发现功能。

#### 2.6 停止任务
```http
POST /api/v1/tasks/{task_id}/stop
```

**功能**: 完全停止任务，清理资源，更新状态为stopped。

### 3. 监控数据接口

#### 3.1 获取实时监控数据
```http
GET /api/v1/monitor/{task_id}/current
```

**响应示例**:
```json
{
    "success": true,
    "data": {
        "task_id": 1,
        "status": "running",
        "queue_status": "active",
        "progress": 45.5,
        "total_urls": 100,
        "completed_urls": 45,
        "failed_urls": 1,
        "queue_size": 54,
        "success_rate": 97.8,
        "total_bytes": 1048576,
        "avg_response_time": 0.35,
        "cross_domain_blocked_urls": 10,
        "depth_blocked_urls": 5,
        "duplicate_urls": 20,
        "threads": {
            "0": {"status": "working", "current_url": "https://...", "speed": 1024},
            "1": {"status": "idle", "current_url": "", "speed": 0}
        }
    }
}
```

**字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| status | string | 任务状态: pending/running/paused/completed/stopped/failed |
| queue_status | string | 队列状态: active/paused |
| progress | float | 进度百分比 |
| total_urls | int | 发现的URL总数 |
| completed_urls | int | 已完成URL数 |
| failed_urls | int | 失败URL数 |
| queue_size | int | 队列剩余URL数 |
| success_rate | float | 成功率百分比 |
| total_bytes | int | 总下载字节数 |
| avg_response_time | float | 平均响应时间(秒) |
| threads | object | 各线程状态信息 |

### 4. URL记录接口

#### 4.1 获取URL列表
```http
GET /api/v1/tasks/{task_id}/urls?page=1&page_size=50&status=completed&prefix=www&ext=.html
```

**查询参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| page | int | 页码，默认1 |
| page_size | int | 每页数量，默认50 |
| status | string | 状态筛选: completed/failed/pending/robots_blocked |
| prefix | string | URL前缀搜索（智能匹配，自动添加http/https） |
| ext | string | 文件后缀筛选: .html/.jpg/.css等 |
| content_type | string | 内容类型筛选: image/video/audio/other |

**响应示例**:
```json
{
    "success": true,
    "data": {
        "urls": [
            {
                "id": 1,
                "task_id": 1,
                "url": "https://example.com/page.html",
                "depth": 1,
                "status": "completed",
                "status_code": 200,
                "response_time": 0.35,
                "file_size": 10240,
                "content_type": "text/html",
                "title": "页面标题",
                "author": "作者名",
                "description": "页面描述",
                "keywords": "关键词1,关键词2",
                "publish_time": "2024-01-01T00:00:00",
                "created_at": "2024-01-01 12:00:00",
                "completed_at": "2024-01-01 12:00:01"
            }
        ],
        "total": 100,
        "page": 1,
        "page_size": 50
    }
}
```

### 5. 统计分析接口

#### 5.1 获取任务统计
```http
GET /api/v1/tasks/{task_id}/stats
```

**响应示例**:
```json
{
    "success": true,
    "data": {
        "file_types": [
            {"content_type": "text/html", "count": 50, "total_size": 512000},
            {"content_type": "image/png", "count": 30, "total_size": 1048576}
        ],
        "domain_count": 5,
        "status_stats": [
            {"status": "completed", "count": 80},
            {"status": "failed", "count": 5},
            {"status": "pending", "count": 15}
        ]
    }
}
```

### 6. 数据导出接口

#### 6.1 导出任务数据
```http
GET /api/v1/tasks/{task_id}/export
```

**响应**: 返回该任务所有URL记录的JSON数据。

#### 6.2 下载文件
```http
GET /api/v1/download?url={url}&task_id={task_id}
```

**功能**: 通过爬虫代理下载指定URL的文件内容。

### 7. 调试接口

#### 7.1 获取活跃爬虫列表
```http
GET /api/v1/debug/active-crawlers
```

#### 7.2 强制清理僵尸任务
```http
POST /api/v1/debug/force-cleanup/{task_id}
```

---

## 模块化处理

### 核心模块

| 模块名 | 文件位置 | 功能描述 |
|--------|----------|----------|
| **Database** | app.py | 数据库管理类，处理连接、初始化、迁移、CRUD操作 |
| **CrawlerThread** | app.py | 爬虫核心引擎，多线程爬取、URL解析、链接提取、元数据提取 |
| **Flask Routes** | app.py | RESTful API路由，任务管理、监控数据、URL记录接口 |
| **WebUI** | web/ | 前端界面，响应式布局、实时监控、数据可视化 |
| **ChartManager** | app.js | 图表管理，流量监控、数据分析、统计展示 |
| **TaskManager** | app.js | 任务管理，创建、编辑、删除、状态控制 |

---

## 数据库设计

### tasks表（任务信息）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PRIMARY KEY | 任务ID（自增主键） |
| name | TEXT NOT NULL | 任务名称 |
| url | TEXT NOT NULL | 起始URL |
| strategy | TEXT DEFAULT 'bfs' | 爬取策略(bfs/dfs/priority) |
| max_depth | INTEGER DEFAULT 3 | 最大爬取深度(1-10) |
| thread_count | INTEGER DEFAULT 3 | 并发线程数(1-10) |
| request_interval | REAL DEFAULT 1.0 | 请求间隔(秒) |
| retry_times | INTEGER DEFAULT 3 | 失败重试次数 |
| respect_robots | BOOLEAN DEFAULT 1 | 是否遵守robots.txt |
| allow_cross_domain | BOOLEAN DEFAULT 0 | 是否允许跨域爬取 |
| status | TEXT DEFAULT 'pending' | 爬取状态 |
| queue_status | TEXT DEFAULT 'active' | 队列状态 |
| progress | REAL DEFAULT 0.0 | 进度百分比 |
| total_urls | INTEGER DEFAULT 0 | 发现URL总数 |
| completed_urls | INTEGER DEFAULT 0 | 已完成URL数 |
| failed_urls | INTEGER DEFAULT 0 | 失败URL数 |
| success_rate | REAL DEFAULT 0.0 | 成功率 |
| total_bytes | INTEGER DEFAULT 0 | 总下载字节数 |
| avg_response_time | REAL DEFAULT 0.0 | 平均响应时间 |
| created_at | TEXT | 创建时间 |
| started_at | TEXT | 开始时间 |
| finished_at | TEXT | 完成时间 |

### url_records表（URL记录与元数据）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PRIMARY KEY | 记录ID（自增主键） |
| task_id | INTEGER | 关联任务ID（外键） |
| url | TEXT NOT NULL | URL地址 |
| depth | INTEGER DEFAULT 0 | 爬取深度层级 |
| status | TEXT DEFAULT 'pending' | 状态 |
| status_code | INTEGER | HTTP状态码 |
| response_time | REAL | 响应时间(秒) |
| file_size | INTEGER | 文件大小(字节) |
| content_type | TEXT | 内容类型 |
| **title** | **TEXT** | **页面标题** |
| **author** | **TEXT** | **作者信息** |
| **description** | **TEXT** | **页面摘要/描述** |
| **keywords** | **TEXT** | **关键词** |
| **publish_time** | **TEXT** | **发布时间** |
| error_message | TEXT | 错误信息 |
| created_at | TEXT | 创建时间 |
| completed_at | TEXT | 完成时间 |

### 元数据提取来源

| 字段 | HTML来源 |
|------|----------|
| title | `<title>`, `<meta property="og:title">` |
| author | `<meta name="author">`, `<meta property="article:author">`, `<a rel="author">` |
| description | `<meta name="description">`, `<meta property="og:description">` |
| keywords | `<meta name="keywords">` |
| publish_time | `<meta property="article:published_time">`, `<time>`, `<meta itemprop="datePublished">` |

---

## 核心功能详解

### 爬虫引擎

- **多线程爬取**: 支持1-10个并发工作线程
- **深度控制**: 可设置最大爬取深度(1-10层)
- **多种策略**: 广度优先(BFS)、深度优先(DFS)、优先级策略
- **智能去重**: URL去重(visited_urls + queued_urls)
- **错误重试**: 可配置的重试次数和延迟
- **请求间隔**: 防止过于频繁的请求
- **robots.txt**: 可选的robots协议遵守
- **跨域控制**: 支持同域限制或跨域爬取

### 任务管理

- **任务CRUD**: 创建、查看、编辑、删除任务
- **状态控制**: 开始、暂停、继续、停止任务
- **队列控制**: 独立的URL队列暂停/继续功能
- **任务列表**: 显示所有任务的状态和进度
- **持久化**: 任务配置和状态的SQLite数据库存储
- **断点续爬**: 支持任务暂停后继续爬取

### 实时监控

- **多线程状态**: 显示每个线程的实时状态、当前URL、速度
- **进度跟踪**: 基于已发现URL总数的准确进度计算
- **流量图表**: 总流量和瞬间流量的实时图表
- **统计信息**: 成功率、错误数、下载字节数、响应时间
- **智能轮询**: 根据任务状态调整监控频率

### 数据分析

- **文件类型分布**: 饼图展示各类型文件占比
- **状态分布**: 柱状图展示各状态URL数量
- **深度分布**: 柱状图展示各深度层级URL数量
- **文件大小分布**: 饼图展示不同大小区间文件占比
- **响应时间分布**: 柱状图展示响应时间区间分布

---

## 代码结构分析

### 项目目录

```
net3/
├── app.py              # 主程序入口 (~2200行)
│   ├── Database类          # 数据库管理 (~110行)
│   ├── CrawlerThread类     # 爬虫线程 (~900行)
│   └── Flask Routes        # API路由 (~1100行)
├── web/
│   ├── index.html      # 主页面 (~484行)
│   ├── css/
│   │   └── style.css   # 样式文件 (~1589行)
│   └── js/
│       └── app.js      # 前端逻辑 (~2818行)
├── crawler.db          # SQLite数据库
├── requirements.txt    # Python依赖 (5个包)
├── start.bat           # Windows启动脚本
├── README.md           # 项目文档
└── LICENSE             # MIT许可证
```

### 代码统计

| 语言 | 行数 |
|------|------|
| Python后端 | ~2200行 |
| JavaScript前端 | ~2818行 |
| CSS样式 | ~1589行 |
| HTML页面 | ~484行 |
| **总计** | **~7091行** |

---

## 快速开始

### 方式1: 一键启动（推荐）

**Windows用户**:
```bash
# 最简单
quick-start.bat

# 或
start.bat
```

**Linux/Mac用户**:
```bash
chmod +x start.sh
./start.sh
```

### 方式2: 手动启动

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 启动服务
python app.py

# 3. 访问界面
# 浏览器打开 http://localhost:8000
```

---

## 使用指南

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

### 控制任务

- **开始**: 启动爬虫任务
- **爬取暂停**: 暂停所有工作线程
- **爬取继续**: 恢复工作线程
- **队列暂停**: 停止发现新URL
- **队列继续**: 恢复URL发现
- **停止**: 完全停止任务

---

## 总结与展望

### 项目亮点

- ✅ 完整的爬虫生命周期管理
- ✅ 实时可视化监控界面
- ✅ 灵活的任务配置选项
- ✅ 独立的爬取/队列控制
- ✅ 丰富的元数据提取(标题、作者、摘要、关键词、发布时间)
- ✅ 多维度数据分析
- ✅ 明暗主题切换
- ✅ 数据导出功能(CSV/ZIP/JSON)
- ✅ RESTful API设计
- ✅ HTTP协议规范实现

### 未来展望

- 🚀 支持代理池和IP轮换
- 🚀 支持Cookie和Session管理
- 🚀 支持JavaScript渲染(Selenium/Playwright)
- 🚀 支持分布式爬取
- 🚀 支持定时任务
- 🚀 支持数据提取规则配置
- 🚀 支持更多数据库(MySQL、PostgreSQL)
- 🚀 WebSocket实时通信优化

---

## 许可证

本项目采用 MIT 许可证

## 作者

智能网络爬虫系统开发团队

---

**注意**: 请遵守网站的robots.txt协议和服务条款，合理使用爬虫，不要对目标网站造成过大负担。

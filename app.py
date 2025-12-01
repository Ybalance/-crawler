#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
智能网络爬虫系统 - 主应用
支持多线程爬取、实时监控、任务管理
"""

import os
import sys
import time
import json
import logging
import sqlite3
import threading
import queue
import requests
import re
from datetime import datetime
from urllib.parse import urljoin, urlparse, urldefrag
from urllib.robotparser import RobotFileParser
from collections import defaultdict
from typing import Set, Dict, List, Optional

from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from bs4 import BeautifulSoup

# 配置日志 - 只输出到控制台，不保存到文件
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# 设置werkzeug和SocketIO日志级别，减少相关的错误日志
logging.getLogger('werkzeug').setLevel(logging.WARNING)
logging.getLogger('socketio').setLevel(logging.WARNING)
logging.getLogger('engineio').setLevel(logging.WARNING)

# 创建Flask应用
app = Flask(__name__, static_folder='web', static_url_path='')
app.config['SECRET_KEY'] = 'your-secret-key-here'
CORS(app)
# 启用SocketIO用于WebSocket实时通信
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Flask错误处理
@app.errorhandler(404)
def handle_404(e):
    """处理404错误"""
    logger.warning(f"404 Not Found: {request.url} (path: {request.path})")
    
    # 如果是API请求，返回JSON
    if request.path.startswith('/api/'):
        return jsonify({'success': False, 'error': 'API endpoint not found'}), 404
    
    # 对于常见的浏览器请求文件，返回204而不是404
    common_files = ['favicon.ico', 'robots.txt', 'sitemap.xml', 'apple-touch-icon.png', 
                   'manifest.json', 'sw.js', 'service-worker.js']
    
    if any(request.path.endswith(f'/{f}') or request.path == f'/{f}' for f in common_files):
        logger.debug(f"Returning 204 for common browser request: {request.path}")
        return '', 204
    
    # 如果是静态文件请求，返回index.html（用于SPA路由）
    logger.debug(f"Returning index.html for: {request.path}")
    return send_from_directory(app.static_folder, 'index.html')

@app.errorhandler(Exception)
def handle_exception(e):
    """全局异常处理器"""
    if isinstance(e, AssertionError) and "write() before start_response" in str(e):
        # 静默处理SocketIO相关的AssertionError
        logger.debug(f"SocketIO assertion error: {e}")
        return '', 200
    else:
        # 其他异常正常处理
        logger.error(f"Unhandled exception: {e}", exc_info=True)
        return {'error': 'Internal server error'}, 500

# 数据库配置
DB_PATH = 'crawler.db'

# 全局爬虫任务字典
active_crawlers: Dict[int, 'CrawlerThread'] = {}
crawler_lock = threading.Lock()


class Database:
    """数据库管理类"""
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.init_database()
    
    def get_connection(self):
        """获取数据库连接"""
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn
    
    def init_database(self):
        """初始化数据库表"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # 创建任务表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                strategy TEXT DEFAULT 'bfs',
                max_depth INTEGER DEFAULT 3,
                thread_count INTEGER DEFAULT 3,
                request_interval REAL DEFAULT 1.0,
                retry_times INTEGER DEFAULT 3,
                respect_robots BOOLEAN DEFAULT 1,
                allow_cross_domain BOOLEAN DEFAULT 0,
                status TEXT DEFAULT 'pending',
                queue_status TEXT DEFAULT 'active',
                progress REAL DEFAULT 0.0,
                total_urls INTEGER DEFAULT 0,
                completed_urls INTEGER DEFAULT 0,
                failed_urls INTEGER DEFAULT 0,
                success_rate REAL DEFAULT 0.0,
                total_bytes INTEGER DEFAULT 0,
                avg_response_time REAL DEFAULT 0.0,
                created_at TEXT,
                started_at TEXT,
                finished_at TEXT
            )
        ''')
        
        # 检查并添加queue_status字段（用于数据库迁移）
        try:
            cursor.execute("SELECT queue_status FROM tasks LIMIT 1")
        except:
            # 字段不存在，添加它
            cursor.execute("ALTER TABLE tasks ADD COLUMN queue_status TEXT DEFAULT 'active'")
            logger.info("Added queue_status column to tasks table")
        
        # 创建URL记录表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS url_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER,
                url TEXT NOT NULL,
                depth INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                status_code INTEGER,
                response_time REAL,
                file_size INTEGER,
                content_type TEXT,
                title TEXT,
                author TEXT,
                description TEXT,
                keywords TEXT,
                publish_time TEXT,
                error_message TEXT,
                created_at TEXT,
                completed_at TEXT,
                FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
            )
        ''')
        
        # 检查并添加新列（数据库迁移）
        self.migrate_database(cursor)
        
        # 创建索引
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_task_id ON url_records(task_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_url_status ON url_records(status)')
        
        conn.commit()
        conn.close()
    
    def migrate_database(self, cursor):
        """数据库迁移 - 添加新列"""
        try:
            # 检查url_records表是否有新的元数据列
            cursor.execute("PRAGMA table_info(url_records)")
            columns = [row[1] for row in cursor.fetchall()]
            
            # 需要添加的新列
            new_columns = [
                ('title', 'TEXT'),
                ('author', 'TEXT'), 
                ('description', 'TEXT'),
                ('keywords', 'TEXT'),
                ('publish_time', 'TEXT'),
                ('metadata', 'TEXT')  # 存储完整的JSON元数据
            ]
            
            
            # 添加缺失的列
            for column_name, column_type in new_columns:
                if column_name not in columns:
                    cursor.execute(f'ALTER TABLE url_records ADD COLUMN {column_name} {column_type}')
                    logger.info(f"Added column {column_name} to url_records table")
                    
        except Exception as e:
            logger.error(f"Database migration failed: {e}", exc_info=True)
        logger.info("Database initialized successfully")


class CrawlerThread(threading.Thread):
    """多线程爬虫类"""
    
    def __init__(self, task_id: int, task_config: dict, db: Database, socketio_instance):
        super().__init__()
        self.task_id = task_id
        self.config = task_config
        self.db = db
        self.socketio = socketio_instance
        
        # 爬虫状态
        self.status = 'running'
        self.paused = False
        self.queue_paused = False  # 队列暂停状态
        self.stopped = False
        self.manually_stopped = False  # 标记是否手动停止
        
        # URL队列和集合
        self.url_queue = queue.PriorityQueue()
        self.visited_urls: Set[str] = set()      # 已开始处理的URL
        self.queued_urls: Set[str] = set()       # 已加入队列的URL
        self.failed_urls: Set[str] = set()
        self.queue_lock = threading.Lock()
        
        # 统计信息 - 从数据库恢复或初始化为0
        self.total_urls_discovered = 0  # 实际加入队列的URL数量（可爬取的）
        self.total_urls_processed = 0   # 已处理的URL数量（完成+失败）
        self.completed_count = 0        # 成功爬取的URL数量
        self.failed_count = 0           # 失败的URL数量
        self.cross_domain_blocked_count = 0  # 被跨域限制阻止的URL数量
        self.depth_blocked_count = 0    # 被深度限制阻止的URL数量
        self.duplicate_count = 0        # 重复URL数量
        self.robots_blocked_count = 0   # 被robots.txt阻止的URL数量
        
        # robots.txt解析器字典，按域名存储
        self.robot_parsers = {}
        self.respect_robots = self.config.get('respect_robots', True)
        if self.respect_robots:
            self._init_robot_parser()
        self.total_bytes = 0
        self.response_times = []
        self.last_total_bytes = 0
        self.last_monitor_send = 0  # 上次发送监控数据的时间
        
        # 从数据库恢复当前任务的统计数据
        self._restore_task_stats()
        
        # 线程池
        self.worker_threads = []
        self.thread_stats = {}
        
        
        # 初始化队列
        start_url = CrawlerThread.normalize_url(self.config['url'])
        
        self.url_queue.put((0, 0, start_url))  # (priority, depth, url)
        self.queued_urls.add(start_url)  # 标记起始URL为已加入队列
        
        # 保存起始URL记录到数据库 (深度0)
        self.save_url_record(start_url, 0, 'pending', 0, 0, 0, '', None)
        
        # 如果是新任务，设置发现URL数量为1
        if self.total_urls_discovered == 0:
            self.total_urls_discovered = 1  # 起始URL加入队列
        
        
        logger.info(f"Crawler initialized for task {task_id}: {start_url}")
    
    def _restore_task_stats(self):
        """从数据库恢复任务统计数据 - 确保任务隔离"""
        try:
            conn = self.db.get_connection()
            cursor = conn.cursor()
            
            # 首先检查任务是否存在
            cursor.execute('SELECT id FROM tasks WHERE id = ?', (self.task_id,))
            if not cursor.fetchone():
                logger.error(f"Task {self.task_id} not found in database")
                conn.close()
                return
            
            # 从URL记录中计算实际统计（最准确的方法）
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_records,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
                    SUM(CASE WHEN status = 'completed' THEN COALESCE(file_size, 0) ELSE 0 END) as total_bytes
                FROM url_records 
                WHERE task_id = ?
            ''', (self.task_id,))
            url_stats = cursor.fetchone()
            
            # 获取tasks表中的数据作为备选，包括队列状态
            cursor.execute('''
                SELECT COALESCE(total_urls, 0) as total_urls, 
                       COALESCE(completed_urls, 0) as completed_urls,
                       COALESCE(failed_urls, 0) as failed_urls,
                       COALESCE(queue_status, 'active') as queue_status, 
                       COALESCE(total_bytes, 0) as total_bytes 
                FROM tasks WHERE id = ?
            ''', (self.task_id,))
            task_stats = cursor.fetchone()
            conn.close()
            
            # 优先使用URL记录统计，如果没有则使用tasks表数据
            if url_stats and url_stats['total_records'] > 0:
                self.completed_count = url_stats['completed_count'] or 0
                self.failed_count = url_stats['failed_count'] or 0
                self.total_bytes = url_stats['total_bytes'] or 0
                self.total_urls_discovered = task_stats['total_urls'] or 0  # 这个从tasks表获取
                logger.info(f"Task {self.task_id}: Restored from URL records - "
                          f"completed={self.completed_count}, failed={self.failed_count}, bytes={self.total_bytes}")
            elif task_stats:
                self.total_urls_discovered = task_stats['total_urls'] or 0
                self.completed_count = task_stats['completed_urls'] or 0
                self.failed_count = task_stats['failed_urls'] or 0
                self.total_bytes = task_stats['total_bytes'] or 0
                logger.info(f"Task {self.task_id}: Restored from tasks table - "
                          f"discovered={self.total_urls_discovered}, completed={self.completed_count}, "
                          f"failed={self.failed_count}, bytes={self.total_bytes}")
            else:
                logger.warning(f"Task {self.task_id}: No stats found, using defaults")
            
            # 设置队列状态
            if task_stats:
                queue_status = task_stats['queue_status'] or 'active'
                self.queue_paused = (queue_status == 'paused')
                logger.info(f"Task {self.task_id}: Queue status restored - {queue_status}")
            else:
                self.queue_paused = False
                
            self.total_urls_processed = self.completed_count + self.failed_count
            
        except Exception as e:
            logger.error(f"Failed to restore task {self.task_id} stats: {e}", exc_info=True)
            # 确保统计数据有默认值
            self.total_urls_discovered = 0
            self.completed_count = 0
            self.failed_count = 0
            self.total_bytes = 0
            self.total_urls_processed = 0
    
    def _init_robot_parser(self):
        """初始化起始域名的robots.txt解析器"""
        try:
            parsed = urlparse(self.config['url'])
            domain = f"{parsed.scheme}://{parsed.netloc}"
            self._load_robots_for_domain(domain)
        except Exception as e:
            logger.warning(f"Task {self.task_id}: Failed to initialize robots parser: {e}")
    
    def _load_robots_for_domain(self, domain: str):
        """为指定域名加载robots.txt"""
        if domain in self.robot_parsers:
            return  # 已经加载过
        
        try:
            robots_url = f"{domain}/robots.txt"
            robot_parser = RobotFileParser()
            robot_parser.set_url(robots_url)
            robot_parser.read()
            
            self.robot_parsers[domain] = robot_parser
            logger.info(f"Task {self.task_id}: Loaded robots.txt from {robots_url}")
        except Exception as e:
            logger.warning(f"Task {self.task_id}: Failed to load robots.txt from {domain}: {e}")
            self.robot_parsers[domain] = None
    
    def can_fetch(self, url: str) -> bool:
        """检查URL是否被robots.txt允许爬取"""
        # 如果不遵守robots协议，直接返回True
        if not self.respect_robots:
            return True
        
        try:
            # 获取URL的域名
            parsed = urlparse(url)
            domain = f"{parsed.scheme}://{parsed.netloc}"
            
            # 动态加载该域名的robots.txt（如果还没加载）
            if domain not in self.robot_parsers:
                self._load_robots_for_domain(domain)
            
            # 获取该域名的robots解析器
            robot_parser = self.robot_parsers.get(domain)
            if not robot_parser:
                return True  # 如果加载失败，允许爬取
            
            # 使用通配符User-Agent检查
            return robot_parser.can_fetch("*", url)
        except Exception as e:
            logger.warning(f"Error checking robots.txt for {url}: {e}")
            return True
    
    def is_same_domain(self, url: str) -> bool:
        """检查是否同域"""
        base_url = self.config['url']
        
        # 如果基础URL没有协议，添加http://
        if not base_url.startswith(('http://', 'https://')):
            base_url = 'http://' + base_url
            
        base_domain = urlparse(base_url).netloc
        url_domain = urlparse(url).netloc
        
        # 移除www前缀进行比较，避免www和非www的差异
        base_domain_clean = base_domain.replace('www.', '') if base_domain.startswith('www.') else base_domain
        url_domain_clean = url_domain.replace('www.', '') if url_domain.startswith('www.') else url_domain
        
        return base_domain == url_domain or base_domain_clean == url_domain_clean
    
    @staticmethod
    def normalize_url(url: str) -> str:
        """标准化URL"""
        url, _ = urldefrag(url)  # 移除fragment
        url = url.strip()
        
        # 统一处理末尾斜杠：对于根路径保留斜杠，其他路径移除末尾斜杠
        parsed = urlparse(url)
        path = parsed.path
        
        # 如果路径为空或只有斜杠，统一为带斜杠
        if path == '' or path == '/':
            path = '/'
        else:
            # 移除末尾斜杠（非根路径）
            path = path.rstrip('/')
        
        # 重建URL
        url = f"{parsed.scheme}://{parsed.netloc}{path}"
        if parsed.query:
            url += f"?{parsed.query}"
        
        return url
    
    def run(self):
        """主线程运行"""
        try:
            # 更新任务状态
            self.update_task_status('running')
            
            # 启动工作线程
            thread_count = self.config.get('thread_count', 3)
            for i in range(thread_count):
                worker = threading.Thread(target=self.worker_run, args=(i,))
                worker.daemon = True
                worker.start()
                self.worker_threads.append(worker)
                self.thread_stats[i] = {
                    'status': 'idle',
                    'current_url': '',
                    'speed': 0,
                    'completed': 0,
                    'failed': 0,
                    'bytes': 0,  # 累计字节数
                    'last_bytes': 0  # 上次记录的字节数，用于计算增量
                }
            
            logger.info(f"Started {thread_count} worker threads for task {self.task_id}")
            
            # 监控线程状态
            idle_count = 0  # 连续空闲检查次数
            while not self.stopped:
                # 检查是否完成
                if self.url_queue.empty() and all(
                    stat['status'] in ['idle', 'stopped'] for stat in self.thread_stats.values()
                ):
                    idle_count += 1
                    if idle_count >= 3:  # 连续3次检查都是空闲状态，确认完成
                        logger.info(f"Task {self.task_id} completed - queue empty and all threads idle")
                        self.stopped = True  # 设置停止标志
                        break
                else:
                    idle_count = 0  # 重置计数器
                
                # 更新进度
                self.update_progress()
                
                # 发送监控数据
                self.send_monitor_data()
                
                time.sleep(2)
            
            # 等待所有工作线程完成
            for worker in self.worker_threads:
                worker.join(timeout=5)
            
            # 更新最终状态
            if self.manually_stopped:
                # 手动停止
                final_status = 'stopped'
                logger.info(f"Task {self.task_id} finished - status: stopped (manually)")
            elif self.stopped and idle_count >= 3:
                # 自然完成（队列空且线程空闲）
                final_status = 'completed'
                logger.info(f"Task {self.task_id} finished - status: completed (naturally)")
            else:
                # 异常情况
                final_status = 'stopped'
                logger.warning(f"Task {self.task_id} finished unexpectedly - status: stopped")
            
            self.update_task_status(final_status)
            self.send_monitor_data(force=True)  # 强制发送最终状态
            
            # 从活跃爬虫列表中移除
            self._cleanup_from_active_crawlers()
            
        except Exception as e:
            logger.error(f"Crawler error for task {self.task_id}: {e}", exc_info=True)
            self.update_task_status('failed')
            # 确保失败时也从活跃列表中移除
            self._cleanup_from_active_crawlers()
    
    def _cleanup_from_active_crawlers(self):
        """从活跃爬虫列表中移除自己"""
        try:
            with crawler_lock:
                if self.task_id in active_crawlers:
                    del active_crawlers[self.task_id]
                    logger.info(f"Task {self.task_id} removed from active crawlers")
        except Exception as e:
            logger.error(f"Failed to cleanup task {self.task_id} from active crawlers: {e}")
    
    def worker_run(self, thread_id: int):
        """工作线程运行"""
        logger.info(f"Worker thread {thread_id} started for task {self.task_id}")
        
        while not self.stopped:
            # 检查暂停状态
            while self.paused and not self.stopped:
                self.thread_stats[thread_id]['status'] = 'paused'
                time.sleep(1)
            
            if self.stopped:
                break
            
            try:
                # 获取URL
                priority, depth, url = self.url_queue.get(timeout=1)
                
                # 注意：深度检查已经在加入队列时完成，这里不需要重复检查
                
                # 更新线程状态
                self.thread_stats[thread_id]['status'] = 'crawling'
                self.thread_stats[thread_id]['current_url'] = url
                
                # 爬取URL
                start_time = time.time()
                result = self.crawl_url(url, depth, thread_id)
                elapsed = time.time() - start_time
                
                # 更新统计
                if result is True:
                    self.thread_stats[thread_id]['completed'] += 1
                    with self.queue_lock:
                        self.completed_count += 1
                        self.total_urls_processed += 1
                    self.thread_stats[thread_id]['speed'] = 1.0 / elapsed if elapsed > 0 else 0
                    self.response_times.append(elapsed)
                elif result is False:
                    self.thread_stats[thread_id]['failed'] += 1
                    with self.queue_lock:
                        self.failed_count += 1
                        self.total_urls_processed += 1
                    self.thread_stats[thread_id]['speed'] = 1.0 / elapsed if elapsed > 0 else 0
                    self.response_times.append(elapsed)
                # result is None: URL已处理过或被跳过，不计入处理统计
                
                # 请求间隔（只有实际发送请求时才等待）
                if result is not None:
                    interval = self.config.get('request_interval', 1.0)
                    time.sleep(interval)
                
                self.url_queue.task_done()
                
            except queue.Empty:
                self.thread_stats[thread_id]['status'] = 'idle'
                self.thread_stats[thread_id]['current_url'] = ''
                continue
            except Exception as e:
                logger.error(f"Worker {thread_id} error: {e}", exc_info=True)
                self.thread_stats[thread_id]['status'] = 'error'
        
        self.thread_stats[thread_id]['status'] = 'stopped'
        logger.info(f"Worker thread {thread_id} stopped for task {self.task_id}")
    
    def crawl_url(self, url: str, depth: int, thread_id: int) -> bool:
        """爬取单个URL"""
        url = self.normalize_url(url)
        
        # 检查是否已经处理过（防止重复处理）
        with self.queue_lock:
            if url in self.visited_urls:
                logger.debug(f"URL already visited, skipping: {url}")
                return None  # 返回None表示跳过，不计入统计
            self.visited_urls.add(url)
        
        # 发送请求
        retry_times = self.config.get('retry_times', 3)
        for attempt in range(retry_times):
            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
                
                # 配置SSL和连接参数
                import ssl
                from requests.adapters import HTTPAdapter
                from urllib3.util.retry import Retry
                
                session = requests.Session()
                
                # 配置重试策略
                retry_strategy = Retry(
                    total=3,
                    backoff_factor=1,
                    status_forcelist=[429, 500, 502, 503, 504],
                    allowed_methods=["HEAD", "GET", "OPTIONS"]
                )
                
                # 配置适配器
                adapter = HTTPAdapter(max_retries=retry_strategy)
                session.mount("http://", adapter)
                session.mount("https://", adapter)
                
                start_time = time.time()
                response = session.get(
                    url, 
                    headers=headers, 
                    timeout=(10, 30),  # (连接超时, 读取超时)
                    stream=True, 
                    allow_redirects=True,
                    verify=True  # 验证SSL证书
                )
                response_time = time.time() - start_time
                
                # 检查是否发生重定向
                final_url = CrawlerThread.normalize_url(response.url)
                if final_url != url:
                    logger.info(f"Redirect: {url} -> {final_url}")
                    # 将重定向后的URL也标记为已访问，避免重复爬取
                    with self.queue_lock:
                        self.visited_urls.add(final_url)
                        self.queued_urls.add(final_url)
                
                status_code = response.status_code
                content_type = response.headers.get('Content-Type', '').split(';')[0].strip()
                
                # 获取文件大小
                file_size = 0
                content = b''
                
                # 只解析HTML内容
                if 'text/html' in content_type:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            content += chunk
                            file_size += len(chunk)
                            if file_size > 10 * 1024 * 1024:  # 限制10MB
                                break
                else:
                    # 其他文件类型只获取大小
                    file_size = int(response.headers.get('Content-Length', 0))
                
                self.total_bytes += file_size
                
                # 更新线程字节统计
                if thread_id in self.thread_stats:
                    self.thread_stats[thread_id]['bytes'] += file_size
                
                # 提取元数据（仅HTML）
                metadata = {}
                if 'text/html' in content_type and content:
                    try:
                        html = content.decode('utf-8', errors='ignore')
                        metadata = self.extract_metadata(html)
                        # 不再保存内容到数据库，下载时直接重新获取
                        self.extract_links(url, html, depth)
                    except Exception as e:
                        logger.warning(f"Failed to extract content from {url}: {e}")
                # 不再缓存任何文件内容到数据库
                
                # 更新记录状态（包含元数据）
                self.update_url_record(url, 'completed', status_code, response_time, 
                                      file_size, content_type, None, metadata)
                
                return True
                
            except requests.exceptions.SSLError as e:
                # 专门处理SSL错误
                if "UNEXPECTED_EOF_WHILE_READING" in str(e) or "EOF occurred in violation of protocol" in str(e):
                    logger.warning(f"SSL EOF error (attempt {attempt + 1}/{retry_times}): {url} - Server closed connection unexpectedly")
                    if attempt < retry_times - 1:
                        # SSL EOF错误通常是临时的，等待更长时间再重试
                        time.sleep(2 ** attempt)  # 指数退避
                        continue
                else:
                    logger.warning(f"SSL error (attempt {attempt + 1}/{retry_times}): {url} - {e}")
                
                if attempt == retry_times - 1:
                    self.update_url_record(url, 'failed', 0, 0, 0, '', f"SSL Error: {str(e)}")
                    with self.queue_lock:
                        self.failed_urls.add(url)
                    return False
                time.sleep(1)
                
            except requests.exceptions.ConnectionError as e:
                logger.warning(f"Connection error (attempt {attempt + 1}/{retry_times}): {url} - {e}")
                if attempt == retry_times - 1:
                    self.update_url_record(url, 'failed', 0, 0, 0, '', f"Connection Error: {str(e)}")
                    with self.queue_lock:
                        self.failed_urls.add(url)
                    return False
                time.sleep(2)  # 连接错误等待更长时间
                
            except requests.exceptions.Timeout as e:
                logger.warning(f"Timeout error (attempt {attempt + 1}/{retry_times}): {url} - {e}")
                if attempt == retry_times - 1:
                    self.update_url_record(url, 'failed', 0, 0, 0, '', f"Timeout Error: {str(e)}")
                    with self.queue_lock:
                        self.failed_urls.add(url)
                    return False
                time.sleep(1)
                
            except requests.RequestException as e:
                logger.warning(f"Request failed (attempt {attempt + 1}/{retry_times}): {url} - {e}")
                if attempt == retry_times - 1:
                    self.update_url_record(url, 'failed', 0, 0, 0, '', str(e))
                    with self.queue_lock:
                        self.failed_urls.add(url)
                    return False
                time.sleep(1)
        
        return False
    
    def extract_metadata(self, html: str) -> dict:
        """从HTML中提取元数据"""
        metadata = {
            'title': '',
            'author': '',
            'description': '',
            'keywords': '',
            'publish_time': ''
        }
        
        try:
            soup = BeautifulSoup(html, 'lxml')
            
            # 提取标题
            # 1. <title>标签
            title_tag = soup.find('title')
            if title_tag:
                metadata['title'] = title_tag.get_text().strip()[:500]
            
            # 2. og:title
            og_title = soup.find('meta', property='og:title')
            if og_title and og_title.get('content'):
                metadata['title'] = og_title['content'].strip()[:500]
            
            # 提取作者
            # 1. <meta name="author">
            author_meta = soup.find('meta', attrs={'name': 'author'})
            if author_meta and author_meta.get('content'):
                metadata['author'] = author_meta['content'].strip()[:200]
            
            # 2. article:author
            article_author = soup.find('meta', property='article:author')
            if article_author and article_author.get('content'):
                metadata['author'] = article_author['content'].strip()[:200]
            
            # 3. <a rel="author">
            author_link = soup.find('a', rel='author')
            if author_link and not metadata['author']:
                metadata['author'] = author_link.get_text().strip()[:200]
            
            # 提取描述/摘要
            # 1. <meta name="description">
            desc_meta = soup.find('meta', attrs={'name': 'description'})
            if desc_meta and desc_meta.get('content'):
                metadata['description'] = desc_meta['content'].strip()[:1000]
            
            # 2. og:description
            og_desc = soup.find('meta', property='og:description')
            if og_desc and og_desc.get('content'):
                metadata['description'] = og_desc['content'].strip()[:1000]
            
            # 提取关键词
            keywords_meta = soup.find('meta', attrs={'name': 'keywords'})
            if keywords_meta and keywords_meta.get('content'):
                metadata['keywords'] = keywords_meta['content'].strip()[:500]
            
            # 提取发表时间
            # 1. article:published_time
            pub_time = soup.find('meta', property='article:published_time')
            if pub_time and pub_time.get('content'):
                metadata['publish_time'] = pub_time['content'].strip()[:50]
            
            # 2. <time> 标签
            time_tag = soup.find('time')
            if time_tag and not metadata['publish_time']:
                metadata['publish_time'] = time_tag.get('datetime', time_tag.get_text()).strip()[:50]
            
            # 3. datePublished (schema.org)
            date_meta = soup.find('meta', attrs={'itemprop': 'datePublished'})
            if date_meta and date_meta.get('content') and not metadata['publish_time']:
                metadata['publish_time'] = date_meta['content'].strip()[:50]
            
        except Exception as e:
            logger.warning(f"Failed to extract metadata: {e}")
        
        return metadata
    
    def extract_links(self, base_url: str, html: str, depth: int):
        """提取页面中的链接"""
        # 如果队列暂停，不提取新链接
        if self.queue_paused:
            logger.info(f"Queue is paused, skipping link extraction for {base_url}")
            return
            
        try:
            soup = BeautifulSoup(html, 'lxml')
            links = set()
            
            # 提取<a>标签
            for tag in soup.find_all('a', href=True):
                links.add(tag['href'])
            
            # 提取<img>标签
            for tag in soup.find_all('img', src=True):
                links.add(tag['src'])
            
            # 提取<link>标签
            for tag in soup.find_all('link', href=True):
                links.add(tag['href'])
            
            # 提取<script>标签
            for tag in soup.find_all('script', src=True):
                links.add(tag['src'])
            
            # 正则提取URL
            url_pattern = r'https?://[^\s<>"{}|\\^`\[\]]+'
            regex_urls = re.findall(url_pattern, html)
            links.update(regex_urls)
            
            # 处理链接
            new_urls = 0
            robots_blocked = 0
            cross_domain_blocked = 0
            depth_blocked = 0
            duplicates = 0
            strategy = self.config.get('strategy', 'bfs')
            
            for link in links:
                try:
                    # 转换为绝对URL
                    absolute_url = urljoin(base_url, link)
                    absolute_url = self.normalize_url(absolute_url)
                    
                    # 检查是否已加入队列
                    with self.queue_lock:
                        if absolute_url in self.queued_urls:
                            duplicates += 1
                            continue
                    
                    # 先检查跨域（优先级最高）
                    if not self.config.get('allow_cross_domain', False) and not self.is_same_domain(absolute_url):
                        cross_domain_blocked += 1
                        logger.debug(f"URL blocked by cross-domain policy: {absolute_url}")
                        continue
                    
                    # 再检查robots.txt（只检查本域或允许的跨域URL）
                    if not self.can_fetch(absolute_url):
                        robots_blocked += 1
                        logger.info(f"URL blocked by robots.txt: {absolute_url}")
                        # 保存被robots禁止的URL记录
                        self.save_url_record(absolute_url, depth + 1, 'robots_blocked', 0, 0, 0, '', None)
                        continue
                    
                    # 检查深度限制
                    next_depth = depth + 1
                    max_depth = self.config.get('max_depth', 3)
                    if next_depth > max_depth:
                        depth_blocked += 1
                        logger.debug(f"URL depth {next_depth} exceeds max_depth {max_depth}: {absolute_url}")
                        continue
                    
                    # 添加到队列
                    with self.queue_lock:
                        # 计算优先级
                        if strategy == 'dfs':
                            priority = -next_depth  # 深度优先：深度越大优先级越高
                        elif strategy == 'priority':
                            # 优先级策略：HTML > 图片 > 其他
                            if absolute_url.endswith(('.html', '.htm', '/')):
                                priority = 0
                            elif absolute_url.endswith(('.jpg', '.png', '.gif', '.jpeg')):
                                priority = 1
                            else:
                                priority = 2
                        else:  # bfs
                            priority = next_depth  # 广度优先：深度越小优先级越高
                        
                        self.url_queue.put((priority, next_depth, absolute_url))
                        self.queued_urls.add(absolute_url)  # 标记为已加入队列
                        # 保存待处理状态的URL记录
                        self.save_url_record(absolute_url, next_depth, 'pending', 0, 0, 0, '', None)
                        new_urls += 1
                
                except Exception as e:
                    logger.debug(f"Failed to process link {link}: {e}")
            
            # 更新统计
            with self.queue_lock:
                if new_urls > 0:
                    self.total_urls_discovered += new_urls
                if robots_blocked > 0:
                    self.robots_blocked_count += robots_blocked
                if cross_domain_blocked > 0:
                    self.cross_domain_blocked_count += cross_domain_blocked
                if depth_blocked > 0:
                    self.depth_blocked_count += depth_blocked
                if duplicates > 0:
                    self.duplicate_count += duplicates
            
            total_links = new_urls + robots_blocked + cross_domain_blocked + depth_blocked + duplicates
            if total_links > 0:
                logger.info(f"Processed {total_links} links from {base_url}: "
                          f"{new_urls} queued, {robots_blocked} robots-blocked, "
                          f"{cross_domain_blocked} cross-domain-blocked, {depth_blocked} depth-blocked, {duplicates} duplicates")
        
        except Exception as e:
            logger.error(f"Failed to extract links from {base_url}: {e}", exc_info=True)
    
    def save_url_record(self, url: str, depth: int, status: str, status_code: int, 
                       response_time: float, file_size: int, content_type: str, 
                       error_message: str, metadata: dict = None):
        """保存URL记录到数据库"""
        try:
            conn = self.db.get_connection()
            cursor = conn.cursor()
            
            now = datetime.now().isoformat()
            
            # 提取元数据
            title = metadata.get('title', '') if metadata else ''
            author = metadata.get('author', '') if metadata else ''
            description = metadata.get('description', '') if metadata else ''
            keywords = metadata.get('keywords', '') if metadata else ''
            publish_time = metadata.get('publish_time', '') if metadata else ''
            
            # 保存metadata为JSON字符串（排除content字段）
            metadata_json = None
            if metadata:
                # 创建metadata副本，排除content字段
                metadata_clean = {k: v for k, v in metadata.items() if k != 'content'}
                metadata_json = json.dumps(metadata_clean) if metadata_clean else None
            
            cursor.execute('''
                INSERT INTO url_records 
                (task_id, url, depth, status, status_code, response_time, file_size, 
                 content_type, title, author, description, keywords, publish_time,
                 error_message, metadata, created_at, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (self.task_id, url, depth, status, status_code, response_time, 
                  file_size, content_type, title, author, description, keywords, 
                  publish_time, error_message, metadata_json, now, now))
            
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to save URL record: {e}", exc_info=True)
    
    def update_url_record(self, url: str, status: str, status_code: int, 
                         response_time: float, file_size: int, content_type: str, 
                         error_message: str, metadata: dict = None):
        """更新URL记录状态"""
        try:
            conn = self.db.get_connection()
            cursor = conn.cursor()
            
            now = datetime.now().isoformat()
            
            # 提取元数据
            title = metadata.get('title', '') if metadata else ''
            author = metadata.get('author', '') if metadata else ''
            description = metadata.get('description', '') if metadata else ''
            keywords = metadata.get('keywords', '') if metadata else ''
            publish_time = metadata.get('publish_time', '') if metadata else ''
            
            # 序列化metadata（排除content字段）
            metadata_json = None
            if metadata:
                try:
                    # 创建metadata副本，排除content字段
                    metadata_clean = {k: v for k, v in metadata.items() if k != 'content'}
                    metadata_json = json.dumps(metadata_clean, ensure_ascii=False) if metadata_clean else None
                except Exception as e:
                    logger.warning(f"Failed to serialize metadata for {url}: {e}")
            
            cursor.execute('''
                UPDATE url_records 
                SET status = ?, status_code = ?, response_time = ?, file_size = ?, 
                    content_type = ?, title = ?, author = ?, description = ?, 
                    keywords = ?, publish_time = ?, error_message = ?, completed_at = ?,
                    metadata = ?
                WHERE task_id = ? AND url = ?
            ''', (status, status_code, response_time, file_size, content_type, 
                  title, author, description, keywords, publish_time, error_message, 
                  now, metadata_json, self.task_id, url))
            
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to update URL record: {e}", exc_info=True)
    
    def update_progress(self):
        """更新任务进度"""
        try:
            with self.queue_lock:
                # 进度 = 已处理URL数量 / 发现的URL总数
                total_discovered = self.total_urls_discovered
                total_processed = self.total_urls_processed
                queue_size = self.url_queue.qsize()
                
                # 如果队列不为空，说明还有URL待处理
                if queue_size > 0:
                    progress = (total_processed / max(total_discovered, 1)) * 100
                else:
                    # 队列为空，进度为100%
                    progress = 100.0 if total_discovered > 0 else 0.0
                
                # 成功率 = 成功数量 / 已处理数量
                success_rate = (self.completed_count / max(total_processed, 1)) * 100 if total_processed > 0 else 0.0
                avg_response_time = sum(self.response_times[-100:]) / len(self.response_times[-100:]) if self.response_times else 0
            
            conn = self.db.get_connection()
            cursor = conn.cursor()
            
            # 确保只更新当前任务的数据
            cursor.execute('''
                UPDATE tasks 
                SET progress = ?, total_urls = ?, completed_urls = ?, failed_urls = ?,
                    success_rate = ?, total_bytes = ?, avg_response_time = ?
                WHERE id = ?
            ''', (progress, self.total_urls_discovered, self.completed_count, self.failed_count,
                  success_rate, self.total_bytes, avg_response_time, self.task_id))
            
            # 验证更新是否成功
            if cursor.rowcount != 1:
                logger.warning(f"Task {self.task_id}: Expected to update 1 row, but updated {cursor.rowcount} rows")
            else:
                logger.debug(f"Task {self.task_id}: Progress updated - completed={self.completed_count}, bytes={self.total_bytes}")
            
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to update progress: {e}", exc_info=True)
    
    def update_task_status(self, status: str):
        """更新任务状态"""
        try:
            conn = self.db.get_connection()
            cursor = conn.cursor()
            
            now = datetime.now().isoformat()
            if status == 'running':
                cursor.execute('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?', 
                             (status, now, self.task_id))
            elif status in ['completed', 'stopped', 'failed']:
                cursor.execute('UPDATE tasks SET status = ?, finished_at = ? WHERE id = ?', 
                             (status, now, self.task_id))
            else:
                cursor.execute('UPDATE tasks SET status = ? WHERE id = ?', (status, self.task_id))
            
            conn.commit()
            conn.close()
            self.status = status
            
            # 推送任务状态更新
            if socketio:
                status_data = {
                    'task_id': self.task_id,
                    'status': status,
                    'timestamp': now
                }
                broadcast_task_status(self.task_id, status_data)
        except Exception as e:
            logger.error(f"Failed to update task status: {e}", exc_info=True)
    
    def send_monitor_data(self, force=False):
        """发送监控数据到前端"""
        try:
            # 控制发送频率，避免过于频繁的SocketIO操作
            current_time = time.time()
            if not force and current_time - self.last_monitor_send < 1.0:  # 最少间隔1秒
                return
            self.last_monitor_send = current_time
            with self.queue_lock:
                # 计算进度
                total_discovered = self.total_urls_discovered  # 加入队列的URL总数
                total_processed = self.total_urls_processed    # 已处理的URL数量
                queue_size = self.url_queue.qsize()           # 队列中剩余的URL数量
                
                # 进度 = 已处理 / 总发现 * 100%
                progress = (total_processed / max(total_discovered, 1)) * 100
                
                # 调试信息
                logger.info(f"Progress calculation: {total_processed}/{total_discovered} = {progress:.1f}%, queue_size={queue_size}")
                
                success_rate = (self.completed_count / max(total_processed, 1)) * 100 if total_processed > 0 else 0.0
                
                monitor_data = {
                    'task_id': self.task_id,
                    'status': self.status,
                    'progress': progress,
                    'total_urls': total_discovered,  # 发现并加入队列的URL数量
                    'total_processed': total_processed,  # 已处理的URL数量
                    'completed_urls': self.completed_count,
                    'failed_urls': self.failed_count,
                    'cross_domain_blocked_urls': self.cross_domain_blocked_count,
                    'depth_blocked_urls': self.depth_blocked_count,
                    'duplicate_urls': self.duplicate_count,
                    'queue_size': queue_size,
                    'success_rate': success_rate,
                    'total_bytes': self.total_bytes,
                    'avg_response_time': sum(self.response_times[-100:]) / len(self.response_times[-100:]) if self.response_times else 0,
                    'threads': self.thread_stats
                }
            
            # 通过WebSocket推送监控数据
            if socketio:
                broadcast_monitor_data(self.task_id, monitor_data)
        except Exception as e:
            logger.error(f"Failed to send monitor data: {e}", exc_info=True)
    
    def _safe_emit_monitor_data(self, monitor_data):
        """安全地发送监控数据，避免SocketIO错误"""
        # SocketIO已禁用，不发送数据
        pass
    
    def pause(self):
        """暂停爬虫"""
        self.paused = True
        self.update_task_status('paused')
        logger.info(f"Task {self.task_id} paused")
    
    def resume(self):
        """继续爬虫"""
        self.paused = False
        self.update_task_status('running')
        logger.info(f"Task {self.task_id} resumed")
    
    def pause_queue(self):
        """暂停URL队列增长"""
        self.queue_paused = True
        self._update_queue_status('paused')
        logger.info(f"Task {self.task_id} queue paused - no new URLs will be discovered")
    
    def resume_queue(self):
        """恢复URL队列增长"""
        self.queue_paused = False
        self._update_queue_status('active')
        logger.info(f"Task {self.task_id} queue resumed - URL discovery enabled")
    
    def _update_queue_status(self, status):
        """更新数据库中的队列状态"""
        try:
            conn = self.db.get_connection()
            cursor = conn.cursor()
            cursor.execute('UPDATE tasks SET queue_status = ? WHERE id = ?', (status, self.task_id))
            conn.commit()
            conn.close()
            logger.debug(f"Task {self.task_id} queue status updated to: {status}")
        except Exception as e:
            logger.error(f"Failed to update queue status: {e}", exc_info=True)
    
    def stop(self):
        """停止爬虫"""
        self.stopped = True
        self.manually_stopped = True  # 标记为手动停止
        self.paused = False
        self.queue_paused = False  # 停止时也重置队列状态
        logger.info(f"Task {self.task_id} stopped manually")


# ==================== API路由 ====================

db = Database()

def reset_task_data(task_id: int, clear_history: bool = True):
    """重置任务数据，用于重新启动已完成的任务"""
    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        
        # 重置任务统计数据
        cursor.execute('''
            UPDATE tasks 
            SET status = 'pending',
                progress = 0.0,
                total_urls = 0,
                completed_urls = 0,
                failed_urls = 0,
                success_rate = 0.0,
                total_bytes = 0,
                avg_response_time = 0.0,
                started_at = NULL,
                finished_at = NULL
            WHERE id = ?
        ''', (task_id,))
        
        # 可选择是否删除之前的URL记录
        if clear_history:
            cursor.execute('DELETE FROM url_records WHERE task_id = ?', (task_id,))
            logger.info(f"Reset task data and cleared history for task {task_id}")
        else:
            logger.info(f"Reset task data but kept history for task {task_id}")
        
        conn.commit()
        conn.close()
        
    except Exception as e:
        logger.error(f"Failed to reset task data: {e}", exc_info=True)

@app.route('/')
def index():
    """主页"""
    return send_from_directory('web', 'index.html')

@app.route('/favicon.ico')
def favicon():
    """网站图标"""
    try:
        return send_from_directory('web', 'favicon.ico')
    except Exception as e:
        # 如果没有favicon，返回空响应
        logger.debug(f"Favicon not found: {e}")
        return '', 204

@app.route('/<path:path>')
def static_files(path):
    """静态文件"""
    try:
        return send_from_directory('web', path)
    except Exception as e:
        logger.warning(f"Static file not found: {path} - {e}")
        # 对于常见的浏览器请求文件，返回204而不是404
        if path in ['favicon.ico', 'robots.txt', 'sitemap.xml', 'apple-touch-icon.png']:
            return '', 204
        return f"File not found: {path}", 404


# 任务管理API

@app.route('/api/v1/tasks', methods=['GET'])
def get_tasks():
    """获取所有任务"""
    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM tasks ORDER BY created_at DESC')
        tasks = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'data': tasks})
    except Exception as e:
        logger.error(f"Failed to get tasks: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks', methods=['POST'])
def create_task():
    """创建新任务"""
    try:
        data = request.json
        
        # 验证必需字段
        if not data.get('name') or not data.get('url'):
            return jsonify({'success': False, 'error': 'Name and URL are required'}), 400
        
        conn = db.get_connection()
        cursor = conn.cursor()
        
        now = datetime.now().isoformat()
        cursor.execute('''
            INSERT INTO tasks 
            (name, url, strategy, max_depth, thread_count, request_interval, 
             retry_times, respect_robots, allow_cross_domain, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data['name'],
            data['url'],
            data.get('strategy', 'bfs'),
            data.get('max_depth', 3),
            data.get('thread_count', 3),
            data.get('request_interval', 1.0),
            data.get('retry_times', 3),
            data.get('respect_robots', True),
            data.get('allow_cross_domain', False),
            'pending',
            now
        ))
        
        task_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        logger.info(f"Created task {task_id}: {data['name']}")
        return jsonify({'success': True, 'data': {'id': task_id}})
    
    except Exception as e:
        logger.error(f"Failed to create task: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>', methods=['GET'])
def get_task(task_id):
    """获取单个任务"""
    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM tasks WHERE id = ?', (task_id,))
        task = cursor.fetchone()
        conn.close()
        
        if task:
            return jsonify({'success': True, 'data': dict(task)})
        else:
            return jsonify({'success': False, 'error': 'Task not found'}), 404
    
    except Exception as e:
        logger.error(f"Failed to get task: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    """更新任务配置"""
    try:
        data = request.json
        logger.info(f"Updating task {task_id} with data: {data}")
        
        # 检查任务是否正在运行
        with crawler_lock:
            if task_id in active_crawlers:
                logger.warning(f"Attempt to update running task {task_id}. Active crawlers: {list(active_crawlers.keys())}")
                return jsonify({'success': False, 'error': '任务正在运行中，请先停止任务再修改配置'}), 400
            else:
                logger.info(f"Task {task_id} not in active crawlers. Active: {list(active_crawlers.keys())}")
        
        conn = db.get_connection()
        cursor = conn.cursor()
        
        # 检查任务是否存在
        cursor.execute('SELECT * FROM tasks WHERE id = ?', (task_id,))
        task = cursor.fetchone()
        if not task:
            conn.close()
            return jsonify({'success': False, 'error': 'Task not found'}), 404
        
        # 更新任务
        cursor.execute('''
            UPDATE tasks 
            SET name = ?, url = ?, strategy = ?, max_depth = ?, thread_count = ?,
                request_interval = ?, retry_times = ?, respect_robots = ?, allow_cross_domain = ?
            WHERE id = ?
        ''', (
            data.get('name', task['name']),
            data.get('url', task['url']),
            data.get('strategy', task['strategy']),
            data.get('max_depth', task['max_depth']),
            data.get('thread_count', task['thread_count']),
            data.get('request_interval', task['request_interval']),
            data.get('retry_times', task['retry_times']),
            data.get('respect_robots', task['respect_robots']),
            data.get('allow_cross_domain', task['allow_cross_domain']),
            task_id
        ))
        
        conn.commit()
        conn.close()
        
        logger.info(f"Updated task {task_id}: {data.get('name')}")
        return jsonify({'success': True})
    
    except Exception as e:
        logger.error(f"Failed to update task: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    """删除任务"""
    try:
        # 停止运行中的爬虫
        with crawler_lock:
            if task_id in active_crawlers:
                active_crawlers[task_id].stop()
                del active_crawlers[task_id]
        
        conn = db.get_connection()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
        cursor.execute('DELETE FROM url_records WHERE task_id = ?', (task_id,))
        conn.commit()
        conn.close()
        
        logger.info(f"Deleted task {task_id}")
        return jsonify({'success': True})
    
    except Exception as e:
        logger.error(f"Failed to delete task: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>/start', methods=['POST'])
def start_task(task_id):
    """启动任务"""
    try:
        # 检查任务是否已在运行
        with crawler_lock:
            if task_id in active_crawlers:
                return jsonify({'success': False, 'error': 'Task is already running'}), 400
        
        # 获取任务配置
        conn = db.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM tasks WHERE id = ?', (task_id,))
        task = cursor.fetchone()
        conn.close()
        
        if not task:
            return jsonify({'success': False, 'error': 'Task not found'}), 404
        
        task_config = dict(task)
        
        # 如果任务已完成或停止，重置任务数据
        if task['status'] in ['completed', 'stopped', 'failed']:
            logger.info(f"Restarting task {task_id} - resetting data")
            reset_task_data(task_id)
        
        # 启动任务时，总是将队列状态设为active
        conn = db.get_connection()
        cursor = conn.cursor()
        cursor.execute('UPDATE tasks SET queue_status = ? WHERE id = ?', ('active', task_id))
        conn.commit()
        conn.close()
        logger.info(f"Task {task_id} queue status set to active")
        
        # 创建并启动爬虫
        try:
            crawler = CrawlerThread(task_id, task_config, db, socketio)
            crawler.daemon = True
            crawler.start()
            
            with crawler_lock:
                active_crawlers[task_id] = crawler
            
            logger.info(f"Started task {task_id}")
            return jsonify({'success': True})
        except Exception as crawler_error:
            logger.error(f"Failed to create/start crawler for task {task_id}: {crawler_error}", exc_info=True)
            return jsonify({'success': False, 'error': f'Failed to start crawler: {str(crawler_error)}'}), 500
    
    except Exception as e:
        logger.error(f"Failed to start task: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>/pause', methods=['POST'])
def pause_task(task_id):
    """暂停任务"""
    try:
        with crawler_lock:
            if task_id not in active_crawlers:
                # 任务不在运行中，直接更新数据库状态
                logger.info(f"Task {task_id} not in active crawlers, updating database status to paused")
                conn = db.get_connection()
                cursor = conn.cursor()
                cursor.execute('UPDATE tasks SET status = ? WHERE id = ?', ('paused', task_id))
                conn.commit()
                conn.close()
                return jsonify({'success': True})
            
            active_crawlers[task_id].pause()
        
        return jsonify({'success': True})
    
    except Exception as e:
        logger.error(f"Failed to pause task: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>/resume', methods=['POST'])
def resume_task(task_id):
    """继续任务"""
    try:
        with crawler_lock:
            if task_id not in active_crawlers:
                # 任务不在运行中，检查是否是暂停状态，如果是则重新启动
                conn = db.get_connection()
                cursor = conn.cursor()
                cursor.execute('SELECT status FROM tasks WHERE id = ?', (task_id,))
                task = cursor.fetchone()
                conn.close()
                
                if task and task['status'] in ['paused', 'completed', 'stopped', 'failed']:
                    # 非运行状态的任务，重新启动
                    logger.info(f"Task {task_id} status is {task['status']}, restarting crawler")
                    
                    # 获取任务配置并重新启动
                    conn = db.get_connection()
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM tasks WHERE id = ?', (task_id,))
                    task_data = cursor.fetchone()
                    conn.close()
                    
                    if not task_data:
                        return jsonify({'success': False, 'error': 'Task not found'}), 404
                    
                    task_config = dict(task_data)
                    
                    # 如果任务已完成或停止，重置任务数据
                    if task['status'] in ['completed', 'stopped', 'failed']:
                        logger.info(f"Resetting task {task_id} data for restart")
                        reset_task_data(task_id)
                    
                    # 创建并启动爬虫
                    try:
                        crawler = CrawlerThread(task_id, task_config, db, socketio)
                        crawler.daemon = True
                        crawler.start()
                        
                        # 添加到活跃爬虫列表
                        active_crawlers[task_id] = crawler
                        
                        # 更新任务状态为运行中，并恢复队列状态
                        conn = db.get_connection()
                        cursor = conn.cursor()
                        cursor.execute('UPDATE tasks SET status = ?, queue_status = ? WHERE id = ?', ('running', 'active', task_id))
                        conn.commit()
                        conn.close()
                        
                        logger.info(f"Task {task_id} resumed successfully")
                        return jsonify({'success': True})
                        
                    except Exception as e:
                        logger.error(f"Failed to restart task {task_id}: {e}", exc_info=True)
                        return jsonify({'success': False, 'error': f'Failed to restart task: {str(e)}'}), 500
                else:
                    logger.info(f"Task {task_id} not in active crawlers and not paused, cannot resume")
                    return jsonify({'success': False, 'error': '任务未在运行，请使用重新开始'}), 400
            
            active_crawlers[task_id].resume()
        
        return jsonify({'success': True})
    
    except Exception as e:
        logger.error(f"Failed to resume task: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>/pause-queue', methods=['POST'])
def pause_task_queue(task_id):
    """暂停URL队列增长"""
    try:
        logger.info(f"Attempting to pause queue for task {task_id}")
        
        # 直接更新数据库中的队列状态
        conn = db.get_connection()
        cursor = conn.cursor()
        
        # 检查任务是否存在
        cursor.execute('SELECT id, status FROM tasks WHERE id = ?', (task_id,))
        task = cursor.fetchone()
        if not task:
            conn.close()
            return jsonify({'success': False, 'error': '任务不存在'}), 404
        
        # 更新队列状态
        cursor.execute('UPDATE tasks SET queue_status = ? WHERE id = ?', ('paused', task_id))
        conn.commit()
        conn.close()
        
        # 如果任务正在运行，也更新运行时状态
        with crawler_lock:
            if task_id in active_crawlers:
                active_crawlers[task_id].queue_paused = True
                logger.info(f"Updated running crawler queue status for task {task_id}")
        
        logger.info(f"Successfully paused queue for task {task_id}")
        return jsonify({'success': True})
    
    except Exception as e:
        logger.error(f"Failed to pause queue: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>/resume-queue', methods=['POST'])
def resume_task_queue(task_id):
    """恢复URL队列增长"""
    try:
        logger.info(f"Attempting to resume queue for task {task_id}")
        
        # 直接更新数据库中的队列状态
        conn = db.get_connection()
        cursor = conn.cursor()
        
        # 检查任务是否存在
        cursor.execute('SELECT id, status FROM tasks WHERE id = ?', (task_id,))
        task = cursor.fetchone()
        if not task:
            conn.close()
            return jsonify({'success': False, 'error': '任务不存在'}), 404
        
        # 更新队列状态
        cursor.execute('UPDATE tasks SET queue_status = ? WHERE id = ?', ('active', task_id))
        conn.commit()
        conn.close()
        
        # 如果任务正在运行，也更新运行时状态
        with crawler_lock:
            if task_id in active_crawlers:
                active_crawlers[task_id].queue_paused = False
                logger.info(f"Updated running crawler queue status for task {task_id}")
        
        logger.info(f"Successfully resumed queue for task {task_id}")
        return jsonify({'success': True})
    
    except Exception as e:
        logger.error(f"Failed to resume queue: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>/stop', methods=['POST'])
def stop_task(task_id):
    """停止任务"""
    try:
        with crawler_lock:
            if task_id in active_crawlers:
                # 任务在运行中，正常停止
                active_crawlers[task_id].stop()
                del active_crawlers[task_id]
                logger.info(f"Task {task_id} stopped")
            else:
                # 任务不在运行中，可能已经完成但状态未同步
                # 更新数据库状态为stopped
                logger.info(f"Task {task_id} not in active crawlers, updating database status")
        
        # 无论如何都更新数据库状态
        conn = db.get_connection()
        cursor = conn.cursor()
        cursor.execute('UPDATE tasks SET status = ? WHERE id = ?', ('stopped', task_id))
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
    
    except Exception as e:
        logger.error(f"Failed to stop task: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/monitor/<int:task_id>/current', methods=['GET'])
def get_monitor_data(task_id):
    """获取任务监控数据"""
    try:
        logger.debug(f"Getting monitor data for task {task_id}")
        with crawler_lock:
            if task_id in active_crawlers:
                crawler = active_crawlers[task_id]
                with crawler.queue_lock:
                    total_processed = crawler.completed_count + crawler.failed_count
                    success_rate = (crawler.completed_count / max(total_processed, 1)) * 100 if total_processed > 0 else 0.0
                    progress = (total_processed / max(crawler.total_urls_discovered, 1)) * 100 if crawler.total_urls_discovered > 0 else 0.0
                    
                    monitor_data = {
                        'task_id': task_id,
                        'status': crawler.status,
                        'queue_status': 'paused' if crawler.queue_paused else 'active',
                        'progress': progress,
                        'total_urls': crawler.total_urls_discovered,
                        'completed_urls': crawler.completed_count,
                        'failed_urls': crawler.failed_count,
                        'queue_size': crawler.url_queue.qsize(),
                        'success_rate': success_rate,
                        'total_bytes': crawler.total_bytes,
                        'avg_response_time': sum(crawler.response_times[-100:]) / len(crawler.response_times[-100:]) if crawler.response_times else 0,
                        'cross_domain_blocked_urls': crawler.cross_domain_blocked_count,
                        'depth_blocked_urls': crawler.depth_blocked_count,
                        'duplicate_urls': crawler.duplicate_count,
                        'threads': crawler.thread_stats
                    }
                    
                    logger.debug(f"Active task {task_id} monitor data: completed={crawler.completed_count}, bytes={crawler.total_bytes}")
                return jsonify({'success': True, 'data': monitor_data})
        
        # 如果爬虫不在运行，从数据库获取
        conn = db.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM tasks WHERE id = ?', (task_id,))
        task = cursor.fetchone()
        
        if task:
            task_dict = dict(task)
            
            # 从URL记录中计算实际的流量统计
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_records,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
                    SUM(CASE WHEN status = 'completed' THEN COALESCE(file_size, 0) ELSE 0 END) as actual_total_bytes,
                    AVG(CASE WHEN status = 'completed' AND response_time > 0 THEN response_time ELSE NULL END) as actual_avg_response
                FROM url_records 
                WHERE task_id = ?
            ''', (task_id,))
            
            stats = cursor.fetchone()
            
            # 如果没有URL记录，使用tasks表中的数据作为备选
            if stats and stats['total_records'] > 0:
                # 使用实际统计数据
                actual_completed = stats['completed_count'] or 0
                actual_failed = stats['failed_count'] or 0
                actual_total_bytes = stats['actual_total_bytes'] or 0
                actual_avg_response = stats['actual_avg_response'] or 0
                logger.debug(f"Task {task_id}: Using URL records stats - completed={actual_completed}, bytes={actual_total_bytes}")
            else:
                # 没有URL记录，使用tasks表数据
                actual_completed = task_dict['completed_urls'] or 0
                actual_failed = task_dict['failed_urls'] or 0
                actual_total_bytes = task_dict['total_bytes'] or 0
                actual_avg_response = task_dict['avg_response_time'] or 0
                logger.debug(f"Task {task_id}: No URL records, using tasks table stats - completed={actual_completed}, bytes={actual_total_bytes}")
            
            conn.close()
            
            actual_total_processed = actual_completed + actual_failed
            actual_success_rate = (actual_completed / max(actual_total_processed, 1)) * 100 if actual_total_processed > 0 else 0.0
            
            monitor_data = {
                'task_id': task_id,
                'status': task_dict['status'],
                'queue_status': task_dict.get('queue_status', 'active'),
                'progress': task_dict['progress'],
                'total_urls': task_dict['total_urls'],
                'completed_urls': actual_completed,
                'failed_urls': actual_failed,
                'queue_size': 0,
                'success_rate': actual_success_rate,
                'total_bytes': actual_total_bytes,  # 使用计算后的流量数据
                'avg_response_time': actual_avg_response,
                'threads': {}
            }
            return jsonify({'success': True, 'data': monitor_data})
        
        conn.close()
        
        return jsonify({'success': False, 'error': 'Task not found'}), 404
    
    except Exception as e:
        logger.error(f"Failed to get monitor data: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>/urls', methods=['GET'])
def get_task_urls(task_id):
    """获取任务的URL列表"""
    try:
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 50))
        status = request.args.get('status', '')
        content_type = request.args.get('content_type', '')
        prefix = request.args.get('prefix', '')  # URL前缀搜索
        ext = request.args.get('ext', '')  # 文件后缀筛选
        
        logger.info(f"Loading URLs for task {task_id} with filters: status={status}, prefix={prefix}, ext={ext}, page={page}")
        
        conn = db.get_connection()
        cursor = conn.cursor()
        
        # 构建查询
        query = 'SELECT * FROM url_records WHERE task_id = ?'
        params = [task_id]
        
        if status:
            query += ' AND status = ?'
            params.append(status)
        
        # URL前缀搜索 - 智能匹配
        if prefix:
            # 如果用户输入的不包含协议，尝试匹配多种可能的格式
            if not prefix.startswith(('http://', 'https://')):
                query += ' AND (url LIKE ? OR url LIKE ? OR url LIKE ?)'
                params.extend([
                    f'https://{prefix}%',  # https://前缀
                    f'http://{prefix}%',   # http://前缀
                    f'%{prefix}%'          # 包含搜索
                ])
            else:
                query += ' AND url LIKE ?'
                params.append(f'{prefix}%')
        
        # 文件后缀筛选
        if ext:
            query += ' AND url LIKE ?'
            params.append(f'%{ext}')
        
        if content_type:
            if content_type == 'image':
                query += ' AND content_type LIKE ?'
                params.append('image/%')
            elif content_type == 'video':
                query += ' AND content_type LIKE ?'
                params.append('video/%')
            elif content_type == 'audio':
                query += ' AND content_type LIKE ?'
                params.append('audio/%')
            elif content_type == 'other':
                query += ''' AND (content_type IS NULL OR (
                            content_type NOT LIKE 'text/%' 
                            AND content_type NOT LIKE 'image/%' 
                            AND content_type NOT LIKE 'video/%' 
                            AND content_type NOT LIKE 'audio/%' 
                            AND content_type != 'application/pdf'
                            AND content_type != 'application/javascript'
                            AND content_type != 'application/json'
                            AND content_type != 'application/zip')) '''
            else:
                query += ' AND content_type = ?'
                params.append(content_type)
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
        params.extend([page_size, (page - 1) * page_size])
        
        logger.info(f"Executing query: {query}")
        logger.info(f"Query params: {params}")
        
        cursor.execute(query, params)
        urls = [dict(row) for row in cursor.fetchall()]
        
        logger.info(f"Found {len(urls)} URLs matching filters")
        
        # 获取总数
        count_query = 'SELECT COUNT(*) as total FROM url_records WHERE task_id = ?'
        count_params = [task_id]
        if status:
            count_query += ' AND status = ?'
            count_params.append(status)
        
        if prefix:
            # 同样的智能匹配逻辑
            if not prefix.startswith(('http://', 'https://')):
                count_query += ' AND (url LIKE ? OR url LIKE ? OR url LIKE ?)'
                count_params.extend([
                    f'https://{prefix}%',
                    f'http://{prefix}%',
                    f'%{prefix}%'
                ])
            else:
                count_query += ' AND url LIKE ?'
                count_params.append(f'{prefix}%')
        
        if ext:
            count_query += ' AND url LIKE ?'
            count_params.append(f'%{ext}')
        
        if content_type:
            if content_type == 'image':
                count_query += ' AND content_type LIKE ?'
                count_params.append('image/%')
            elif content_type == 'video':
                count_query += ' AND content_type LIKE ?'
                count_params.append('video/%')
            elif content_type == 'audio':
                count_query += ' AND content_type LIKE ?'
                count_params.append('audio/%')
            elif content_type == 'other':
                count_query += ''' AND (content_type IS NULL OR (
                                  content_type NOT LIKE 'text/%' 
                                  AND content_type NOT LIKE 'image/%' 
                                  AND content_type NOT LIKE 'video/%' 
                                  AND content_type NOT LIKE 'audio/%' 
                                  AND content_type != 'application/pdf'
                                  AND content_type != 'application/javascript'
                                  AND content_type != 'application/json'
                                  AND content_type != 'application/zip')) '''
            else:
                count_query += ' AND content_type = ?'
                count_params.append(content_type)
        
        cursor.execute(count_query, count_params)
        total = cursor.fetchone()['total']
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'urls': urls,
                'total': total,
                'page': page,
                'page_size': page_size
            }
        })
    
    except Exception as e:
        logger.error(f"Failed to get task URLs: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500




@app.route('/api/v1/tasks/<int:task_id>/stats', methods=['GET'])
def get_task_stats(task_id):
    """获取任务统计信息"""
    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        
        # 文件类型统计
        cursor.execute('''
            SELECT content_type, COUNT(*) as count, SUM(file_size) as total_size
            FROM url_records
            WHERE task_id = ? AND status = 'completed'
            GROUP BY content_type
            ORDER BY count DESC
        ''', (task_id,))
        file_types = [dict(row) for row in cursor.fetchall()]
        
        # 域名统计
        cursor.execute('''
            SELECT COUNT(DISTINCT 
                CASE 
                    WHEN url LIKE 'http://%' THEN SUBSTR(url, 8, INSTR(SUBSTR(url, 8), '/') - 1)
                    WHEN url LIKE 'https://%' THEN SUBSTR(url, 9, INSTR(SUBSTR(url, 9), '/') - 1)
                    ELSE url
                END
            ) as domain_count
            FROM url_records
            WHERE task_id = ?
        ''', (task_id,))
        domain_count = cursor.fetchone()['domain_count']
        
        # 状态统计
        cursor.execute('''
            SELECT status, COUNT(*) as count
            FROM url_records
            WHERE task_id = ?
            GROUP BY status
        ''', (task_id,))
        status_stats = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'file_types': file_types,
                'domain_count': domain_count,
                'status_stats': status_stats
            }
        })
    
    except Exception as e:
        logger.error(f"Failed to get task stats: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/debug/active-crawlers', methods=['GET'])
def get_active_crawlers():
    """获取活跃的爬虫列表（调试用）"""
    try:
        with crawler_lock:
            active_list = list(active_crawlers.keys())
        return jsonify({'success': True, 'active_crawlers': active_list})
    except Exception as e:
        logger.error(f"Failed to get active crawlers: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/debug/force-cleanup/<int:task_id>', methods=['POST'])
def force_cleanup_task(task_id):
    """强制清理僵尸任务（调试用）"""
    try:
        with crawler_lock:
            if task_id in active_crawlers:
                logger.info(f"Force cleaning up zombie task {task_id}")
                try:
                    active_crawlers[task_id].stop()
                except:
                    pass
                del active_crawlers[task_id]
                return jsonify({'success': True, 'message': f'Task {task_id} cleaned up'})
            else:
                return jsonify({'success': True, 'message': f'Task {task_id} not in active list'})
    except Exception as e:
        logger.error(f"Failed to cleanup task: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>/export', methods=['GET'])
def export_task_data(task_id):
    """导出任务数据"""
    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM url_records WHERE task_id = ?', (task_id,))
        urls = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        
        return jsonify({'success': True, 'data': urls})
    
    except Exception as e:
        logger.error(f"Failed to export task data: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/download', methods=['GET'])
def download_file():
    """下载文件 - 直接通过爬虫下载，不使用缓存"""
    try:
        url = request.args.get('url', '')
        task_id = request.args.get('task_id', '')
        
        if not url:
            return jsonify({'success': False, 'error': 'URL is required'}), 400
        
        # 从URL中提取文件名，处理中文编码
        try:
            from urllib.parse import unquote
            parsed = urlparse(url)
            
            # 先解码URL
            path_part = unquote(parsed.path, encoding='utf-8', errors='replace')
            filename = path_part.split('/')[-1] or 'download'
            
            if not '.' in filename:
                filename += '.html'
            
            # 确保文件名是安全的，移除或替换非法字符
            import re
            filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', filename)
            
            # 限制文件名长度
            if len(filename) > 200:
                name_part, ext_part = filename.rsplit('.', 1) if '.' in filename else (filename, '')
                filename = name_part[:190] + ('.' + ext_part if ext_part else '')
                
        except Exception as e:
            logger.warning(f"Failed to parse filename from URL {url}: {e}")
            filename = f'download_{hash(url) % 10000}.html'
        
        # 直接通过爬虫下载，不使用任何缓存
        content = None
        content_type = 'application/octet-stream'
        
        logger.info(f"Downloading fresh content for {url}")
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive'
        }
        
        # 使用会话和重试机制
        session = requests.Session()
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        try:
            response = session.get(url, headers=headers, timeout=(10, 30), verify=True, allow_redirects=True)
            response.raise_for_status()
            
            content = response.content
            content_type = response.headers.get('Content-Type', 'application/octet-stream')
            logger.info(f"Successfully downloaded {url}, size: {len(content)} bytes")
        except requests.exceptions.HTTPError as e:
            # 如果是404，尝试返回一个简单的错误页面而不是完全失败
            if e.response.status_code == 404:
                logger.warning(f"URL not found (404): {url}")
                content = f"<html><body><h1>404 Not Found</h1><p>The requested URL was not found: {url}</p></body></html>".encode('utf-8')
                content_type = 'text/html'
            else:
                raise
        except Exception as e:
            logger.error(f"Failed to download {url}: {e}")
            # 返回错误页面而不是抛出异常
            content = f"<html><body><h1>Download Error</h1><p>Failed to download: {url}</p><p>Error: {str(e)}</p></body></html>".encode('utf-8')
            content_type = 'text/html'
        
        # 创建响应，正确处理中文文件名
        from flask import Response
        import urllib.parse
        
        # RFC 5987编码中文文件名
        encoded_filename = urllib.parse.quote(filename.encode('utf-8'))
        
        return Response(
            content,
            headers={
                'Content-Disposition': f'attachment; filename*=UTF-8\'\'{encoded_filename}',
                'Content-Type': content_type
            }
        )
    
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to download file from {url}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    except UnicodeError as e:
        logger.error(f"Unicode error processing file {url}: {e}")
        return jsonify({'success': False, 'error': f'Unicode encoding error: {str(e)}'}), 500
    except Exception as e:
        logger.error(f"Failed to download file from {url}: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/v1/tasks/<int:task_id>/analysis', methods=['GET'])
def get_task_analysis(task_id):
    """获取任务数据分析"""
    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        
        # 深度分布
        cursor.execute('''
            SELECT depth, COUNT(*) as count 
            FROM url_records 
            WHERE task_id = ? AND status = 'completed'
            GROUP BY depth 
            ORDER BY depth
        ''', (task_id,))
        depth_distribution = [{'depth': row[0], 'count': row[1]} for row in cursor.fetchall()]
        
        # 文件大小分布
        cursor.execute('''
            SELECT 
                CASE 
                    WHEN file_size < 1024 THEN 0
                    WHEN file_size < 10240 THEN 1
                    WHEN file_size < 102400 THEN 2
                    WHEN file_size < 1048576 THEN 3
                    ELSE 4
                END as size_range,
                COUNT(*) as count
            FROM url_records 
            WHERE task_id = ? AND status = 'completed' AND file_size > 0
            GROUP BY size_range
            ORDER BY size_range
        ''', (task_id,))
        size_data = cursor.fetchall()
        size_distribution = [0, 0, 0, 0, 0]
        for row in size_data:
            size_distribution[row[0]] = row[1]
        
        # 响应时间分布
        cursor.execute('''
            SELECT 
                CASE 
                    WHEN response_time < 0.1 THEN 0
                    WHEN response_time < 0.5 THEN 1
                    WHEN response_time < 1.0 THEN 2
                    WHEN response_time < 5.0 THEN 3
                    ELSE 4
                END as time_range,
                COUNT(*) as count
            FROM url_records 
            WHERE task_id = ? AND status = 'completed' AND response_time > 0
            GROUP BY time_range
            ORDER BY time_range
        ''', (task_id,))
        time_data = cursor.fetchall()
        response_time_distribution = [0, 0, 0, 0, 0]
        for row in time_data:
            response_time_distribution[row[0]] = row[1]
        
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'depth_distribution': depth_distribution,
                'size_distribution': size_distribution,
                'response_time_distribution': response_time_distribution
            }
        })
    
    except Exception as e:
        logger.error(f"Failed to get task analysis: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


# 静态文件路由已在前面定义，这里删除重复定义

# WebSocket事件处理器
@socketio.on('connect')
def handle_connect():
    """客户端连接事件"""
    logger.info(f"Client connected: {request.sid}")
    emit('connected', {'message': 'WebSocket连接成功'})

@socketio.on('disconnect')
def handle_disconnect():
    """客户端断开连接事件"""
    logger.info(f"Client disconnected: {request.sid}")

@socketio.on('join_task')
def handle_join_task(data):
    """客户端加入任务监控房间"""
    task_id = data.get('task_id')
    if task_id:
        join_room(f'task_{task_id}')
        logger.info(f"Client {request.sid} joined task {task_id} room")
        emit('joined_task', {'task_id': task_id})

@socketio.on('leave_task')
def handle_leave_task(data):
    """客户端离开任务监控房间"""
    task_id = data.get('task_id')
    if task_id:
        leave_room(f'task_{task_id}')
        logger.info(f"Client {request.sid} left task {task_id} room")

def broadcast_monitor_data(task_id, monitor_data):
    """广播监控数据到指定任务房间"""
    socketio.emit('monitor_update', monitor_data, room=f'task_{task_id}')

def broadcast_task_status(task_id, status_data):
    """广播任务状态变更"""
    socketio.emit('task_status_update', status_data, room=f'task_{task_id}')


if __name__ == '__main__':
    logger.info("Starting Intelligent Web Crawler System...")
    logger.info("Server running on http://localhost:8000")
    logger.info("WebSocket enabled for real-time communication")
    # 使用SocketIO运行，支持WebSocket连接
    socketio.run(app, host='0.0.0.0', port=8000, debug=False)

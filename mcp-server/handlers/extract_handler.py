#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
MCP 工具 - 内容提取指令处理器
负责处理内容提取相关的指令
"""

import asyncio
import logging
import json
import uuid
import base64
from datetime import datetime
from pathlib import Path
from bs4 import BeautifulSoup
import re
import os
import io
from PIL import Image
import requests

logger = logging.getLogger('extract_handler')


class ExtractHandler:
    """内容提取指令处理器类"""

    def __init__(self, server):
        """初始化内容提取指令处理器

        Args:
            server (MCPServer): MCP 服务器实例
        """
        self.server = server
        self.protocol = server.protocol
        self.output_dir = server.output_dir / 'extracts'
        self.output_dir.mkdir(exist_ok=True)
        self.image_dir = self.output_dir / 'images'
        self.image_dir.mkdir(exist_ok=True)

    async def handle_command(self, client_id, task):
        """处理内容提取指令

        Args:
            client_id (str): 客户端 ID
            task (dict): 任务信息
        """
        command_id = task['id']
        params = task['params']
        url = params.get('url')

        if not url:
            await self.protocol.send_error(
                client_id,
                "缺少必要参数: url",
                command_id
            )
            return

        logger.info(f"处理内容提取指令: {url}")

        # 构建内容提取命令
        extract_command = {
            'type': 'command',
            'id': command_id,
            'command': 'extract',
            'url': url,
            'extractImages': params.get('extractImages', True),
            'extractLinks': params.get('extractLinks', True),
            'selectors': params.get('selectors')
        }

        # 发送命令给客户端
        await self.protocol.send_message(client_id, extract_command)

        # 等待客户端响应由 handle_response 方法处理

    async def handle_response(self, client_id, response):
        """处理客户端的内容提取响应

        Args:
            client_id (str): 客户端 ID
            response (dict): 响应消息
        """
        command_id = response.get('id')
        success = response.get('success', False)

        if not success:
            error_message = response.get('error', '未知错误')
            logger.error(f"内容提取失败: {error_message}")
            return

        result = response.get('result', {})
        if not result:
            logger.error("内容提取响应缺少结果数据")
            return

        # 处理提取结果
        await self._process_extract_result(client_id, command_id, result)

    async def _process_extract_result(self, client_id, command_id, result):
        """处理内容提取结果

        Args:
            client_id (str): 客户端 ID
            command_id (str): 命令 ID
            result (dict): 提取结果
        """
        try:
            # 获取页面信息
            url = result.get('url', '')
            title = result.get('title', '')
            timestamp = result.get('timestamp', datetime.now().isoformat())
            content = result.get('content', {})
            page_info = result.get('pageInfo', {})

            if not content and not page_info:
                logger.warning(f"提取结果缺少内容数据: {url}")
                return

            # 创建安全的文件名
            safe_title = self._create_safe_filename(title or url)
            timestamp_str = datetime.fromisoformat(timestamp).strftime('%Y%m%d_%H%M%S')
            filename = f"{timestamp_str}_{safe_title[:50]}"

            # 创建输出目录结构
            extract_dir = self.output_dir / filename
            extract_dir.mkdir(exist_ok=True)
            assets_dir = extract_dir / 'assets'
            assets_dir.mkdir(exist_ok=True)

            # 保存提取结果
            output_path = extract_dir / f"content.json"
            html_path = extract_dir / f"content.html"
            text_path = extract_dir / f"content.txt"

            # 处理图片（如果有）
            images = result.get('images', [])
            processed_images = []

            for i, img in enumerate(images):
                img_src = img.get('src', '')
                if not img_src:
                    continue

                # 如果是 data URL，解码并保存
                if img_src.startswith('data:image/'):
                    img_path = await self._save_data_url_image(img_src, assets_dir / f"image_{i}")
                else:
                    # 下载远程图片
                    img_path = await self._download_image(img_src, assets_dir / f"image_{i}")

                if img_path:
                    img['local_path'] = str(img_path.relative_to(self.server.output_dir))
                    img['filename'] = img_path.name
                    processed_images.append(img)

            # 处理链接（如果有）
            links = result.get('links', [])
            processed_links = []

            for link in links:
                if 'href' in link and 'text' in link:
                    processed_links.append({
                        'href': link['href'],
                        'text': link['text'],
                        'title': link.get('title', ''),
                        'rel': link.get('rel', '')
                    })

            # 构建结构化内容
            structured_content = {
                'url': url,
                'title': title,
                'timestamp': timestamp,
                'metadata': {
                    'description': page_info.get('description', ''),
                    'keywords': page_info.get('keywords', ''),
                    'author': page_info.get('author', ''),
                    'favicon': page_info.get('favicon', '')
                },
                'content': content,
                'images': processed_images,
                'links': processed_links,
                'stats': {
                    'image_count': len(processed_images),
                    'link_count': len(processed_links),
                    'text_length': len(content.get('text', '')) if isinstance(content.get('text'), str) else 0
                }
            }

            # 保存 JSON 结果
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(structured_content, f, ensure_ascii=False, indent=2)

            # 保存 HTML 内容
            html_content = content.get('html', '')
            if html_content:
                # 处理HTML中的相对路径
                soup = BeautifulSoup(html_content, 'html.parser')
                
                # 处理图片路径
                for img_tag in soup.find_all('img'):
                    src = img_tag.get('src', '')
                    if not src:
                        continue
                        
                    # 查找对应的已处理图片
                    for img in processed_images:
                        if img.get('src') == src and 'local_path' in img:
                            # 更新为本地路径
                            img_tag['src'] = f"assets/{img['filename']}"
                            img_tag['data-original-src'] = src
                            break
                
                # 保存处理后的HTML
                with open(html_path, 'w', encoding='utf-8') as f:
                    f.write(str(soup))

            # 保存纯文本内容
            text_content = content.get('text', '')
            if text_content:
                with open(text_path, 'w', encoding='utf-8') as f:
                    f.write(text_content)

            # 发送处理完成消息给客户端
            await self.protocol.send_message(client_id, {
                'type': 'extract_complete',
                'id': command_id,
                'url': url,
                'title': title,
                'timestamp': timestamp,
                'output_path': str(output_path.relative_to(self.server.output_dir)),
                'extract_dir': str(extract_dir.relative_to(self.server.output_dir)),
                'image_count': len(processed_images),
                'link_count': len(processed_links)
            })

            logger.info(f"内容提取完成: {url} -> {output_path}")

        except Exception as e:
            logger.error(f"处理提取结果时出错: {e}", exc_info=True)
            await self.protocol.send_error(
                client_id,
                f"处理提取结果时出错: {str(e)}",
                command_id
            )

    def _create_safe_filename(self, text):
        """创建安全的文件名

        Args:
            text (str): 原始文本

        Returns:
            str: 安全的文件名
        """
        # 移除非法字符
        safe_name = re.sub(r'[\\/*?:"<>|]', '_', text)
        # 移除多余的空格和下划线
        safe_name = re.sub(r'\s+', '_', safe_name)
        safe_name = re.sub(r'_+', '_', safe_name)
        # 确保文件名不为空
        if not safe_name or safe_name.isspace():
            safe_name = 'untitled'
        return safe_name

    async def _save_data_url_image(self, data_url, base_path):
        """保存 data URL 图片

        Args:
            data_url (str): 图片的 data URL
            base_path (Path): 基础文件路径（不含扩展名）

        Returns:
            Path: 保存的图片路径，失败则返回 None
        """
        try:
            # 解析 data URL
            header, encoded = data_url.split(',', 1)
            content_type = header.split(';')[0].split(':')[1] if ':' in header else 'image/jpeg'
            img_format = content_type.split('/')[1] if '/' in content_type else 'jpeg'
            
            # 规范化图片格式
            if img_format.lower() in ['jpeg', 'jpg']:
                img_format = 'jpg'
            elif img_format.lower() == 'svg+xml':
                img_format = 'svg'
            
            # 确保格式有效
            if img_format not in ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']:
                img_format = 'jpg'  # 默认格式

            # 解码 base64 数据
            try:
                binary_data = base64.b64decode(encoded)
            except Exception as decode_error:
                logger.error(f"Base64解码失败: {decode_error}")
                return None

            # 验证图片数据
            if img_format != 'svg':
                try:
                    img = Image.open(io.BytesIO(binary_data))
                    img.verify()  # 验证图片完整性
                    # 重新打开以便保存（verify会关闭文件）
                    img = Image.open(io.BytesIO(binary_data))
                    # 转换为RGB模式（处理RGBA等情况）
                    if img.mode in ['RGBA', 'LA'] and img_format == 'jpg':
                        background = Image.new('RGB', img.size, (255, 255, 255))
                        background.paste(img, mask=img.split()[3])
                        img = background
                except Exception as img_error:
                    logger.error(f"图片验证失败: {img_error}")
                    return None

            # 保存图片
            img_path = base_path.with_suffix(f".{img_format}")
            
            if img_format == 'svg':
                with open(img_path, 'wb') as f:
                    f.write(binary_data)
            else:
                img.save(img_path, format=img_format.upper())

            return img_path
        except Exception as e:
            logger.error(f"保存 data URL 图片失败: {e}")
            return None

    async def _download_image(self, url, base_path):
        """下载远程图片

        Args:
            url (str): 图片 URL
            base_path (Path): 基础文件路径（不含扩展名）

        Returns:
            Path: 保存的图片路径，失败则返回 None
        """
        try:
            # 提取文件扩展名
            ext = os.path.splitext(url.split('?')[0])[1].lower()
            if not ext or len(ext) > 5 or ext[1:] not in ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']:
                ext = '.jpg'  # 默认扩展名
            
            # 规范化扩展名
            if ext in ['.jpeg', '.jpg']:
                ext = '.jpg'

            # 下载图片
            try:
                response = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: requests.get(url, timeout=15, stream=True, 
                                              headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'})
                )
                response.raise_for_status()
            except requests.exceptions.RequestException as req_error:
                logger.error(f"图片下载请求失败 {url}: {req_error}")
                return None

            # 检查内容类型
            content_type = response.headers.get('Content-Type', '')
            if 'image' not in content_type and 'svg' not in content_type:
                logger.warning(f"非图片内容类型: {content_type}, URL: {url}")
                # 尝试继续处理，因为有些服务器可能返回错误的内容类型

            # 保存图片
            img_path = base_path.with_suffix(ext)
            
            # 保存原始图片数据
            with open(img_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            # 验证图片（除了SVG）
            if ext != '.svg':
                try:
                    img = Image.open(img_path)
                    img.verify()  # 验证图片完整性
                except Exception as img_error:
                    logger.error(f"下载的图片验证失败 {url}: {img_error}")
                    if img_path.exists():
                        img_path.unlink()  # 删除无效图片
                    return None

            return img_path
        except Exception as e:
            logger.error(f"下载图片失败 {url}: {e}")
            return None
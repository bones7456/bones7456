const express = require('express');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const cors = require('cors');

// 在 Electron 环境中获取 BrowserWindow（用于反爬虫回退）
let ElectronBrowserWindow = null;
try {
    const electron = require('electron');
    ElectronBrowserWindow = electron.BrowserWindow;
} catch (e) {
    // 非 Electron 环境（如直接 node server.js 调试时）
}

// 用隐藏 BrowserWindow 抓取页面（真实 Chromium，能绕过大多数反爬检测）
function fetchWithHeadlessBrowser(url) {
    return new Promise((resolve, reject) => {
        const win = new ElectronBrowserWindow({
            show: false,
            webPreferences: {
                javascript: true,
                nodeIntegration: false,
                contextIsolation: true,
            }
        });

        let settled = false;
        function settle(fn, val) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            win.destroy();
            fn(val);
        }

        const timer = setTimeout(() => {
            settle(reject, new Error('Page load timeout (30s)'));
        }, 30000);

        win.webContents.on('dom-ready', async () => {
            try {
                const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
                const finalUrl = win.webContents.getURL();
                settle(resolve, { html, finalUrl });
            } catch (e) {
                settle(reject, e);
            }
        });

        win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (isMainFrame) {
                settle(reject, new Error(`Browser load failed: ${errorDescription} (${errorCode})`));
            }
        });

        win.loadURL(url);
    });
}

const app = express();
app.use(cors()); // 允许前端跨域调用
app.use(express.json());

app.get('/api/read', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing URL parameter' });
    }

    try {
        // 1. 抓取网页内容（先尝试 axios，失败时回退到真实浏览器）
        let htmlContent;
        let resolvedUrl = targetUrl;

        try {
            const response = await axios.get(targetUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
                }
            });
            htmlContent = response.data;
        } catch (axiosErr) {
            if (ElectronBrowserWindow) {
                console.log(`[Fetch] axios 失败 (${axiosErr.message})，切换到浏览器模式...`);
                const result = await fetchWithHeadlessBrowser(targetUrl);
                htmlContent = result.html;
                resolvedUrl = result.finalUrl;
            } else {
                throw axiosErr;
            }
        }

        // 2. 创建虚拟 DOM
        const dom = new JSDOM(htmlContent, { url: resolvedUrl });
        const doc = dom.window.document;

        // 2.5 预处理：解析 CSS 样式，保留通过 CSS 类设置的斜体/粗体
        // 这是通用的解决方案，适用于任何使用 CSS 类来设置样式的网站
        
        // 从 <style> 标签中提取定义了 italic 和 bold 的类名
        const styleElements = doc.querySelectorAll('style');
        const italicClasses = new Set();
        const boldClasses = new Set();
        
        // 正则匹配 CSS 规则中的 font-style: italic 和 font-weight: bold/700+
        const cssClassRegex = /\.([a-zA-Z_][\w-]*)\s*\{[^}]*font-style\s*:\s*italic[^}]*\}/g;
        const cssBoldRegex = /\.([a-zA-Z_][\w-]*)\s*\{[^}]*font-weight\s*:\s*(bold|[7-9]00)[^}]*\}/g;
        
        styleElements.forEach(styleEl => {
            const cssText = styleEl.textContent || '';
            
            // 查找斜体类
            let match;
            while ((match = cssClassRegex.exec(cssText)) !== null) {
                italicClasses.add(match[1]);
            }
            cssClassRegex.lastIndex = 0;
            
            // 查找粗体类
            while ((match = cssBoldRegex.exec(cssText)) !== null) {
                boldClasses.add(match[1]);
            }
            cssBoldRegex.lastIndex = 0;
        });
        
        // 处理使用斜体类的元素
        italicClasses.forEach(className => {
            doc.querySelectorAll(`.${className}`).forEach(el => {
                const tagName = el.tagName.toLowerCase();
                if (tagName === 'em' || tagName === 'i' || tagName === 'script' || tagName === 'style') return;
                if (el.innerHTML.trim().startsWith('<em') || el.innerHTML.trim().startsWith('<i')) return;
                
                const em = doc.createElement('em');
                em.innerHTML = el.innerHTML;
                el.innerHTML = '';
                el.appendChild(em);
            });
        });
        
        // 处理使用粗体类的元素
        boldClasses.forEach(className => {
            doc.querySelectorAll(`.${className}`).forEach(el => {
                const tagName = el.tagName.toLowerCase();
                if (tagName === 'strong' || tagName === 'b' || tagName === 'script' || tagName === 'style') return;
                if (el.innerHTML.trim().startsWith('<strong') || el.innerHTML.trim().startsWith('<b')) return;
                
                const strong = doc.createElement('strong');
                strong.innerHTML = el.innerHTML;
                el.innerHTML = '';
                el.appendChild(strong);
            });
        });
        
        // 处理内联 style 属性中的斜体/粗体
        const elementsWithInlineStyle = doc.querySelectorAll('[style]');
        elementsWithInlineStyle.forEach(el => {
            const style = el.getAttribute('style') || '';
            const tagName = el.tagName.toLowerCase();
            
            if (style.includes('italic') && tagName !== 'em' && tagName !== 'i') {
                const em = doc.createElement('em');
                em.innerHTML = el.innerHTML;
                el.innerHTML = '';
                el.appendChild(em);
            }
            if ((style.includes('bold') || /font-weight\s*:\s*[7-9]00/.test(style)) && tagName !== 'strong' && tagName !== 'b') {
                const strong = doc.createElement('strong');
                strong.innerHTML = el.innerHTML;
                el.innerHTML = '';
                el.appendChild(strong);
            }
        });
        
        // 处理 blockquote 标签，自动添加斜体
        const blockquotes = doc.querySelectorAll('blockquote');
        blockquotes.forEach(bq => {
            const firstChild = bq.firstElementChild;
            const isAlreadyItalic = firstChild && 
                (firstChild.tagName.toLowerCase() === 'em' || firstChild.tagName.toLowerCase() === 'i');
            
            if (!isAlreadyItalic && bq.innerHTML.trim()) {
                const em = doc.createElement('em');
                em.innerHTML = bq.innerHTML;
                bq.innerHTML = '';
                bq.appendChild(em);
            }
        });

        // 2.6 预处理：处理懒加载图片，确保图片能被正确保留
        // 很多网站（如 BBC）使用懒加载，真实 URL 在 data-src 或 srcset 中
        
        // 2.6.1 特殊处理：Substack 图片
        // Substack 的图片 URL 有时会包含损坏的参数（如 $s_!U377!），导致图片无法加载
        // 但在 data-attrs 属性中包含了原始的 S3 图片 URL
        const substackImages = doc.querySelectorAll('img[data-attrs]');
        substackImages.forEach(img => {
            try {
                const dataAttrs = img.getAttribute('data-attrs');
                if (dataAttrs) {
                    const attrs = JSON.parse(dataAttrs);
                    // 提取原始 S3 URL
                    const originalSrc = attrs.src || attrs.srcNoWatermark;
                    if (originalSrc && originalSrc.includes('substack-post-media.s3.amazonaws.com')) {
                        // 直接使用 S3 源 URL，无需经过 substackcdn 的图片处理
                        img.setAttribute('src', originalSrc);
                        img.removeAttribute('srcset');
                        console.log(`[Substack] 修复图片: ${originalSrc.substring(0, 80)}...`);
                    }
                }
            } catch (e) {
                // JSON 解析失败，忽略
            }
        });
        
        // 2.6.2 处理 Substack 的 <picture> 元素中损坏的 URL
        // 检测包含 $s_ 等损坏参数的 URL
        const allImagesForFix = doc.querySelectorAll('img');
        allImagesForFix.forEach(img => {
            const src = img.getAttribute('src') || '';
            // 检测损坏的 substackcdn URL (包含 $s_ 或其他非法参数)
            if (src.includes('substackcdn.com') && (src.includes('$s_') || src.includes('%24s_'))) {
                // 尝试从 URL 中提取原始 S3 路径
                const s3Match = src.match(/https%3A%2F%2Fsubstack-post-media\.s3\.amazonaws\.com[^,\s]+/);
                if (s3Match) {
                    const decodedUrl = decodeURIComponent(s3Match[0]);
                    img.setAttribute('src', decodedUrl);
                    img.removeAttribute('srcset');
                    console.log(`[Substack] 从 URL 提取源图片: ${decodedUrl.substring(0, 80)}...`);
                }
            }
        });
        
        // 处理 <picture> 元素，提取最佳图片源
        const pictures = doc.querySelectorAll('picture');
        pictures.forEach(picture => {
            // 尝试从 source 获取最大的图片
            const sources = picture.querySelectorAll('source');
            let bestSrc = '';
            
            // 首先检查 picture 内的 img 是否有 data-attrs
            const img = picture.querySelector('img');
            if (img) {
                const dataAttrs = img.getAttribute('data-attrs');
                if (dataAttrs) {
                    try {
                        const attrs = JSON.parse(dataAttrs);
                        const originalSrc = attrs.src || attrs.srcNoWatermark;
                        if (originalSrc && originalSrc.startsWith('http')) {
                            img.setAttribute('src', originalSrc);
                            img.removeAttribute('srcset');
                            // 清理 source 元素，避免浏览器使用损坏的 srcset
                            sources.forEach(s => s.remove());
                            return; // 已处理，跳过后续逻辑
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
            
            sources.forEach(source => {
                const srcset = source.getAttribute('srcset');
                if (srcset) {
                    // 解析 srcset，获取最大的图片 URL
                    const srcsetParts = srcset.split(',').map(s => s.trim());
                    srcsetParts.forEach(part => {
                        const [url] = part.split(/\s+/);
                        // 跳过包含损坏参数的 URL
                        if (url && url.startsWith('http') && !url.includes('$s_') && !url.includes('%24s_')) {
                            bestSrc = url;
                        }
                    });
                }
            });
            
            // 获取 picture 中的 img 标签
            if (img && bestSrc) {
                img.setAttribute('src', bestSrc);
                img.removeAttribute('srcset');
                img.removeAttribute('data-src');
            }
        });
        
        // 处理普通的懒加载图片
        const images = doc.querySelectorAll('img');
        images.forEach(img => {
            // 尝试从各种属性获取真实图片 URL
            const dataSrc = img.getAttribute('data-src') || 
                           img.getAttribute('data-lazy-src') || 
                           img.getAttribute('data-original') ||
                           img.getAttribute('data-srcset');
            
            const srcset = img.getAttribute('srcset');
            let currentSrc = img.getAttribute('src') || '';
            
            // 如果 src 是占位图或 base64，尝试使用其他来源
            const isPlaceholder = !currentSrc || 
                                  currentSrc.startsWith('data:') || 
                                  currentSrc.includes('placeholder') ||
                                  currentSrc.includes('grey') ||
                                  currentSrc.includes('blank');
            
            if (isPlaceholder) {
                // 优先使用 data-src
                if (dataSrc && dataSrc.startsWith('http')) {
                    img.setAttribute('src', dataSrc);
                }
                // 其次从 srcset 提取
                else if (srcset) {
                    const srcsetParts = srcset.split(',').map(s => s.trim());
                    for (const part of srcsetParts) {
                        const [url] = part.split(/\s+/);
                        if (url && url.startsWith('http')) {
                            img.setAttribute('src', url);
                            break;
                        }
                    }
                }
            }
            
            // 如果 srcset 有更高清的图片，使用 srcset 中最大的
            if (srcset && !isPlaceholder) {
                const srcsetParts = srcset.split(',').map(s => s.trim());
                let largestUrl = currentSrc;
                let largestWidth = 0;
                
                srcsetParts.forEach(part => {
                    const match = part.match(/^(\S+)\s+(\d+)w$/);
                    if (match) {
                        const width = parseInt(match[2]);
                        if (width > largestWidth) {
                            largestWidth = width;
                            largestUrl = match[1];
                        }
                    }
                });
                
                if (largestUrl && largestUrl !== currentSrc) {
                    img.setAttribute('src', largestUrl);
                }
            }
            
            // 清理懒加载相关属性
            img.removeAttribute('data-src');
            img.removeAttribute('data-lazy-src');
            img.removeAttribute('data-original');
            img.removeAttribute('loading');
        });
        
        // 调试：打印前几个图片的 src
        const allImgs = doc.querySelectorAll('img');
        console.log(`[图片处理] 处理了 ${pictures.length} 个 picture 元素, ${allImgs.length} 个 img 元素`);
        allImgs.forEach((img, i) => {
            if (i < 5) {  // 只打印前5个
                console.log(`  img[${i}] src: ${(img.getAttribute('src') || '').substring(0, 100)}`);
            }
        });

        // 3. 特殊处理：将视频转换为封面图逻辑
        // 注意：这是最难的部分。原生 <video> 有 poster 属性，但 iframe 嵌入的 (如 YouTube) 需要特殊解析。
        // 这里做一个简单的 <video> 标签处理示例。
        const videos = doc.querySelectorAll('video');
        videos.forEach(video => {
            const poster = video.getAttribute('poster');
            const img = doc.createElement('img');
            // 如果有封面图就用封面，没有就用一个占位图
            img.src = poster || 'https://via.placeholder.com/640x360?text=Video+Content';
            img.style.width = '100%';
            img.className = 'video-placeholder';
            video.parentNode.replaceChild(img, video);
        });
        
        // 简单处理 YouTube Iframe (示例)
        const iframes = doc.querySelectorAll('iframe');
        iframes.forEach(iframe => {
             // 简单的检测逻辑，实际生产环境需要更复杂的正则
             if(iframe.src.includes('youtube.com') || iframe.src.includes('youtu.be')) {
                 const div = doc.createElement('div');
                 div.innerText = '[Embedded Video Placeholder]';
                 div.style.border = '1px solid #ccc';
                 div.style.padding = '20px';
                 div.style.textAlign = 'center';
                 iframe.parentNode.replaceChild(div, iframe);
             }
        });


        // 3.5 在 Readability 处理前，保护文章中的子标题（段落标题）
        // Readability 可能会移除被 div 包裹的 h1/h2/h3 等标题
        const articleContainer = doc.querySelector('article, main, [role="main"], .post-content, .body-markup') || doc.body;
        
        // 找到文章中所有的子标题（h1-h4），将它们"提升"到更容易被 Readability 保留的位置
        const subHeadings = articleContainer.querySelectorAll('h1, h2, h3, h4');
        let protectedHeadingCount = 0;
        
        subHeadings.forEach((heading, index) => {
            // 跳过空标题
            const text = heading.textContent.trim();
            if (!text || text.length === 0) return;
            
            // 检查标题是否被多层 div 包裹（这种情况 Readability 可能会移除）
            const parent = heading.parentElement;
            if (!parent) return;
            
            const parentTag = parent.tagName.toLowerCase();
            
            // 如果标题的父元素是 div 且不是 article/main/section
            // 则创建一个"保护性"的结构
            if (['div', 'span'].includes(parentTag)) {
                // 找到标题后面最近的段落
                let nextP = heading.nextElementSibling;
                while (nextP && !['p', 'ul', 'ol', 'blockquote'].includes(nextP.tagName.toLowerCase())) {
                    // 跳过其他 div 容器，找里面的内容
                    if (nextP.tagName.toLowerCase() === 'div') {
                        const innerP = nextP.querySelector('p, ul, ol, blockquote');
                        if (innerP) {
                            nextP = innerP;
                            break;
                        }
                    }
                    nextP = nextP.nextElementSibling;
                }
                
                // 创建一个新的标题元素，直接放在段落前面
                // 使用 h2 作为子标题的默认级别（除非原来就是 h3/h4）
                const newTag = heading.tagName.toLowerCase() === 'h1' ? 'h2' : heading.tagName.toLowerCase();
                const newHeading = doc.createElement(newTag);
                newHeading.textContent = text;
                newHeading.setAttribute('data-protected-heading', 'true');
                
                if (nextP && nextP.parentNode) {
                    // 在段落前面插入新标题
                    nextP.parentNode.insertBefore(newHeading, nextP);
                    protectedHeadingCount++;
                } else {
                    // 找不到后面的段落，尝试找更广泛的范围
                    // 在 articleContainer 中找到合适的位置
                    const allParagraphs = articleContainer.querySelectorAll('p');
                    let targetP = null;
                    
                    // 找到第一个在当前标题之后的段落
                    // DOCUMENT_POSITION_FOLLOWING = 4
                    for (const p of allParagraphs) {
                        // 使用 compareDocumentPosition 判断位置关系
                        if (heading.compareDocumentPosition(p) & 4) {
                            targetP = p;
                            break;
                        }
                    }
                    
                    if (targetP && targetP.parentNode) {
                        targetP.parentNode.insertBefore(newHeading, targetP);
                        protectedHeadingCount++;
                    }
                }
            }
        });
        
        console.log(`[标题保护] 处理了 ${subHeadings.length} 个子标题，保护了 ${protectedHeadingCount} 个`);

        // 3.6 在 Readability 处理前，将图片"锚定"到相邻段落中
        // 这样 Readability 提取正文时会保留图片，且位置精确
        
        // 辅助函数：判断图片是否为有效的内容图片（非占位图、非小图标）
        function isValidContentImage(img) {
            const src = img.getAttribute('src') || '';
            if (!src || !src.startsWith('http')) return false;
            
            // 排除占位图
            if (src.includes('grey-placehold') || src.includes('placeholder') || src.includes('data:')) return false;
            
            // 排除明显的小图标（通过 URL 判断）
            if (src.includes('/icon') || src.includes('favicon') || src.includes('avatar') || src.includes('logo')) return false;
            
            // 排除非常小的图片（通过属性判断）
            const width = parseInt(img.getAttribute('width') || '0');
            const height = parseInt(img.getAttribute('height') || '0');
            if (width > 0 && width < 100 && height > 0 && height < 100) return false;
            
            return true;
        }
        
        // 辅助函数：找到元素前面最近的段落/标题/列表项
        function findPreviousTextBlock(element) {
            let current = element;
            
            // 先找到图片的容器（figure, picture, div 等）
            const container = element.closest('figure, .image2-inset, picture, .captioned-image-container') || element;
            current = container;
            
            // 向前遍历兄弟节点
            while (current) {
                let prev = current.previousElementSibling;
                while (prev) {
                    // 如果是文本块元素（p, h1-h6, li）
                    const tagName = prev.tagName.toLowerCase();
                    if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].includes(tagName)) {
                        // 确保有实际文本内容
                        if (prev.textContent && prev.textContent.trim().length > 0) {
                            return prev;
                        }
                    }
                    // 如果是 div 或其他容器，检查里面是否有文本块
                    if (['div', 'section', 'article'].includes(tagName)) {
                        const innerBlock = prev.querySelector('p, h1, h2, h3, h4, h5, h6, li');
                        if (innerBlock && innerBlock.textContent && innerBlock.textContent.trim().length > 0) {
                            // 返回容器内最后一个文本块
                            const allBlocks = prev.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
                            if (allBlocks.length > 0) {
                                return allBlocks[allBlocks.length - 1];
                            }
                        }
                    }
                    prev = prev.previousElementSibling;
                }
                
                // 向上一层继续找
                current = current.parentElement;
                if (!current || current.tagName === 'BODY' || current.tagName === 'HTML') break;
            }
            
            return null;
        }
        
        // 辅助函数：找到元素后面最近的段落/标题/列表项
        function findNextTextBlock(element) {
            let current = element;
            const container = element.closest('figure, .image2-inset, picture, .captioned-image-container') || element;
            current = container;
            
            while (current) {
                let next = current.nextElementSibling;
                while (next) {
                    const tagName = next.tagName.toLowerCase();
                    if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].includes(tagName)) {
                        if (next.textContent && next.textContent.trim().length > 0) {
                            return next;
                        }
                    }
                    if (['div', 'section', 'article'].includes(tagName)) {
                        const innerBlock = next.querySelector('p, h1, h2, h3, h4, h5, h6, li');
                        if (innerBlock && innerBlock.textContent && innerBlock.textContent.trim().length > 0) {
                            return innerBlock;
                        }
                    }
                    next = next.nextElementSibling;
                }
                current = current.parentElement;
                if (!current || current.tagName === 'BODY' || current.tagName === 'HTML') break;
            }
            
            return null;
        }
        
        // 收集所有需要锚定的图片
        const processedSrcs = new Set();
        let anchoredCount = 0;
        
        // 按 DOM 顺序获取所有图片
        const allImagesInArticle = articleContainer.querySelectorAll('img');
        
        allImagesInArticle.forEach((img, index) => {
            if (!isValidContentImage(img)) return;
            
            const src = img.getAttribute('src');
            if (processedSrcs.has(src)) return;
            processedSrcs.add(src);
            
            // 检查图片是否已经在段落内
            const parentP = img.closest('p, h1, h2, h3, h4, h5, h6, li');
            if (parentP) {
                // 已经在段落内，不需要处理
                return;
            }
            
            // 获取图片容器（保留 figure 结构和 caption）
            const container = img.closest('figure, .image2-inset, picture') || img;
            
            // 创建一个标记元素，用于在原位置插入图片
            // 使用特殊的 data 属性来标记这是一个锚定图片
            const marker = doc.createElement('span');
            marker.setAttribute('data-img-anchor', 'true');
            marker.setAttribute('data-img-src', src);
            marker.style.display = 'block';
            marker.style.margin = '20px 0';
            
            // 克隆图片（或整个 figure）
            let imgElement;
            if (container.tagName === 'FIGURE') {
                imgElement = container.cloneNode(true);
            } else {
                imgElement = doc.createElement('figure');
                imgElement.style.margin = '20px 0';
                const clonedImg = img.cloneNode(true);
                clonedImg.style.maxWidth = '100%';
                clonedImg.style.height = 'auto';
                imgElement.appendChild(clonedImg);
            }
            
            marker.appendChild(imgElement);
            
            // 找到前面最近的段落
            const prevBlock = findPreviousTextBlock(img);
            
            if (prevBlock) {
                // 在前一个段落后面插入图片标记
                prevBlock.parentNode.insertBefore(marker, prevBlock.nextSibling);
                anchoredCount++;
            } else {
                // 找不到前面的段落，尝试找后面的
                const nextBlock = findNextTextBlock(img);
                if (nextBlock) {
                    nextBlock.parentNode.insertBefore(marker, nextBlock);
                    anchoredCount++;
                }
            }
        });
        
        console.log(`[图片锚定] 处理了 ${processedSrcs.size} 个图片，成功锚定 ${anchoredCount} 个`);

        // 4. 使用 Readability 提取正文
        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article) {
            return res.status(500).json({ error: 'Failed to parse content' });
        }

        // Readability 输出分析
        let articleContent = article.content;
        const emCount = (articleContent.match(/<em/g) || []).length;
        const strongCount = (articleContent.match(/<strong/g) || []).length;
        let imgCount = (articleContent.match(/<img/g) || []).length;
        console.log(`[Readability] 标题: ${article.title} | 内容长度: ${articleContent.length} | <em>: ${emCount} | <strong>: ${strongCount} | <img>: ${imgCount}`);
        
        // 4.5 清理锚定标记的样式，检查是否还有缺失的图片
        // 提取 Readability 输出中的图片
        const finalImgCount = (articleContent.match(/<img/g) || []).length;
        console.log(`[图片结果] Readability 输出包含 ${finalImgCount} 个图片`);
        
        // 清理可能残留的 data-img-anchor span 标签（保留内容）
        articleContent = articleContent.replace(/<span[^>]*data-img-anchor[^>]*>/gi, '');
        articleContent = articleContent.replace(/<\/span>/gi, function(match, offset) {
            // 只移除与 data-img-anchor 相关的闭合标签
            // 这里简单处理，移除所有 </span>
            return '';
        });
        
        // 检查是否还有未被保留的图片（通过对比 processedSrcs）
        const existingImgUrls = new Set();
        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;
        let imgMatch;
        while ((imgMatch = imgRegex.exec(articleContent)) !== null) {
            existingImgUrls.add(imgMatch[1]);
        }
        
        // 找出缺失的图片
        const missingImages = [];
        processedSrcs.forEach(src => {
            if (!existingImgUrls.has(src)) {
                missingImages.push(src);
            }
        });
        
        if (missingImages.length > 0) {
            console.log(`[图片补充] 还有 ${missingImages.length} 个图片未被保留，添加到末尾`);
            let appendHtml = '';
            missingImages.forEach(src => {
                appendHtml += `<figure style="margin: 20px 0;"><img src="${src}" style="max-width: 100%; height: auto;"></figure>`;
            });
            articleContent += appendHtml;
        }

        // 4.7 去重：图片锚定会克隆 figure、标题保护会克隆 heading，原位置和新位置可能同时被 Readability 保留
        {
            const tempDom = new JSDOM(`<div id="root">${articleContent}</div>`);
            const root = tempDom.window.document.getElementById('root');
            let removedImgs = 0;
            let removedHeadings = 0;

            const seenSrcs = new Set();
            root.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src');
                if (!src) return;
                if (seenSrcs.has(src)) {
                    const target = img.closest('figure, picture') || img;
                    if (target.parentNode) {
                        target.parentNode.removeChild(target);
                        removedImgs++;
                    }
                } else {
                    seenSrcs.add(src);
                }
            });

            const seenHeadings = new Set();
            root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
                const text = (h.textContent || '').trim();
                if (!text) return;
                const key = `${h.tagName}:${text}`;
                if (seenHeadings.has(key)) {
                    h.parentNode && h.parentNode.removeChild(h);
                    removedHeadings++;
                } else {
                    seenHeadings.add(key);
                }
            });

            if (removedImgs > 0 || removedHeadings > 0) {
                console.log(`[去重] 移除重复图片 ${removedImgs} 个，重复标题 ${removedHeadings} 个`);
                articleContent = root.innerHTML;
            }
        }

        imgCount = (articleContent.match(/<img/g) || []).length;

        // 5. 返回结构化数据
        res.json({
            title: article.title,
            content: articleContent,
            byline: article.byline
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch url' });
    }
});

// 导出启动函数，而不是直接启动
function startServer(port = 3000) {
    return new Promise((resolve, reject) => {
        try {
            app.listen(port, () => {
                console.log(`Server running on http://localhost:${port}`);
                resolve();
            });
        } catch (err) {
            reject(err);
        }
    });
}

// 如果直接运行 server.js，则启动服务器（用于开发环境）
if (require.main === module) {
    startServer(3000);
}

module.exports = { startServer, app };

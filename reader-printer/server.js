const express = require('express');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const cors = require('cors');

const app = express();
app.use(cors()); // 允许前端跨域调用
app.use(express.json());

app.get('/api/read', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing URL parameter' });
    }

    try {
        // 1. 抓取网页内容
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
            }
        });

        // 2. 创建虚拟 DOM
        const dom = new JSDOM(response.data, { url: targetUrl });
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
        
        // 处理 <picture> 元素，提取最佳图片源
        const pictures = doc.querySelectorAll('picture');
        pictures.forEach(picture => {
            // 尝试从 source 获取最大的图片
            const sources = picture.querySelectorAll('source');
            let bestSrc = '';
            
            sources.forEach(source => {
                const srcset = source.getAttribute('srcset');
                if (srcset) {
                    // 解析 srcset，获取最大的图片 URL
                    const srcsetParts = srcset.split(',').map(s => s.trim());
                    srcsetParts.forEach(part => {
                        const [url] = part.split(/\s+/);
                        if (url && url.startsWith('http')) {
                            bestSrc = url;
                        }
                    });
                }
            });
            
            // 获取 picture 中的 img 标签
            const img = picture.querySelector('img');
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


        // 3.5 在 Readability 处理前，保存文章中的有效图片
        // BBC 等网站的图片通常在 figure 元素中，Readability 可能会移除它们
        const savedImages = [];
        const figures = doc.querySelectorAll('figure');
        figures.forEach(figure => {
            const img = figure.querySelector('img');
            const figcaption = figure.querySelector('figcaption');
            if (img) {
                const src = img.getAttribute('src') || '';
                // 只保存有效的图片（排除占位图）
                if (src && src.startsWith('http') && !src.includes('grey-placehold') && !src.includes('placeholder')) {
                    savedImages.push({
                        src: src,
                        alt: img.getAttribute('alt') || '',
                        caption: figcaption ? figcaption.textContent.trim() : ''
                    });
                }
            }
        });
        
        // 也检查直接的 img 标签（不在 figure 中的）
        doc.querySelectorAll('article img, main img, [role="main"] img').forEach(img => {
            const src = img.getAttribute('src') || '';
            if (src && src.startsWith('http') && !src.includes('grey-placehold') && !src.includes('placeholder')) {
                // 检查是否已保存
                if (!savedImages.some(saved => saved.src === src)) {
                    savedImages.push({
                        src: src,
                        alt: img.getAttribute('alt') || '',
                        caption: ''
                    });
                }
            }
        });
        
        console.log(`[图片备份] 保存了 ${savedImages.length} 个有效图片`);

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
        
        // 4.5 如果 Readability 移除了图片，将备份的图片插入到内容开头
        if (imgCount === 0 && savedImages.length > 0) {
            console.log(`[图片恢复] Readability 移除了图片，正在恢复 ${savedImages.length} 个图片...`);
            
            // 生成图片 HTML
            let imagesHtml = '';
            savedImages.forEach(imgInfo => {
                imagesHtml += `<figure style="margin: 20px 0;">`;
                imagesHtml += `<img src="${imgInfo.src}" alt="${imgInfo.alt}" style="max-width: 100%; height: auto;">`;
                if (imgInfo.caption) {
                    imagesHtml += `<figcaption style="font-size: 0.9em; color: #666; margin-top: 8px;">${imgInfo.caption}</figcaption>`;
                }
                imagesHtml += `</figure>`;
            });
            
            // 将图片插入到内容中（在第一个段落后）
            const firstParagraphEnd = articleContent.indexOf('</p>');
            if (firstParagraphEnd !== -1) {
                articleContent = articleContent.slice(0, firstParagraphEnd + 4) + imagesHtml + articleContent.slice(firstParagraphEnd + 4);
            } else {
                // 如果没有段落，直接添加到开头
                articleContent = imagesHtml + articleContent;
            }
            
            imgCount = savedImages.length;
            console.log(`[图片恢复] 成功恢复 ${imgCount} 个图片`);
        }

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

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

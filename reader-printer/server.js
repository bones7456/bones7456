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
        let quietTimer = null;
        function settle(fn, val) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearTimeout(quietTimer);
            win.destroy();
            fn(val);
        }

        const timer = setTimeout(() => {
            settle(reject, new Error('Page load timeout (30s)'));
        }, 30000);

        // AWS WAF 这类反爬挑战会先加载一个跑校验脚本的挑战页，脚本跑完再 reload/跳转到
        // 真正的页面——dom-ready 只在第一次（挑战页本身）触发，抓早了拿到的是空壳。
        // 改成等导航"安静"下来再抓 HTML：每次发生新导航就把倒计时重置，直到 1.5s
        // 内没有新导航，才认为页面真正稳定，此时抓到的才是挑战通过后的最终内容
        function captureWhenQuiet() {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(async () => {
                try {
                    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
                    const finalUrl = win.webContents.getURL();
                    settle(resolve, { html, finalUrl });
                } catch (e) {
                    settle(reject, e);
                }
            }, 1500);
        }

        win.webContents.on('did-navigate', captureWhenQuiet);
        win.webContents.on('did-navigate-in-page', captureWhenQuiet);
        win.webContents.on('did-finish-load', captureWhenQuiet);

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

            // 反爬挑战页：状态码是 2xx，axios 不会当成失败，但正文是空的或只有寥寥数字节
            // （例如 AWS WAF 对自动化请求返回 202 + x-amzn-waf-action: challenge，无正文），
            // 得自己识别，回退到能跑 JS、更像真实用户的浏览器模式
            const contentLen = htmlContent ? String(htmlContent).trim().length : 0;
            if (contentLen < 200 && ElectronBrowserWindow) {
                console.log(`[Fetch] axios 拿到的内容像是反爬挑战页（长度 ${contentLen}），切换到浏览器模式...`);
                const result = await fetchWithHeadlessBrowser(targetUrl);
                htmlContent = result.html;
                resolvedUrl = result.finalUrl;
            }
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

        // 2.2 移除正文周边的附属区块
        // Readability 只按文字量给容器打分，一旦附属块比正文还长就会整段选错：
        // snexplores.org 的文章末尾挂着一个 Power Words 术语表（40 个词条、约 7900 字符），
        // 比正文本身（约 5500 字符）还长，结果被当成了正文；而它的 class
        // "article-footer__power-words" 里带着 "article"，正好命中 Readability
        // 的豁免规则，它自带的 unlikelyCandidates 拦不住。
        // 放在克隆 pristineDoc 之前：这一步只做减法，兜底路径同样需要一份干净的文档。
        {
            const noiseScope = doc.querySelector('article, main, [role="main"]') || doc.body;

            // 正文锚点：先用 meta description 的开头去定位正文首段，定位不到就退而取最长的段落。
            // 附属块里的段落都很碎（术语条目、推荐语、分享按钮），最长段落落在正文里是相当稳的假设。
            const paragraphs = [...noiseScope.querySelectorAll('p')];
            const descMeta = doc.querySelector('meta[property="og:description"], meta[name="description"]');
            const descHead = ((descMeta && descMeta.getAttribute('content')) || '').trim().substring(0, 40);
            const anchorP =
                (descHead.length >= 20 && paragraphs.find(p => p.textContent.includes(descHead))) ||
                paragraphs.reduce((longest, p) =>
                    p.textContent.trim().length > (longest ? longest.textContent.trim().length : 0) ? p : longest, null);

            // 术语表 / 相关阅读 / 推荐轮播 / 分享 / 订阅 / 评论这几类块的通用命名
            const NOISE_BLOCK = new RegExp([
                'power[-_]?words', 'glossar', 'newsletter', 'subscri', 'sign-?up', 'comment', 'share', 'social',
                'related', 'recommend', 'read-?more', 'more-?stories', 'more-on', 'trending', 'popular',
                'breadcrumb', 'author-?bio', 'promo', 'sidebar', 'widget', 'post-list', 'carousel', 'swiper', 'slider'
            ].join('|'), 'i');

            let removedBlocks = 0;
            const dropBlock = el => {
                // 含正文锚点的元素一律不动；已随父节点一起摘掉的直接跳过
                if (!el.isConnected || el === noiseScope || el.contains(anchorP)) return;
                el.parentNode.removeChild(el);
                removedBlocks++;
            };

            // 标签比 class 可靠：正文不会长在 <footer> / <aside> 里
            noiseScope.querySelectorAll('footer, aside').forEach(dropBlock);
            // 再用 class/id 关键词兜住那些用 <div> 拼出来的同类区块
            noiseScope.querySelectorAll('[class], [id]').forEach(el => {
                // 先剥掉布局修饰词再匹配：header 的 "with-sidebar" 说的是自己旁边有侧栏，
                // 它本身是正文头部（文章头图就在里面），不是侧栏
                const key = `${el.getAttribute('class') || ''} ${el.id || ''}`
                    .replace(/\b(with|has|no|without)-[\w-]*/g, ' ');
                if (NOISE_BLOCK.test(key)) dropBlock(el);
            });

            if (removedBlocks > 0) {
                console.log(`[附属区块] 移除了 ${removedBlocks} 个正文外的区块（术语表/相关阅读/分享/订阅等）`);
            }
        }

        // 留一份未经预处理的副本作为兜底：下面的预处理都是启发式的，
        // 在没适配过的站点上有可能把 Readability 引到错误的容器上（正文整段丢失）
        const pristineDoc = doc.cloneNode(true);

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

        // 只保护"正文里的"标题。导航栏、推荐卡片、相关阅读里的标题必须跳过：
        // 它们数量多且往往找不到相邻段落，会被兜底逻辑一股脑塞进同一个容器，
        // 反而把那个容器喂成 Readability 眼里的最佳候选，导致真正的正文被丢弃
        // （BBC 文章页就是这种情况：11 个推荐卡片标题挤进了同一个 card-text-wrapper）
        const NON_ARTICLE_CONTAINER = 'nav, aside, header, footer, [role="navigation"], ' +
            '[role="complementary"], [data-component="links-block"], ' +
            '[class*="card"], [class*="promo"], [class*="related"], [class*="recommend"], ' +
            '[data-testid*="card"]';
        // 标题还要多排除一条：<a> 里的标题必然是链接卡片，不是正文子标题
        // （图片不能用这条——正文配图经常被 <a> 包起来点开看大图）
        const NON_ARTICLE_HEADING = `a, ${NON_ARTICLE_CONTAINER}`;

        // 页面标题：正文里再插一份就成了重复标题（前端已经单独渲染 title）
        const pageTitleKey = (() => {
            const ogTitle = doc.querySelector('meta[property="og:title"]');
            const raw = (ogTitle && ogTitle.getAttribute('content')) || doc.title || '';
            return raw.toLowerCase().replace(/[^a-z0-9一-龥]/g, '');
        })();

        // 找到文章中所有的子标题（h1-h4），将它们"提升"到更容易被 Readability 保留的位置
        const subHeadings = articleContainer.querySelectorAll('h1, h2, h3, h4');
        const usedFallbackTargets = new Set();
        let protectedHeadingCount = 0;

        subHeadings.forEach((heading, index) => {
            // 跳过空标题
            const text = heading.textContent.trim();
            if (!text || text.length === 0) return;

            // 跳过链接标题 / 导航与推荐区块里的标题
            if (heading.closest(NON_ARTICLE_HEADING)) return;

            // 跳过与页面标题相同的标题
            if (pageTitleKey && text.toLowerCase().replace(/[^a-z0-9一-龥]/g, '') === pageTitleKey) return;

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
                    // 找不到相邻段落，退一步在标题所属的内容块里找
                    // 限定在最近的内容块内，且一个段落只接收一个标题，
                    // 避免多个标题堆到同一处、把无关容器撑成最佳候选
                    const scope = heading.closest('article, section, [class*="body"], [class*="content"], [class*="post"]')
                        || articleContainer;
                    let targetP = null;

                    // 找到第一个在当前标题之后的段落
                    // DOCUMENT_POSITION_FOLLOWING = 4
                    for (const p of scope.querySelectorAll('p')) {
                        // 使用 compareDocumentPosition 判断位置关系
                        if ((heading.compareDocumentPosition(p) & 4) && !usedFallbackTargets.has(p)) {
                            targetP = p;
                            break;
                        }
                    }

                    if (targetP && targetP.parentNode) {
                        usedFallbackTargets.add(targetP);
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

            // 排除推荐卡片/导航里的缩略图：锚定它们会让 4.5 把一堆无关小图补到正文末尾。
            // 例外是正文容器自己的 <header>——文章头图就放在那里，它不是页面导航
            const noiseAncestor = img.closest(NON_ARTICLE_CONTAINER);
            if (noiseAncestor &&
                !(noiseAncestor.tagName === 'HEADER' && articleContainer.contains(noiseAncestor))) return false;

            // 排除占位图
            if (src.includes('grey-placehold') || src.includes('placeholder') || src.includes('data:')) return false;
            
            // 排除明显的小图标（通过 URL 判断）
            if (src.includes('/icon') || src.includes('favicon') || src.includes('avatar') || src.includes('logo')) return false;

            // 排除埋点/统计像素图：newsfilecorp 这类通稿分发页会在正文末尾埋一个
            // <img class="tracker" src="https://api.xxx/newsinfo/.../">，没有可见尺寸，
            // 靠 class 名或 API 风格的 src 路径识别，避免它被当成正文配图保留下来
            const className = img.getAttribute('class') || '';
            if (/track|pixel|beacon/i.test(className)) return false;
            if (/^https?:\/\/api\./i.test(src)) return false;

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
        // 正文首段之前的图片是文章头图。Readability 常常连着 <header> 一起丢掉，
        // 4.5 再补回来时得放到正文开头——追加到末尾就成了文不对图
        const heroSrcs = new Set();
        const firstBodyP = [...articleContainer.querySelectorAll('p')]
            .find(p => p.textContent.trim().length > 80);
        let anchoredCount = 0;
        
        // 按 DOM 顺序获取所有图片
        const allImagesInArticle = articleContainer.querySelectorAll('img');
        
        allImagesInArticle.forEach((img, index) => {
            if (!isValidContentImage(img)) return;
            
            const src = img.getAttribute('src');
            if (processedSrcs.has(src)) return;
            processedSrcs.add(src);

            // 文章 <header> 里的图必然是头图；否则看它是不是排在正文首段之前
            // （DOCUMENT_POSITION_FOLLOWING = 4：首段在图片之后）
            const ownHeader = img.closest('header');
            if ((ownHeader && articleContainer.contains(ownHeader)) ||
                (firstBodyP && (img.compareDocumentPosition(firstBodyP) & 4))) {
                heroSrcs.add(src);
            }
            
            // 检查图片是否已经在段落内
            const parentP = img.closest('p, h1, h2, h3, h4, h5, h6, li');
            if (parentP) {
                // "点击查看大图"这类配图段落——图片包在 <a> 里，段落里几乎全是链接文字，
                // 链接密度过高会被 Readability 当噪音整段删掉，图片跟着丢失，
                // 因此仍需在旁边补一个锚点兜底；真正的正文段落（链接密度低）维持不处理
                const linkTextLen = [...parentP.querySelectorAll('a')]
                    .reduce((sum, a) => sum + a.textContent.trim().length, 0);
                const ownTextLen = parentP.textContent.trim().length;
                const highLinkDensity = parentP.tagName.toLowerCase() === 'p' &&
                    ownTextLen > 0 && linkTextLen / ownTextLen > 0.5;
                if (!highLinkDensity) return;
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
        let article = reader.parse();

        // 4.1 兜底：拿未经预处理的副本再提一次，如果预处理版的正文明显更短，
        // 说明预处理把 Readability 带偏了，改用原始版本
        // （预处理只会往正文里补标题和图片，正常情况下不该变短）
        const pristineArticle = new Readability(pristineDoc).parse();
        const textLen = a => (a && a.textContent ? a.textContent.trim().length : 0);

        if (textLen(pristineArticle) > textLen(article) * 2) {
            console.log(`[兜底] 预处理后正文只有 ${textLen(article)} 字符，原始提取有 ${textLen(pristineArticle)} 字符，改用原始提取结果`);
            article = pristineArticle;
        }

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
            console.log(`[图片补充] 还有 ${missingImages.length} 个图片未被保留，补回正文（头图 ${missingImages.filter(src => heroSrcs.has(src)).length} 个放开头）`);
            let prependHtml = '';
            let appendHtml = '';
            missingImages.forEach(src => {
                const figure = `<figure style="margin: 20px 0;"><img src="${src}" style="max-width: 100%; height: auto;"></figure>`;
                if (heroSrcs.has(src)) {
                    prependHtml += figure;
                } else {
                    appendHtml += figure;
                }
            });
            articleContent = prependHtml + articleContent + appendHtml;
        }

        // 4.7 输出清理：去重 + 去掉正文里的噪音（占位图、图片来源署名、作者/时间戳块、空壳元素）
        {
            const tempDom = new JSDOM(`<div id="root">${articleContent}</div>`);
            const root = tempDom.window.document.getElementById('root');
            let removedImgs = 0;
            let removedHeadings = 0;
            let removedNoise = 0;
            const drop = el => {
                if (el && el.parentNode) {
                    el.parentNode.removeChild(el);
                    removedNoise++;
                }
            };

            // (a) 占位图：懒加载网站会在真图旁边放一张灰色占位图，正文里就是一块空白。
            //     必须赶在去重之前删掉——所有占位图共用同一个 src，去重会把它们当成
            //     "重复图片"，进而把整个 figure（连同里面的正文图）一起删掉
            root.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src') || '';
                const ariaLabel = img.getAttribute('aria-label') || '';
                const className = img.getAttribute('class') || '';
                const isPlaceholder = !src
                    || src.startsWith('data:')
                    || /placehold|grey-placehold|blank\.(gif|png)|spacer\.(gif|png)/i.test(src)
                    || /unavailable/i.test(ariaLabel);
                // 埋点/统计像素图：newsfilecorp 这类通稿分发页会在正文里塞一个
                // <img class="tracker" src="https://api.xxx/...">，本身不该出现在正文里
                const isTrackingPixel = /track|pixel|beacon/i.test(className)
                    || /^https?:\/\/api\./i.test(src);
                if (isPlaceholder || isTrackingPixel) drop(img.closest('picture') || img);
            });

            const seenSrcs = new Set();
            root.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src');
                if (!src || !img.parentNode) return;
                if (seenSrcs.has(src)) {
                    // 只有 figure 里的图片全是重复的，才连 figure 一起删（保住图注）；
                    // 否则只删这一张，别牵连同一个 figure 里的其他图
                    const fig = img.closest('figure, picture');
                    const sole = fig && [...fig.querySelectorAll('img')]
                        .every(other => seenSrcs.has(other.getAttribute('src')));
                    const target = sole ? fig : img;
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
            }

            // (b) 图片来源署名：网站常把来源塞进 alt 开头，同时在图片旁边再显示一遍
            //     （BBC 的 alt="Ben Wodecki A firefighter in the aisle..." + <span>Ben Wodecki</span>）
            root.querySelectorAll('img[alt]').forEach(img => {
                const alt = (img.getAttribute('alt') || '').trim();
                if (!alt) return;
                // 限定在图片自己的容器内找，别扩散到外层大 div 误伤正文
                const scope = img.closest('figure') || img.parentElement;
                if (!scope) return;
                scope.querySelectorAll('span, div, p, small, cite, b, strong').forEach(el => {
                    if (el.querySelector('img') || el.closest('figcaption')) return;
                    const text = (el.textContent || '').trim();
                    // 只删短标签，且必须是 alt 的真前缀（整段 alt 说明是图片描述，要留）
                    if (!text || text.length > 60 || text.length >= alt.length) return;
                    if (alt.startsWith(text)) drop(el);
                });
            });

            // (c) 作者/时间戳块：前端已经单独渲染 title 和 byline，正文里重复一遍是噪音
            root.querySelectorAll('[class*="byline"], [data-component*="byline"], [data-testid*="byline"]').forEach(drop);
            root.querySelectorAll('time').forEach(t => {
                // 只删独占一行的时间戳，句子中间的 <time> 要留
                const holder = t.parentElement;
                if (holder && (holder.textContent || '').trim() === (t.textContent || '').trim()) {
                    drop(holder);
                } else {
                    drop(t);
                }
            });

            // (d) 空壳元素：上面删完会留下一堆空容器，加上 Readability 本来就会产出空 <p>
            //     反复扫描，直到没有新的空元素（删掉内层后外层才变空）
            for (let pass = 0; pass < 5; pass++) {
                const before = removedNoise;
                root.querySelectorAll('p, div, span, figure, section, ul, ol, li, small, cite').forEach(el => {
                    if (!el.parentNode) return;
                    if ((el.textContent || '').trim()) return;
                    if (el.querySelector('img, br, hr, video, audio, iframe, svg')) return;
                    drop(el);
                });
                if (removedNoise === before) break;
            }

            if (removedNoise > 0) {
                console.log(`[噪音清理] 移除 ${removedNoise} 个占位图/署名/时间戳/空元素`);
            }

            if (removedImgs > 0 || removedHeadings > 0 || removedNoise > 0) {
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

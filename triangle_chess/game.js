(function(){
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    
    let width, height, centerX, centerY, sideLength, circleDiameter, circleRadius;

    // 初始化 AI 模式
    const aiModeCheckbox = document.getElementById('aiMode');
    let aiMode = aiModeCheckbox.checked;

    aiModeCheckbox.addEventListener('change', function() {
        aiMode = this.checked;
        if (aiMode && currentPlayer === 'white') {
            makeAIMove();
        }
    });

    // 根据屏幕大小调整画布尺寸
    function resizeCanvas() {
        const containerWidth = document.body.clientWidth;
        const size = Math.min(containerWidth - 20, 800); // 最大尺寸为800px
        canvas.width = size;
        canvas.height = size;
        
        // 更新全局变量
        width = canvas.width;
        height = canvas.height;
        centerX = width / 2;
        centerY = height / 2;
        sideLength = width / 8;
        circleDiameter = sideLength * 7;
        circleRadius = circleDiameter / 2;

        initializeGame(); // 重新初始化游戏
    }

    // 在窗口大小改变时调整画布尺寸
    window.addEventListener('resize', resizeCanvas);
    
    const vertices = []; // 存储所有交点（顶点）
    const occupied = {}; // 记录被占据的顶点，键为顶点坐标，值为玩家
    let currentPlayer = 'black'; // 当前玩家，'black' 或 'white'

    // 获取调试信息的 DOM 元素
    const verticesCountElement = document.getElementById('verticesCount');
    const occupiedCountElement = document.getElementById('occupiedCount');
    const currentPlayerElement = document.getElementById('currentPlayer');
    const blackTrianglesElement = document.getElementById('blackTriangles');
    const whiteTrianglesElement = document.getElementById('whiteTriangles');

    // 初始化调试信息
    verticesCountElement.textContent = '0';
    occupiedCountElement.textContent = '0';
    currentPlayerElement.textContent = currentPlayer === 'black' ? '黑方' : '白方';
    blackTrianglesElement.textContent = '0';
    whiteTrianglesElement.textContent = '0';

    // 绘制一组平行线的函数
    function drawParallelLines(angle) {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(angle * Math.PI / 180);

        const lineDistance = sideLength * Math.sqrt(3) / 2; // 两条线之间的距离
        const numLines = Math.ceil((circleDiameter + height) / lineDistance);

        for (let i = -numLines; i <= numLines; i++) {
            ctx.beginPath();
            ctx.moveTo(-width, i * lineDistance);
            ctx.lineTo(width, i * lineDistance);
            ctx.stroke();
        }
        ctx.restore();
    }

    // 添加点击事件监听器
    canvas.addEventListener('click', handleCanvasClick);

    // 生成所有交点的函数
    function generateVertices() {
        const linesByAngle = {
            '0': [],
            '60': [],
            '-60': []
        };
        const vertexMap = {}; // 用于检查顶点是否已存在

        // 生成三组平行线的方程，按角度分类
        const angles = [0, 60, -60];
        angles.forEach(angle => {
            const rad = angle * Math.PI / 180;
            const sin = Math.sin(rad);
            const cos = Math.cos(rad);

            const lineDistance = sideLength * Math.sqrt(3) / 2;
            const numLines = Math.ceil((circleDiameter + height) / lineDistance);

            for (let i = -numLines; i <= numLines; i++) {
                const d = i * lineDistance;
                const a = sin;
                const b = -cos;
                const c = -d;
                linesByAngle[angle].push({ a, b, c });
            }
        });

        // 计算所有线对的交点
        const anglesArray = Object.keys(linesByAngle);
        for (let i = 0; i < anglesArray.length; i++) {
            for (let j = i + 1; j < anglesArray.length; j++) {
                const lines1 = linesByAngle[anglesArray[i]];
                const lines2 = linesByAngle[anglesArray[j]];

                for (const line1 of lines1) {
                    for (const line2 of lines2) {
                        const point = intersectLines(line1, line2);
                        if (point) {
                            // 检查点是否在大圆内
                            if (Math.hypot(point.x - centerX, point.y - centerY) <= circleRadius) {
                                // 将坐标四舍五入到两位小数
                                const xRounded = parseFloat(point.x.toFixed(2));
                                const yRounded = parseFloat(point.y.toFixed(2));
                                const key = `${xRounded},${yRounded}`;

                                // 检查顶点是否已存在
                                if (!vertexMap[key]) {
                                    vertexMap[key] = true;
                                    vertices.push({ x: xRounded, y: yRounded });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 计算两条直线的交点
    function intersectLines(line1, line2) {
        const { a: a1, b: b1, c: c1 } = line1;
        const { a: a2, b: b2, c: c2 } = line2;

        const det = a1 * b2 - a2 * b1;
        if (Math.abs(det) < 1e-6) return null; // 平行线，无交点

        const x = (b1 * c2 - b2 * c1) / det;
        const y = (a2 * c1 - a1 * c2) / det;

        return { x: x + centerX, y: y + centerY };
    }

    let lastMove = null; // 用于存储最后一步棋的位置

    // 处理点击事件的函数
    function handleCanvasClick(event) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // 找到离点击位置最近的顶点
        let closestVertex = null;
        let minDist = Infinity;
        for (const vertex of vertices) {
            const dist = Math.hypot(vertex.x - mouseX, vertex.y - mouseY);
            if (dist < minDist) {
                minDist = dist;
                closestVertex = vertex;
            }
        }

        // 如果距离过大，认为未点击到有效区域
        if (minDist > sideLength * 0.5) return;

        const key = `${closestVertex.x},${closestVertex.y}`;
        // 检查该顶点是否已被占据
        if (occupied[key]) return;

        // 绘制棋子
        drawStone(closestVertex.x, closestVertex.y, currentPlayer);

        // 更新最后一步棋的位置
        lastMove = { x: closestVertex.x, y: closestVertex.y };

        // 重绘所有棋子以更新标记
        redrawAllStones();

        // 标记该顶点被当前玩家占据
        occupied[key] = currentPlayer;

        // 重绘可落子位置
        drawAvailablePositions();

        // 更新已占顶点数显示
        occupiedCountElement.textContent = Object.keys(occupied).length.toString();

        // 实时统计并更新黑白双方的正三角形数量
        updateTriangleCounts();

        // 检查游戏是否结束
        if (Object.keys(occupied).length === vertices.length) {
            endGame();
            return;
        }

        // 切换玩家
        currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
        currentPlayerElement.textContent = currentPlayer === 'black' ? '黑方' : '白方';

        // 在人类玩家下棋后,如果 AI 模式开启,则触发 AI 下棋
        if (aiMode && currentPlayer === 'white') {
            setTimeout(makeAIMove, 500); // 添加短暂延迟,使游戏更自然
        }
    }

    // 绘制棋子的函数
    function drawStone(x, y, player) {
        ctx.beginPath();
        ctx.arc(x, y, sideLength * 0.3, 0, 2 * Math.PI);
        ctx.fillStyle = player === 'black' ? '#000' : '#fff';
        ctx.strokeStyle = '#000';
        ctx.fill();
        ctx.stroke();

        // 如果这是最后一步棋，绘制一个小一点的标记
        if (lastMove && lastMove.x === x && lastMove.y === y) {
            ctx.beginPath();
            ctx.arc(x, y, sideLength * 0.15, 0, 2 * Math.PI);
            ctx.strokeStyle = '#ff0000'; // 红色标记
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.lineWidth = 1; // 恢复默认线宽
        }
    }

    // 实时更新黑白双方的正三角形数量
    function updateTriangleCounts() {
        const blackPositions = [];
        const whitePositions = [];
        for (const key in occupied) {
            const [x, y] = key.split(',').map(Number);
            if (occupied[key] === 'black') {
                blackPositions.push({ x, y });
            } else {
                whitePositions.push({ x, y });
            }
        }

        const blackTriangles = countTriangles(blackPositions);
        const whiteTriangles = countTriangles(whitePositions);

        blackTrianglesElement.textContent = blackTriangles.toString();
        whiteTrianglesElement.textContent = whiteTriangles.toString();
    }

    // 游戏结束处理函数
    function endGame() {
        // 统计结果已在 updateTriangleCounts 中更新
        const blackTriangles = parseInt(blackTrianglesElement.textContent, 10);
        const whiteTriangles = parseInt(whiteTrianglesElement.textContent, 10);

        // 准备结果消息
        let resultMessage = `游戏结束！\n黑方组成的正三角形数量：${blackTriangles}\n白方组成的正三角形数量：${whiteTriangles}\n`;
        if (blackTriangles > whiteTriangles) {
            resultMessage += '黑方获胜！';
        } else if (whiteTriangles > blackTriangles) {
            resultMessage += '白方获胜！';
        } else {
            resultMessage += '平局！';
        }

        // 更新并显示结果元素
        const resultElement = document.getElementById('gameResult');
        resultElement.textContent = resultMessage;
        resultElement.style.display = 'block';
    }

    // 统计玩家能够组成的正三角形数量
    function countTriangles(positions) {
        let count = 0;
        const positionSet = new Set(positions.map(p => `${p.x},${p.y}`));

        // 遍历所有可能的三子组
        for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
                for (let k = j + 1; k < positions.length; k++) {
                    const p1 = positions[i];
                    const p2 = positions[j];
                    const p3 = positions[k];

                    if (isEquilateralTriangle(p1, p2, p3)) {
                        if (advancedModeCheckbox.checked || isConnectedTriangle(p1, p2, p3)) {
                            count++;
                        }
                    }
                }
            }
        }

        return count;
    }

    // 判断三个点是否能组成正三角形
    function isEquilateralTriangle(p1, p2, p3) {
        const d12 = distance(p1, p2);
        const d13 = distance(p1, p3);
        const d23 = distance(p2, p3);

        // 检查三边是否相等，允许一定的误差
        const epsilon = 1e-2;
        return Math.abs(d12 - d13) < epsilon && Math.abs(d13 - d23) < epsilon;
    }

    // 计算两点之间的距离
    function distance(p1, p2) {
        return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }

    // 添加绘制可落子位置的函数
    function drawAvailablePositions() {
        for (const vertex of vertices) {
            const key = `${vertex.x},${vertex.y}`;
            if (!occupied[key]) {
                ctx.beginPath();
                ctx.arc(vertex.x, vertex.y, sideLength * 0.1, 0, 2 * Math.PI);
                ctx.fillStyle = '#fff'; // 填充颜色改为白色
                ctx.strokeStyle = '#000'; // 添加黑色边框
                ctx.fill();
                ctx.stroke(); // 绘制边框
            }
        }
        ctx.restore();
    }

    const advancedModeCheckbox = document.getElementById('advancedMode');

    // 添加新函数：检查三角形的边是否有线连接
    function isConnectedTriangle(p1, p2, p3) {
        return (
            Math.abs(p1.y - p2.y) < 1e-6 ||
            Math.abs(p1.y - p3.y) < 1e-6 ||
            Math.abs(p2.y - p3.y) < 1e-6
        );
    }

    // 添加事件监听器，以在切换高级模式时重新计算三角形数量
    advancedModeCheckbox.addEventListener('change', updateTriangleCounts);

    const restartButton = document.getElementById('restartButton');

    // 修改重新开局按钮的事件监听器
    restartButton.addEventListener('click', function() {
        if (Object.keys(occupied).length > 0) {
            if (confirm('游戏正在进行中,确定要重新开始吗?')) {
                initializeGame();
            }
        } else {
            initializeGame();
        }
    });

    // 在初始化游戏状态的代码块之后添加以下函数
    function initializeGame() {
        // 清空棋盘
        ctx.clearRect(0, 0, width, height);
        
        // 重置游戏状态
        vertices.length = 0;
        Object.keys(occupied).forEach(key => delete occupied[key]);
        currentPlayer = 'black';

        // 重置最后一步棋的位置
        lastMove = null;

        // 重新绘制棋盘
        drawBoard();
        generateVertices();
        drawAvailablePositions();

        // 更新显示信息
        verticesCountElement.textContent = vertices.length.toString();
        occupiedCountElement.textContent = '0';
        currentPlayerElement.textContent = '黑方';
        blackTrianglesElement.textContent = '0';
        whiteTrianglesElement.textContent = '0';

        // 隐藏游戏结果
        const resultElement = document.getElementById('gameResult');
        resultElement.style.display = 'none';

        // 重置 AI 模式
        aiMode = aiModeCheckbox.checked;
        if (aiMode && currentPlayer === 'white') {
            setTimeout(makeAIMove, 500);
        }
    }

    function drawBoard() {
        // 绘��圆
        ctx.beginPath();
        ctx.arc(centerX, centerY, circleRadius, 0, 2 * Math.PI);
        ctx.stroke();

        // 将绘图限制在大圆内
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, circleRadius, 0, 2 * Math.PI);
        ctx.clip();

        // 绘制三组平行线
        drawParallelLines(0);
        drawParallelLines(60);
        drawParallelLines(-60);
    }

    // 初始调整画布大小并初始化游戏
    resizeCanvas();

    function makeAIMove() {
        console.log('AI 下棋');
        // 获取所有可用的落子位置
        const availablePositions = vertices.filter(vertex => {
            const key = `${vertex.x},${vertex.y}`;
            return !occupied[key];
        });

        if (availablePositions.length === 0) return;

        // 评分函数：计算每个位置的得分
        function evaluatePosition(position) {
            let score = 0;
            const tempOccupied = {...occupied, [`${position.x},${position.y}`]: 'white'};
            
            // 模拟落子后计算白棋的三角形数量
            const whitePositions = Object.keys(tempOccupied)
                .filter(key => tempOccupied[key] === 'white')
                .map(key => {
                    const [x, y] = key.split(',').map(Number);
                    return {x, y};
                });
            const whiteTriangles = countTriangles(whitePositions);
            
            // 计算黑棋的三角形数量
            const blackPositions = Object.keys(tempOccupied)
                .filter(key => tempOccupied[key] === 'black')
                .map(key => {
                    const [x, y] = key.split(',').map(Number);
                    return {x, y};
                });
            const blackTriangles = countTriangles(blackPositions);
            
            // 计算如果黑棋在这个位置落子会形成多少个三角形
            const blackPositionsIfMoved = [...blackPositions, position];
            const blackTrianglesIfMoved = countTriangles(blackPositionsIfMoved);
            const preventedTriangles = blackTrianglesIfMoved - blackTriangles;
            
            // 计算位置距离中心的距离
            const distanceToCenter = Math.hypot(position.x - centerX, position.y - centerY);
            const maxDistance = Math.hypot(width/2, height/2);
            const centralityScore = 1 - (distanceToCenter / maxDistance); // 0到1之间的值，越靠近中心越接近1
            
            // 得分 = 白棋三角形数量 - 黑棋三角形数量 + 阻止的黑棋三角形数量 + 中心位置权重
            score = whiteTriangles - blackTriangles + preventedTriangles + centralityScore/5;
            
            return score;
        }

        // 为每个可用位置计算得分
        const scoredPositions = availablePositions.map(position => ({
            position,
            score: evaluatePosition(position)
        }));
        console.log(scoredPositions);

        // 选择得分最高的位置
        const bestMove = scoredPositions.reduce((best, current) => 
            current.score > best.score ? current : best
        );

        // 执行最佳移动
        const key = `${bestMove.position.x},${bestMove.position.y}`;
        occupied[key] = 'white';
        drawStone(bestMove.position.x, bestMove.position.y, 'white');

        // 更新最后一步棋的位置
        lastMove = { x: bestMove.position.x, y: bestMove.position.y };

        // 重绘所有棋子以更新标记
        redrawAllStones();

        // 更新游戏状态
        updateTriangleCounts();
        drawAvailablePositions();
        occupiedCountElement.textContent = Object.keys(occupied).length.toString();

        // 检查游戏是否结束
        if (Object.keys(occupied).length === vertices.length) {
            endGame();
            return;
        }

        // 切换回人类玩家
        currentPlayer = 'black';
        currentPlayerElement.textContent = '黑方';
    }

    // 添加 redrawAllStones 函数
    function redrawAllStones() {
        for (const key in occupied) {
            const [x, y] = key.split(',').map(Number);
            drawStone(x, y, occupied[key]);
        }
    }
})();
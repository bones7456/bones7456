(function(){
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    const sideLength = 100; // 单位正三角形的边长
    const circleDiameter = 700; // 大圆的直径
    const circleRadius = circleDiameter / 2;

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

    // 绘制大圆
    ctx.beginPath();
    ctx.arc(centerX, centerY, circleRadius, 0, 2 * Math.PI);
    ctx.stroke();

    // 将绘图限制在大圆内
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, circleRadius, 0, 2 * Math.PI);
    ctx.clip();

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

    // 绘制水平线
    drawParallelLines(0);

    // 绘制与水平成 60 度的平行线
    drawParallelLines(60);

    // 绘制与水平成 120 度的平行线
    drawParallelLines(-60);

    // 生成并存储所有交点（顶点）
    generateVertices();
    drawAvailablePositions();

    // 更新顶点总数显示
    verticesCountElement.textContent = vertices.length.toString();

    ctx.restore(); // 恢复剪切区域

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
    }

    // 绘制棋子的函数
    function drawStone(x, y, player) {
        ctx.beginPath();
        ctx.arc(x, y, sideLength * 0.3, 0, 2 * Math.PI);
        ctx.fillStyle = player === 'black' ? '#000' : '#fff';
        ctx.strokeStyle = '#000';
        ctx.fill();
        ctx.stroke();
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
        alert('游戏结束，正在统计结果...');

        // 统计结果已在 updateTriangleCounts 中更新
        const blackTriangles = parseInt(blackTrianglesElement.textContent, 10);
        const whiteTriangles = parseInt(whiteTrianglesElement.textContent, 10);

        // 显示结果
        let resultMessage = `黑方组成的正三角形数量：${blackTriangles}\n白方组成的正三角形数量：${whiteTriangles}\n`;
        if (blackTriangles > whiteTriangles) {
            resultMessage += '黑方获胜！';
        } else if (whiteTriangles > blackTriangles) {
            resultMessage += '白方获胜！';
        } else {
            resultMessage += '平局！';
        }
        alert(resultMessage);
    }

    // 统计玩家能够组成的正三角形数量
    function countTriangles(positions) {
        let count = 0;
        const positionSet = new Set(positions.map(p => `${p.x},${p.y}`));

        // 遍历所有可能的三子组合
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

    // 添加事件监听器，以便在切换高级模式时重新计算三角形数量
    advancedModeCheckbox.addEventListener('change', updateTriangleCounts);
})();

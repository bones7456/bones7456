const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;
let serverStarted = false;

// 防止多个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // 如果已经有实例在运行，聚焦到现有窗口
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// 启动后端服务器（直接在主进程中运行）
function startServer() {
    if (serverStarted) {
        return Promise.resolve();
    }
    
    try {
        // 直接 require server.js 并使用它的 startServer 函数
        const { startServer: startServerFunc } = require('./server.js');
        return startServerFunc(3000).then(() => {
            serverStarted = true;
            console.log('服务器已启动');
        });
    } catch (err) {
        console.error('启动服务器失败:', err);
        return Promise.reject(err);
    }
}

// 创建应用窗口
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // 加载前端页面
    mainWindow.loadFile('index.html');

    // 开发时可以打开开发者工具
    // mainWindow.webContents.openDevTools();
}

// 应用准备就绪
app.whenReady().then(() => {
    // 启动后端服务器，然后创建窗口
    startServer()
        .then(() => {
            createWindow();
        })
        .catch((err) => {
            console.error('启动失败:', err);
            console.error('错误详情:', err.message);
            console.error('堆栈:', err.stack);
            // 显示错误对话框
            const { dialog } = require('electron');
            dialog.showErrorBox('启动失败', `无法启动服务器: ${err.message}\n\n请检查控制台日志获取更多信息。`);
            app.quit();
        });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 所有窗口关闭时
app.on('window-all-closed', () => {
    // 在 macOS 上，除非用户用 Cmd + Q 退出，否则应用会保持运行
    if (process.platform !== 'darwin') {
        app.quit();
    }
});


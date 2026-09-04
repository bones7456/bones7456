// 新加坡天气云图 Scriptable Widget
// 直接抓 weather.gov.sg，本地合成底图 + 最新云图 + 当前位置蓝点
// 用法：Scriptable 里新建脚本贴入，先在 App 内运行一次（授权定位），
//      再长按桌面添加 Scriptable 中号/大号 widget，选本脚本。

const BASE_MAP_URL =
  "https://www.weather.gov.sg/wp-content/themes/wiptheme/assets/img/base-853.png"

// 地图地理范围与原图尺寸（与 index.html 的 mapBounds 一致）
const MAP = {
  topLat: 1.477355, leftLng: 103.555426,
  botLat: 1.158784, rightLng: 104.132921,
  width: 853, height: 479,
}

// 点击 widget 打开的页面（按需改成你自己的天气页地址）
const OPEN_URL = "https://luy.li/data/w/"

// 输出画布宽高比（贴近中号 widget ≈2.15）。顶部对齐、从底部裁掉南部岛屿，
// 这样北边能完整显示，且 backgroundImage 填充时不再上下二次裁切。
// 想让视野更高/南部裁更多就调大这个值。
const TARGET_ASPECT = 2.15
const VIEW_H = Math.min(MAP.height, Math.round(MAP.width / TARGET_ASPECT))

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

function pad(n) { return String(n).padStart(2, "0") }

// 取新加坡当前时间(GMT+8)：把字段换算到 Asia/Singapore 后当作本地时间使用
function singaporeNow() {
  const now = new Date()
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Singapore" }))
}

// 由时间生成云图 URL（与 index.html 的拼法完全一致：14位时间戳 + "00"）
function cloudUrlFor(date) {
  const ts =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}00`
  return `https://www.weather.gov.sg/files/rainarea/50km/v2/dpsri_70km_${ts}00dBR.dpsri.png`
}

async function loadImage(url) {
  try {
    const req = new Request(url)
    req.headers = { "User-Agent": UA } // 带浏览器 UA，规避简单反爬
    const img = await req.loadImage()
    if (req.response && req.response.statusCode !== 200) return null
    return img
  } catch (e) {
    return null
  }
}

// 取最新一张云图：从当前5分钟点往前最多回退6次（半小时），处理"最新图还没生成"
async function loadLatestCloud() {
  let t = singaporeNow()
  t.setSeconds(0, 0)
  t.setMinutes(Math.floor(t.getMinutes() / 5) * 5)
  for (let i = 0; i < 7; i++) {
    const img = await loadImage(cloudUrlFor(t))
    if (img) return { img, time: new Date(t) }
    t = new Date(t.getTime() - 5 * 60 * 1000)
  }
  return null
}

// 经纬度 -> 853x479 原图像素（与 index.html 的 convertLatLngToPixel 一致）
function latLngToPixel(lat, lng) {
  const latRatio = (MAP.topLat - lat) / (MAP.topLat - MAP.botLat)
  const lngRatio = (lng - MAP.leftLng) / (MAP.rightLng - MAP.leftLng)
  return { x: lngRatio * MAP.width, y: latRatio * MAP.height }
}

function inBounds(lat, lng) {
  return lat >= MAP.botLat && lat <= MAP.topLat &&
         lng >= MAP.leftLng && lng <= MAP.rightLng
}

async function getLocationSafe() {
  try {
    Location.setAccuracyToHundredMeters()
    const l = await Location.current()
    return { lat: l.latitude, lng: l.longitude }
  } catch (e) {
    return null // 定位失败就不画点
  }
}

// ---------------- 主流程 ----------------
const [baseImg, cloud, loc] = await Promise.all([
  loadImage(BASE_MAP_URL),
  loadLatestCloud(),
  getLocationSafe(),
])

const ctx = new DrawContext()
ctx.size = new Size(MAP.width, VIEW_H) // 画布只有视野高度，底部南部被裁掉
ctx.opaque = true
ctx.respectScreenScale = true

// 黑底
ctx.setFillColor(new Color("000000"))
ctx.fillRect(new Rect(0, 0, MAP.width, VIEW_H))

// 顶部对齐画完整原图，超出 VIEW_H 的底部自动被裁
const full = new Rect(0, 0, MAP.width, MAP.height)
if (baseImg) ctx.drawImageInRect(baseImg, full)
if (cloud) ctx.drawImageInRect(cloud.img, full)

// 当前位置蓝点（白边）
if (loc && inBounds(loc.lat, loc.lng)) {
  const p = latLngToPixel(loc.lat, loc.lng)
  const r = 10
  ctx.setFillColor(Color.white())
  ctx.fillEllipse(new Rect(p.x - r / 2 - 2, p.y - r / 2 - 2, r + 4, r + 4))
  ctx.setFillColor(new Color("2196F3"))
  ctx.fillEllipse(new Rect(p.x - r / 2, p.y - r / 2, r, r))
}

// 左下角时间戳
if (cloud) {
  const label = `${pad(cloud.time.getHours())}:${pad(cloud.time.getMinutes())} SGT`
  ctx.setFont(Font.boldSystemFont(22))
  ctx.setTextColor(Color.white())
  ctx.drawText(label, new Point(10, VIEW_H - 32))
}

const composed = ctx.getImage()

const widget = new ListWidget()
widget.setPadding(0, 0, 0, 0)
widget.backgroundColor = new Color("000000")
if (baseImg || cloud) {
  widget.backgroundImage = composed
} else {
  // 全部抓取失败时给个提示
  const t = widget.addText("云图加载失败\n请检查网络")
  t.textColor = Color.white()
  t.centerAlignText()
}
widget.url = OPEN_URL
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000) // 约15分钟刷新

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentMedium()
}
Script.complete()

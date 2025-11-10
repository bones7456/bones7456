(function () {
    const container = document.getElementById("char_unicode_utf8");
    if (!container) return;
  
    if (!document.getElementById("cu_inline_style")) {
      const style = document.createElement("style");
      style.id = "cu_inline_style";
      style.textContent = `
        .cu-wrap { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji", "Segoe UI Symbol"; color: #e5e7eb; font-size: 16px; border: solid 1px #880000;}
        .cu-table { border-collapse: collapse; width: 100%; max-width: 1200px; }
        .cu-table th, .cu-table td { border-bottom: 1px solid #374151; padding: 8px 10px; vertical-align: top; }
        .cu-table th { text-align: center; font-weight: 600; color: #f3f4f6; }
        .cu-table td { color: #dde1eb; text-align: right; }
        .cu-table td:nth-child(1) { text-align: left;  }
        .cu-input { width: 5em; font-size: 16px; padding: 4px 6px; }
  
        .cu-btn { margin-top: 8px; padding: 6px 10px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer; }
        .cu-btn:hover { background: #f9fafb; }
        .cu-bits { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; letter-spacing: 0.03em; white-space: nowrap; }
        .cu-byte { margin-right: .4em; display: inline-block; }
        .cu-fix  { color: #6b7280; }         /* 固定位前缀，如 1110/10/0 */
        .cu-zero { color: #9ca3af; }         /* Unicode 高位补零 */
        .cu-w    { color: #8e44ad; font-weight: 600; }
        .cu-x    { color: #1f6feb; font-weight: 600; }
        .cu-y    { color: #059669; font-weight: 600; }
        .cu-z    { color: #d97706; font-weight: 600; }
        .cu-note { color: #6b7280; font-size: 12px; }
        .cu-ch   { font-size: 16px; }
        .cu-line { margin: 2px 0; }
        .cu-name { font-size: 12px; color: #9ca3af; margin-right: .4em; }
      `;
      document.head.appendChild(style);
    }
  
    container.innerHTML = `
      <div class="cu-wrap">
        <table class="cu-table">
          <thead>
            <tr>
              <th>字符</th>
              <th>Unicode</th>
              <th>Unicode（Bin·21bits）</th>
              <th>UTF‑8（Bin）</th>
              <th>UTF‑8（Hex）</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">请点击：
          <button id="cu_add" type="button" class="cu-btn">新增自定义字符</button>
          <button type="button" class="cu-btn" data-char="0">0</button>
          <button type="button" class="cu-btn" data-char="A">A</button>
          <button type="button" class="cu-btn" data-char="©">©</button>
          <button type="button" class="cu-btn" data-char="€">€</button>
          <button type="button" class="cu-btn" data-char="中">中</button>
          <button type="button" class="cu-btn" data-char="Á">Á</button>
          <button type="button" class="cu-btn" data-char="😀">😀</button>
          <button type="button" class="cu-btn" data-char="❤️">❤️</button>
          <button type="button" class="cu-btn" data-char="👋🏿">👋🏿</button>
          <button type="button" class="cu-btn" data-char="👨‍👩‍👧‍👦">👨‍👩‍👧‍👦</button>
          <button type="button" class="cu-btn" data-char="👨🏽‍❤️‍💋‍👨🏼">👨🏽‍❤️‍💋‍👨🏼</button>
          <button type="button" class="cu-btn" data-char="𝕏">𝕏</button>
          <button type="button" class="cu-btn" data-char="𝄞">𝄞</button>
          <button type="button" class="cu-btn" data-char="𐀀">𐀀</button>
          <button type="button" class="cu-btn" data-char="🀀">🀀</button>
          <button type="button" class="cu-btn" data-char="𠀀">𠀀</button>
          <button type="button" class="cu-btn" data-char="𠮷">𠮷</button>
        </div>
        <div class="cu-note">提示：彩色位（w/x/y/z）会被搬运到 UTF‑8 的相应位置；灰色为固定前缀或高位补零。</div>
      </div>
    `;
  
    const tbody = container.querySelector("tbody");
    const addBtn = container.querySelector("#cu_add");
  
    /* ========== 工具函数 ========== */
  
    function toHexBytesFromCodePoint(cp) {
      // 手写 UTF‑8 编码，返回十六进制字节数组（数值型）
      if (cp <= 0x7F) {
        return [cp];
      } else if (cp <= 0x7FF) {
        return [
          0b11000000 | (cp >> 6),
          0b10000000 | (cp & 0b00111111)
        ];
      } else if (cp >= 0xD800 && cp <= 0xDFFF) {
        // 代理项（不应单独作为标量值），用替代字符 U+FFFD
        return [0xEF, 0xBF, 0xBD];
      } else if (cp <= 0xFFFF) {
        return [
          0b11100000 | (cp >> 12),
          0b10000000 | ((cp >> 6) & 0b00111111),
          0b10000000 | (cp & 0b00111111)
        ];
      } else if (cp <= 0x10FFFF) {
        return [
          0b11110000 | (cp >> 18),
          0b10000000 | ((cp >> 12) & 0b00111111),
          0b10000000 | ((cp >> 6) & 0b00111111),
          0b10000000 | (cp & 0b00111111)
        ];
      } else {
        return [0xEF, 0xBF, 0xBD];
      }
    }
  
    function cpToUPlus(cp) {
      const hex = cp.toString(16).toUpperCase();
      return "U+" + hex.padStart(4, "0");
    }
  
    function span(cls, text) {
      return `<span class="cu-bits ${cls}">${text}</span>`;
    }
  
    function bin(n, width) {
      let s = (n >>> 0).toString(2);
      if (s.length > width) s = s.slice(s.length - width);
      return s.padStart(width, "0");
    }
  
    function bytesToHexStr(bytes) {
      return bytes.map(b => b.toString(16).toUpperCase().padStart(2, "0"));
    }
  
    function cpNickname(cp) {
      if (cp === 0x200D) return "ZWJ";
      if (cp === 0x200C) return "ZWNJ";
      if (cp >= 0xFE00 && cp <= 0xFE0F) return "VS" + (cp - 0xFE00 + 1); // VS1..VS16
      if (cp >= 0xE0100 && cp <= 0xE01EF) return "VS" + (cp - 0xE0100 + 17); // VS17..VS256
      return "";
    }
  
    function escapeHtml(s) {
      return s.replace(/[&<>]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));
    }
  
    function renderLines(items) {
      return items.map(s => `<div class="cu-line">${s}</div>`).join("");
    }
  
    /* ======= 渲染：UTF‑8（Bin） ======= */
  
    function formatUtf8Bits(cp) {
      if (cp <= 0x7F) {
        const z = span("cu-z", bin(cp, 7));
        const b1 = span("cu-fix", "0") + z;
        return `<span class="cu-byte">${b1}</span>`;
      } else if (cp <= 0x7FF) {
        const y = span("cu-y", bin((cp >> 6) & 0b11111, 5));
        const z = span("cu-z", bin(cp & 0b111111, 6));
        const b1 = span("cu-fix", "110") + y;
        const b2 = span("cu-fix", "10") + z;
        return `<span class="cu-byte">${b1}</span> <span class="cu-byte">${b2}</span>`;
      } else if (cp >= 0xD800 && cp <= 0xDFFF) {
        return formatUtf8Bits(0xFFFD);
      } else if (cp <= 0xFFFF) {
        const x = span("cu-x", bin((cp >> 12) & 0b1111, 4));
        const y = span("cu-y", bin((cp >> 6) & 0b111111, 6));
        const z = span("cu-z", bin(cp & 0b111111, 6));
        const b1 = span("cu-fix", "1110") + x;
        const b2 = span("cu-fix", "10") + y;
        const b3 = span("cu-fix", "10") + z;
        return `<span class="cu-byte">${b1}</span> <span class="cu-byte">${b2}</span> <span class="cu-byte">${b3}</span>`;
      } else {
        const w = span("cu-w", bin((cp >> 18) & 0b111, 3));
        const x = span("cu-x", bin((cp >> 12) & 0b111111, 6));
        const y = span("cu-y", bin((cp >> 6) & 0b111111, 6));
        const z = span("cu-z", bin(cp & 0b111111, 6));
        const b1 = span("cu-fix", "11110") + w;
        const b2 = span("cu-fix", "10") + x;
        const b3 = span("cu-fix", "10") + y;
        const b4 = span("cu-fix", "10") + z;
        return `<span class="cu-byte">${b1}</span> <span class="cu-byte">${b2}</span> <span class="cu-byte">${b3}</span> <span class="cu-byte">${b4}</span>`;
      }
    }
  
    /* ======= 渲染：Unicode（Bin·21bits，分组 5|8|8） ======= */
  
    function formatUnicode21Bits(cp) {
      if (cp >= 0xD800 && cp <= 0xDFFF) return formatUnicode21Bits(0xFFFD);
  
      const b21 = bin(cp, 21); // 0..20
      const cls = new Array(21).fill("cu-zero");
  
      if (cp <= 0x7F) {
        for (let i = 14; i <= 20; i++) cls[i] = "cu-z";
      } else if (cp <= 0x7FF) {
        for (let i = 10; i <= 14; i++) cls[i] = "cu-y";
        for (let i = 15; i <= 20; i++) cls[i] = "cu-z";
      } else if (cp <= 0xFFFF) {
        for (let i = 5; i <= 8;  i++) cls[i] = "cu-x";
        for (let i = 9; i <= 14; i++) cls[i] = "cu-y";
        for (let i = 15; i <= 20; i++) cls[i] = "cu-z";
      } else {
        for (let i = 0; i <= 2;  i++) cls[i] = "cu-w";
        for (let i = 3; i <= 8;  i++) cls[i] = "cu-x";
        for (let i = 9; i <= 14; i++) cls[i] = "cu-y";
        for (let i = 15; i <= 20; i++) cls[i] = "cu-z";
      }
  
      function buildGroup(start, endIncl) {
        let out = "";
        let curCls = cls[start];
        let buf = b21[start];
        for (let i = start + 1; i <= endIncl; i++) {
          if (cls[i] === curCls) {
            buf += b21[i];
          } else {
            out += span(curCls, buf);
            curCls = cls[i];
            buf = b21[i];
          }
        }
        out += span(curCls, buf);
        return `<span class="cu-byte">${out}</span>`;
      }
  
      // 5 | 8 | 8
      const g1 = buildGroup(0, 4);
      const g2 = buildGroup(5, 12);
      const g3 = buildGroup(13, 20);
      return `${g1} ${g2} ${g3}`;
    }
  
    /* ======= 渲染：UTF‑8（Hex，按字节着色为 w/x/y/z） ======= */
  
    function formatUtf8Hex(cp) {
      if (cp >= 0xD800 && cp <= 0xDFFF) return formatUtf8Hex(0xFFFD);
  
      const bytes = toHexBytesFromCodePoint(cp);
      const hex = bytesToHexStr(bytes);
      let colors;
  
      if (cp <= 0x7F) {
        colors = ["cu-z"];
      } else if (cp <= 0x7FF) {
        colors = ["cu-y", "cu-z"];
      } else if (cp <= 0xFFFF) {
        colors = ["cu-x", "cu-y", "cu-z"];
      } else {
        colors = ["cu-w", "cu-x", "cu-y", "cu-z"];
      }
  
      return hex
        .map((h, i) => `<span class="cu-bits ${colors[i]} cu-byte">${h}</span>`)
        .join(" ");
    }
  
    /* ========== 行构建 ========== */
  
    function formatUnicodeLine(cp) {
      const nickname = cpNickname(cp);
      const shownChar = nickname ? "" : escapeHtml(String.fromCodePoint(cp));
      const charPart = shownChar ? `<span class="cu-ch">${shownChar}</span> &nbsp;` : "";
      const namePart = nickname ? `<span class="cu-name">${nickname}</span>` : "";
      return `${charPart}${namePart}${cpToUPlus(cp)}`;
    }
  
    function addRow(initialChar = "") {
      const tr = document.createElement("tr");
  
      const tdChar = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "输入字符或序列";
      input.className = "cu-input";
      tdChar.appendChild(input);
      tr.appendChild(tdChar);
  
      const tdUnicode = document.createElement("td");
      const tdCpBits = document.createElement("td");
      const tdUtf8Bits = document.createElement("td");
      const tdUtf8Hex = document.createElement("td");
      tr.appendChild(tdUnicode);
      tr.appendChild(tdCpBits);
      tr.appendChild(tdUtf8Bits);
      tr.appendChild(tdUtf8Hex);
  
      function update() {
        const str = input.value || "";
        if (!str) {
          tdUnicode.innerHTML = "";
          tdCpBits.innerHTML = "";
          tdUtf8Bits.innerHTML = "";
          tdUtf8Hex.innerHTML = "";
          return;
        }
  
        const cps = [];
        for (const ch of str) {
          let cp = ch.codePointAt(0);
          if (cp >= 0xD800 && cp <= 0xDFFF) cp = 0xFFFD;
          cps.push(cp);
        }
  
        tdUnicode.innerHTML  = renderLines(cps.map(cp => formatUnicodeLine(cp)));
        tdCpBits.innerHTML   = renderLines(cps.map(cp => formatUnicode21Bits(cp)));
        tdUtf8Bits.innerHTML = renderLines(cps.map(cp => formatUtf8Bits(cp)));
        tdUtf8Hex.innerHTML  = renderLines(cps.map(cp => formatUtf8Hex(cp)));
      }
  
      input.addEventListener("input", update);
      input.addEventListener("change", update);
  
      tbody.appendChild(tr);
  
      if (initialChar) {
        input.value = initialChar;
        update();
      }
    }
  
    addBtn.addEventListener("click", () => addRow());
    
    // 统一处理所有带 data-char 属性的按钮
    container.querySelectorAll("button[data-char]").forEach(btn => {
      btn.addEventListener("click", () => {
        const char = btn.getAttribute("data-char");
        addRow(char);
      });
    });
    
    addRow("🎾"); // 默认第一行预填"🎾"
  })();
  
# ⚡ 快速使用指南

## 🎯 只加密 app-update.js（推荐）

### 开发时
```bash
python main.py
npm run android:dev
```

### 生产打包时
```bash
# 1. 正常构建
python main.py

# 2. 加密 app-update.js（保护下载地址）
npm run encrypt:app-update

# 3. 同步并打包
npm run cap:sync
cd android && ./gradlew assembleRelease

# 4. 打包后恢复（重要！）
npm run restore:app-update
```

## 🔐 加密效果

**加密前（可直接看到地址）**：
```javascript
mirrors: [
    'https://gh-proxy.com/',
    'https://ghproxy.net/',
    'https://proxy.11891189.xyz/'
]
```

**加密后（完全不可读）**：
```javascript
var _d='ΩΨΦΩΨΦΩΨΦΩΨΦΩΨΦΩΨΦ...';
function _dec(e,k){...}
```

## 📋 常用命令

```bash
# 加密 app-update.js
npm run encrypt:app-update

# 恢复原始文件
npm run restore:app-update

# 完整安全构建（所有文件）
npm run build:secure
```

## ⚠️ 注意事项

1. **开发时**：使用原始文件（不加密）
2. **生产打包后**：立即运行 `npm run restore:app-update`
3. **不要提交**：加密后的文件不要提交到 Git

---

详细文档：[ENCRYPT_APP_UPDATE.md](ENCRYPT_APP_UPDATE.md)

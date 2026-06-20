# Sov Upgrade Map

## 启动

```bash
# 后端
cd backend
bash build.sh
PLUGIN_KEY=<提供的key> LISTEN_ADDR=:8080 ./sov-upgrade-map

# 前端 (开发)
cd frontend
pnpm install
pnpm dev
```

## 自定义转发后端地址

修改 `frontend/vite.config.ts` 中的 `target` 字段：

```ts
proxy: { '/api': { target: 'http://你的后端地址:端口', changeOrigin: true } }
```

## 依赖

- 后端：无第三方依赖，仅使用标准库。
- 前端：React 19, Ant Design 6, Tailwind CSS 4, Vite 8

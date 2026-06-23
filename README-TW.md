# Docker Compose Nginx Proxy Manager

這個專案使用 Docker Compose 部署一套可管理的 Nginx Reverse Proxy 系統，包含：

- Nginx
- PostgreSQL 18.4
- 後端 API
- 前端管理介面

前端可以新增 API 轉發規則、上傳 SSL/TLS 憑證、設定自訂 headers，並可選擇是否啟用 MCP-compatible 的 JSON-RPC 轉換模式。

## 專案結構

```text
.
├── docker-compose.yml
├── db/
│   └── schema.sql
├── nginx/
│   └── nginx.conf
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── db.js
│       ├── nginx.js
│       └── server.js
└── frontend/
    ├── Dockerfile
    ├── index.html
    ├── nginx.conf
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        └── main.css
```

## 服務說明

- `nginx`：使用 `nginx:latest`，從共享 volume 載入後端產生的 reverse proxy 設定。
- `postgres`：使用 `postgres:18.4`，啟動時會套用 `db/schema.sql` 初始化資料表。
- `api`：儲存設定、寫入憑證、產生 Nginx 設定檔，並重新載入 Nginx。
- `frontend`：提供管理介面，預設網址為 `http://localhost:3000`。

Compose 預設開放：

- 一般 HTTP 轉發 port：`8080-8099`
- TLS 用 port：`8443-8459`

如果需要更多對外 port，可以在 `docker-compose.yml` 裡調整 `nginx` 的 ports 範圍，並同步調整 `api` 的環境變數。

## 啟動方式

```bash
docker compose up -d --build
```

開啟管理介面：

```text
http://localhost:3000
```

查看服務狀態：

```bash
docker compose ps
```

停止服務：

```bash
docker compose down
```

如果也要刪除資料 volume：

```bash
docker compose down -v
```

## 憑證管理流程

1. 在前端上傳 certificate PEM。
2. 上傳 private key PEM。
3. 如有需要，可額外上傳 CA bundle PEM。
4. 後端會把憑證寫入共享 volume：
   - `/etc/nginx/certs/current/fullchain.pem`
   - `/etc/nginx/certs/current/privkey.pem`
   - `/etc/nginx/certs/current/ca_bundle.pem`
5. 憑證 metadata 會存入 PostgreSQL。
6. 後端重新產生 Nginx 設定，並送出 `SIGHUP` 重新載入 Nginx。

目前設計中，當規則使用 `8443-8459` 範圍的 port 且系統已有啟用中的憑證時，Nginx 會自動使用 HTTPS。`8080-8099` 範圍則維持一般 HTTP。

## 一般 Reverse Proxy 流程

一般模式的資料流：

```text
Client -> localhost:<public port> -> Nginx -> target API endpoint
```

範例設定：

```text
endpoint: https://api.example.com/v1
port: 8081
```

請求：

```text
http://localhost:8081/users
```

會轉發到：

```text
https://api.example.com/v1/users
```

在 UI 輸入的 headers 會以 JSON 形式存入 PostgreSQL，並在產生 Nginx 設定時轉成 `proxy_set_header`。

## MCP 轉換模式

啟用 MCP conversion 後，Nginx 不會直接轉發到目標 API，而是先轉到後端 MCP gateway：

```text
MCP client -> localhost:<public port> -> Nginx -> backend /mcp-proxy/:ruleId -> target API endpoint
```

後端會提供 JSON-RPC 風格的 MCP-compatible 介面。

列出工具：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

系統會回傳一個名為 `http_request` 的工具。

呼叫工具：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "http_request",
    "arguments": {
      "method": "GET",
      "path": "/users",
      "headers": {
        "X-Trace-Id": "demo"
      }
    }
  }
}
```

後端會合併資料庫中儲存的 headers 與呼叫時傳入的 headers，送出 HTTP request 到目標 endpoint，再把上游 response 包裝成 MCP-compatible JSON-RPC 結果。

## PostgreSQL 儲存內容

資料庫 schema 位於：

```text
db/schema.sql
```

主要資料表：

- `certificates`：儲存憑證 metadata、檔案路徑、fingerprint、是否啟用。
- `proxy_rules`：儲存 API endpoint、headers、對外 port、是否啟用 MCP、是否啟用規則。

## 測試一般轉發

在 UI 建立一條一般 HTTP rule：

- Endpoint：`https://postman-echo.com`
- Port：`8081`
- Headers：

```json
{
  "X-Managed-By": "nginx-manager"
}
```

測試：

```bash
curl http://localhost:8081/get
```

如果成功，會看到上游 API 回傳內容，且 response 中可看到 `x-managed-by` header。

## 測試 MCP 模式

在 UI 建立一條 MCP rule：

- Endpoint：`https://postman-echo.com`
- Port：`8082`
- Enable MCP conversion：開啟

列出 MCP tools：

```bash
curl -X POST http://localhost:8082 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

呼叫 `http_request` tool：

```bash
curl -X POST http://localhost:8082 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"http_request","arguments":{"method":"GET","path":"/get"}}}'
```

## 部署注意事項

- 正式環境請更換 `docker-compose.yml` 裡的 PostgreSQL 預設帳號密碼。
- 只開放實際需要的 port 範圍。
- API service 應維持在內部網路，不要直接公開到外部。
- 目前 API 透過與 Nginx 共享 PID namespace 對 Nginx 送出 reload signal，因此不需要掛載 Docker socket。
- 憑證 volume 請搭配可信任的備份與存取控管。
- 專案依需求使用 `postgres:18.4`。若你的環境無法拉取此 tag，可改成可用的 PostgreSQL 18 image tag。

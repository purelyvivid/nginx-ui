# Docker Compose Nginx Proxy Manager

This project deploys Nginx, PostgreSQL 18.4, a backend API, and a small frontend management UI with Docker Compose.

## Project Structure

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

## Services

- `nginx`: Uses `nginx:latest` and loads generated reverse proxy config from a shared volume.
- `postgres`: Uses `postgres:18.4` and initializes tables from `db/schema.sql`.
- `api`: Stores settings, writes certificates, generates Nginx config, and reloads Nginx.
- `frontend`: Serves the management UI at `http://localhost:3000`.

The Compose file exposes public proxy ports `8080-8099` and TLS-oriented ports `8443-8459`. Add more ranges in `docker-compose.yml` if you want to allow more externally reachable ports.

## Certificate Flow

1. Upload `certificate` and `private key` from the UI.
2. Optionally upload a `CA bundle`.
3. The backend writes:
   - `/etc/nginx/certs/current/fullchain.pem`
   - `/etc/nginx/certs/current/privkey.pem`
   - `/etc/nginx/certs/current/ca_bundle.pem` when provided
4. Certificate metadata is stored in PostgreSQL.
5. The backend regenerates Nginx config and sends `SIGHUP` to Nginx.

TLS is enabled for rules that listen on ports `8443-8459` when an active certificate exists. HTTP rules on `8080-8099` stay plain HTTP.

## Reverse Proxy Flow

For a normal rule:

```text
Client -> localhost:<public port> -> Nginx -> target API endpoint
```

Example:

```text
endpoint: https://api.example.com/v1
port: 8081
request: http://localhost:8081/users
upstream: https://api.example.com/v1/users
```

Headers entered in the UI are stored as JSON and emitted as `proxy_set_header` lines in the generated Nginx config.

## MCP Conversion Flow

When MCP conversion is enabled, Nginx does not proxy directly to the upstream API. Instead it forwards the public port to the backend MCP gateway:

```text
MCP client -> localhost:<public port> -> Nginx -> backend /mcp-proxy/:ruleId -> target API endpoint
```

The gateway accepts JSON-RPC style requests:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

It returns one tool named `http_request`.

Calling the tool:

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

The backend combines stored rule headers with call-time headers, forwards the request to the configured endpoint, and wraps the upstream response into MCP-compatible JSON-RPC content.

## Start

```bash
docker compose up --build
```

Open:

```text
http://localhost:3000
```

## Test

Create a plain HTTP rule in the UI:

- Endpoint: `https://httpbin.org`
- Port: `8081`
- Headers:

```json
{
  "X-Managed-By": "nginx-manager"
}
```

Then run:

```bash
curl http://localhost:8081/get
```

Create an MCP rule:

- Endpoint: `https://httpbin.org`
- Port: `8082`
- Enable MCP conversion

Then run:

```bash
curl -X POST http://localhost:8082 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call the generated MCP tool:

```bash
curl -X POST http://localhost:8082 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"http_request","arguments":{"method":"GET","path":"/get"}}}'
```

## Deployment Notes

- Replace default PostgreSQL credentials before production use.
- Limit exposed public port ranges to the ports you actually need.
- Keep the API service private. It can reload Nginx because it shares Nginx's PID namespace.
- Use trusted certificates and secure file backups for the Docker volumes.
- `postgres:18.4` is used because it was requested. If your registry does not yet provide that exact tag, change the image tag in `docker-compose.yml` to an available PostgreSQL 18 tag.

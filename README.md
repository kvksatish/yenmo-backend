# Yenmo Backend

> Node.js backend that watches a log file and streams parsed log lines to browser clients via Server-Sent Events.

## Why This Exists

Tailing logs in a terminal works for engineers, but non-technical users need a friendlier way to watch what a system is doing in real time. This backend watches a log file on disk, parses each line into structured JSON, and pushes updates to connected browser clients over SSE. The frontend becomes a pure rendering layer with zero parsing logic.

## Quick Start

```bash
npm install
echo '03/22 08:52:50 INFO   :.......main: init:  System starting up' > sample.log
npm run dev
```

Open a second terminal and test the SSE stream:

```bash
curl -N http://localhost:3001/api/events
```

You should see an `init` event with the parsed log line, followed by periodic heartbeat comments.

## Tech Stack

- **Runtime**: Node.js 22
- **Framework**: Express 5 (native async/await)
- **Language**: TypeScript with ESM modules
- **File Watching**: chokidar 5
- **Security**: Helmet, CORS
- **Testing**: Vitest, Supertest
- **Dev Server**: tsx watch (hot reload)

## Features

- **SSE streaming** with four event types: `init`, `log`, `heartbeat`, `truncate`
- **Structured log parsing** that extracts timestamp, level, module, function, and message
- **Byte-offset file watching** that reads only new bytes appended since the last check
- **File truncation and rotation detection** that resets the read offset when the file shrinks
- **Heartbeat keepalive** every 15 seconds to maintain the connection
- **In-memory buffer** of the last 100 lines so new clients get immediate context

## Installation

**Prerequisites**: Node.js 22+, npm 9+

```bash
git clone <your-repo-url>
cd backend
npm install
```

Create a `.env` file (optional -- defaults work for local development):

```env
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
LOG_FILE_PATH=./sample.log
```

## Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | `number` | `3001` | Port the HTTP server listens on |
| `NODE_ENV` | `string` | `development` | `development` or `production` -- controls error verbosity |
| `CORS_ORIGIN` | `string` | `http://localhost:5173` | Allowed CORS origin for the frontend |
| `LOG_FILE_PATH` | `string` | `./sample.log` | Absolute or relative path to the log file to watch |

## Running the Server

**Development** (hot reload):

```bash
npm run dev
```

**Production** (compile and run):

```bash
npm run build
npm start
```

## Log File Format

The parser expects lines in this format:

```
03/22 08:52:50 INFO   :.......init_policyAPI: open_socket:  Entering
03/22 08:52:50 WARN   :.......connection_mgr: retry_connect:  Timeout reached
03/22 08:52:51 ERROR  :.......disk_monitor: check_space:  Disk usage at 95%
```

Pattern: `MM/DD HH:MM:SS LEVEL :...module: function: message`

Supported levels: `INFO`, `WARN`, `ERROR`, `DEBUG`, `TRACE`, `FATAL`.

Lines that do not match the pattern are passed through as unstructured entries with `isStructured: false`.

## API Endpoints

### `GET /api/events` -- SSE Stream

Opens a persistent Server-Sent Events connection. The server pushes log data as it arrives.

**Response headers**:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**SSE event types**:

| Event | Trigger | Payload |
|-------|---------|---------|
| `init` | On client connect | `{ "lines": ParsedLogLine[] }` -- last 10 lines |
| `log` | New line appended to file | `ParsedLogLine` -- single parsed line |
| `heartbeat` | Every 15 seconds | SSE comment (`:heartbeat`) |
| `truncate` | File shrinks (rotation) | `{ "lines": ParsedLogLine[] }` -- full re-read |

**ParsedLogLine interface**:

```typescript
interface ParsedLogLine {
  id: string;
  timestamp?: string;   // "03/22 08:52:50"
  level?: string;       // "INFO" | "WARN" | "ERROR" | "DEBUG" | "TRACE" | "FATAL"
  module?: string;      // "init_policyAPI"
  function?: string;    // "open_socket"
  message?: string;     // "Entering"
  raw: string;          // Original line text
  isStructured: boolean;
  lineNumber: number;
}
```

**Example** using `curl`:

```bash
curl -N http://localhost:3001/api/events
```

**Example** using the browser `EventSource` API:

```javascript
const source = new EventSource('/api/events');

source.addEventListener('init', (e) => {
  const { lines } = JSON.parse(e.data);
  console.log('Initial lines:', lines);
});

source.addEventListener('log', (e) => {
  const line = JSON.parse(e.data);
  console.log('New line:', line);
});

source.addEventListener('truncate', (e) => {
  const { lines } = JSON.parse(e.data);
  console.log('File rotated, new contents:', lines);
});
```

### `GET /api/health` -- Health Check

Returns the server status. Useful for monitoring and load balancer health probes.

**Response** (`200 OK`):

```json
{
  "status": "ok",
  "timestamp": "2025-03-22T08:52:50.123Z",
  "uptime": 3600.5
}
```

## How It Works

### Log Parser

The log parser (`src/utils/logParser.ts`) applies a regex against each line:

```
/^(\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\s+:\.*([\w]+):\s*([\w]+):\s*(.*)$/
```

If the line matches, it is returned as a structured object with extracted fields. If it does not match, the raw text is preserved with `isStructured: false`. Every line receives a unique incrementing `id` and a `lineNumber`.

### File Watcher

The file watcher (`src/utils/fileWatcher.ts`) uses chokidar for cross-platform file change detection and tracks a byte offset into the watched file:

1. **Startup**: Reads the entire file, parses all lines, stores the byte offset at the end, and calls `onInit` with the parsed lines.
2. **New data**: On each `change` event, reads only the bytes between the last offset and the current file size, parses them, and calls `onNewLines`.
3. **Truncation**: If the current file size is smaller than the stored offset, the file was rotated or truncated. The watcher resets to byte 0, re-reads the entire file, and calls `onTruncate`.
4. **File creation**: If the file does not exist at startup, the watcher waits for it to appear and performs an initial read when it does.

Change events are debounced with a 100ms stability threshold to batch rapid appends.

### SSE Broadcasting

The SSE route (`src/routes/sse.ts`) maintains a `Set<Response>` of connected clients and an in-memory buffer of the last 100 parsed lines:

- New clients receive the most recent 10 lines as an `init` event.
- When the file watcher reports new lines, they are broadcast to all connected clients as individual `log` events.
- On truncation, all clients receive a `truncate` event with the full re-read contents.
- A heartbeat comment is sent every 15 seconds to keep the connection alive through proxies.

## Project Structure

```
backend/
├── src/
│   ├── __tests__/
│   │   └── app.test.ts              # Integration tests (CORS, 404, Helmet)
│   ├── config/
│   │   └── env.ts                   # Environment variable loading
│   ├── controllers/                 # (reserved for future use)
│   ├── middleware/
│   │   ├── errorHandler.ts          # Global error handler
│   │   └── notFound.ts              # 404 handler
│   ├── routes/
│   │   ├── __tests__/
│   │   │   ├── health.test.ts       # Health endpoint tests
│   │   │   └── sse.test.ts          # SSE endpoint tests
│   │   ├── health.ts                # GET /api/health
│   │   ├── index.ts                 # Route aggregator
│   │   └── sse.ts                   # GET /api/events (SSE)
│   ├── utils/
│   │   ├── __tests__/
│   │   │   ├── fileWatcher.test.ts  # File watcher tests
│   │   │   └── logParser.test.ts    # Log parser tests
│   │   ├── fileWatcher.ts           # chokidar file watcher
│   │   └── logParser.ts             # Log line regex parser
│   ├── app.ts                       # Express app setup
│   └── server.ts                    # HTTP server entry point
├── .gitea/
│   └── workflows/
│       └── ci.yaml                  # CI/CD pipeline
├── Dockerfile                       # Multi-stage production build
├── package.json
├── tsconfig.json
└── sample.log                       # Example log file for development
```

## Testing

The test suite uses Vitest and Supertest. There are 5 test suites covering the backend:

- **Log parser** -- structured and unstructured parsing, all log levels, edge cases, empty input
- **File watcher** -- initial read, offset tracking, new data appends, truncation detection
- **SSE endpoint** -- response headers, init event payload, heartbeat, multi-client broadcast
- **Health check** -- response shape, status field, uptime value
- **App integration** -- CORS headers, 404 handler, Helmet security headers, JSON body parsing

**Run all tests**:

```bash
npm test
```

**Run tests in watch mode** (re-runs on file changes):

```bash
npm run test:watch
```

## Docker

The Dockerfile uses a multi-stage build to produce a minimal production image:

**Stage 1 -- Builder**: Installs all dependencies, compiles TypeScript to JavaScript.

**Stage 2 -- Runtime**: Copies only `package.json`, production dependencies (`npm ci --omit=dev`), and the compiled `dist/` directory. The final image contains no TypeScript source, no dev dependencies, and no build tools.

**Build the image**:

```bash
docker build -t yenmo-backend .
```

**Run the container**:

```bash
docker run -d \
  --name yenmo-backend \
  -p 3001:3001 \
  -e PORT=3001 \
  -e NODE_ENV=production \
  -e CORS_ORIGIN=https://your-frontend.com \
  -e LOG_FILE_PATH=/data/sample.log \
  -v /path/to/your/logs:/data \
  yenmo-backend
```

The `-v` mount is required so the container can access the log file from the host.

## Deployment

The project uses Gitea Actions for CI/CD, defined in `.gitea/workflows/ci.yaml`.

**On every push to `main` and on pull requests**:
1. Install dependencies
2. Run TypeScript type checking (`tsc --noEmit`)
3. Run the full test suite

**On tag push** (e.g., `v1.2.0`):
1. Run the build job above
2. Build a Docker image tagged with `latest`, the version tag, and the commit SHA
3. Push all three tags to the Gitea container registry
4. Deploy by stopping the old container and starting a new one on the `edge` Docker network with Traefik labels for automatic HTTPS routing

Traefik handles TLS termination via Let's Encrypt and routes traffic to the container on port 3001.

## Security

- **Helmet** sets security headers including HSTS, X-Content-Type-Options, X-Frame-Options, and CSP
- **CORS** is restricted to the configured `CORS_ORIGIN` (defaults to the Vite dev server in development)
- **Error messages** are environment-aware: full stack traces in development, generic "Internal server error" in production
- **404 handler** returns a JSON error for unknown routes instead of a default HTML page

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `tsx watch src/server.ts` | Start dev server with hot reload |
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `start` | `node dist/server.js` | Run the compiled production server |
| `lint` | `eslint src/` | Lint the source code |
| `test` | `vitest run` | Run the test suite once |
| `test:watch` | `vitest` | Run tests in watch mode |

## License

MIT

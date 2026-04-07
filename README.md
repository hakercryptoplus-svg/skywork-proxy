# Skywork Proxy

A lightweight proxy server for Skywork AI API with automatic token rotation.

## Endpoints

### Health Check
```
GET /
```

### Chat Completions
```
POST /v1/chat/completions
Authorization: Bearer Ahmad_Investor_2026
Content-Type: application/json
```

### Example Request
```bash
curl -X POST "https://your-app.onrender.com/v1/chat/completions" \
  -H "Authorization: Bearer Ahmad_Investor_2026" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Skywork-o3-mini",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | API authentication key | `Ahmad_Investor_2026` |
| `PORT` | Server port | `3000` |

## Deploy on Render

1. Fork or push this repo to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Build command: `npm install`
5. Start command: `node index.js`
6. Done!

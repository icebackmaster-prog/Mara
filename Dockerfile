# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ---- Production stage ----
FROM node:22-alpine
WORKDIR /app

# Install ffmpeg (needed for lyrics video generation)
RUN apk add --no-cache ffmpeg

# Copy production node_modules and all source files
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Ensure the sessions and MaraXOffcial folders exist
RUN mkdir -p sessions MaraXOffcial

# Non‑root user for security
RUN addgroup -g 1001 -S marax && adduser -S marax -u 1001 -G marax
RUN chown -R marax:marax /app
USER marax

# Keep the container alive by starting the bot
CMD ["node", "index.js"]

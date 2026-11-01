# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package management files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy application source code
COPY . .

# Build the NestJS application
RUN npm run build

# Remove development dependencies to keep production image light
RUN npm prune --omit=dev

# Stage 2: Production runtime stage
FROM node:22-alpine

WORKDIR /app

# Set timezone globally in the container (matching project timezone Asia/Ho_Chi_Minh)
RUN apk add --no-cache tzdata
ENV TZ=Asia/Ho_Chi_Minh

ENV NODE_ENV=production
ENV PORT=3000

# Copy necessary files from the build stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/migrations ./migrations

RUN mkdir -p /app/upload && chown -R node:node /app/upload
USER node

# Expose the application port
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Start the NestJS application
CMD ["node", "dist/main.js"]

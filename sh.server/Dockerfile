# Stage 1: Build stage
FROM node:20-alpine AS builder

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
RUN npm prune --production

# Stage 2: Production runtime stage
FROM node:20-alpine

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

# Expose the application port
EXPOSE 3000

# Start the NestJS application
CMD ["node", "dist/main.js"]

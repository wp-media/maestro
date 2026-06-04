FROM node:20-alpine
WORKDIR /app

# Install deps first (cached layer)
COPY app/package.json ./
RUN npm install --omit=dev

# Copy source and build the React app
COPY app/ ./
RUN npm run build

EXPOSE 7337
ENV NODE_ENV=production
ENV PORT=7337

CMD ["node", "server/index.mjs"]

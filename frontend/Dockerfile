FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
ENV CI=1 EXPO_NO_TELEMETRY=1
EXPOSE 8081
CMD ["npm", "run", "web", "--", "--port", "8081"]

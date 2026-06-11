# Dockerfile — frontend dev-server image; Vite proxies /api to the api service.

FROM node:22-slim

WORKDIR /srv/frontend
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

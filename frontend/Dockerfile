FROM node:18 as builder
WORKDIR /frontend
COPY frontend/ ./
RUN npm install
RUN npm run prodbuild

FROM nginx:alpine
COPY --from=builder /frontend/dist /usr/share/nginx/html
EXPOSE 3000
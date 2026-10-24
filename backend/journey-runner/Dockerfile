FROM node:24-alpine
WORKDIR /recipe
RUN npm init -y && npm pkg set type=module && npm install --ignore-scripts --omit=dev express@5.1.0
COPY signup.ts /recipe/signup.ts
USER 65534:65534
ENTRYPOINT ["node", "/recipe/signup.ts"]

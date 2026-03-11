FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install
COPY . .
# Provide dummy env vars so Next.js can build without a live DB/Stripe connection
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
    CLERK_SECRET_KEY=sk_test_placeholder \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_placeholder
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public
EXPOSE 5000
CMD ["node", "dist/index.cjs"]

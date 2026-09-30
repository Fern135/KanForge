# Kanforge: open-source kanban boards. Run `make help` for every command.
SHELL := /bin/sh
.DEFAULT_GOAL := help

COMPOSE      := docker compose
COMPOSE_DEV  := docker compose -f docker-compose.yml -f docker-compose.dev.yml
MIGRATE      := $(COMPOSE) run --rm migrate
BACKUP_DIR   := backups

-include .env

.PHONY: help setup build up down restart logs ps status dev dev-down \
        migrate migrate-down migrate-status migrate-create seed \
        test audit shell-api mongo-shell redis-cli backup restore clean certs rotate-jwt admin demo demo-remove

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

##@ Lifecycle

setup: ## First run: generate .env secrets and a local TLS certificate
	@node scripts/run.mjs setup

build: setup ## Build all images
	$(COMPOSE) build

up: setup ## Build and start the full stack (runs pending migrations automatically)
	$(COMPOSE) up -d --build --wait
	@printf "\n  Kanforge is running at %s\n  (self-signed cert locally: accept the browser warning)\n\n" "$(APP_ORIGIN)"

down: ## Stop the stack (data is kept)
	$(COMPOSE) down

restart: ## Restart the stack
	$(COMPOSE) restart

logs: ## Follow logs (make logs s=api for one service)
	$(COMPOSE) logs -f --tail=200 $(s)

ps: ## Show container status
	$(COMPOSE) ps

status: ps ## Alias for ps

dev: setup ## Start the dev stack with hot reload at http://localhost:5173
	$(COMPOSE_DEV) up -d --build --wait mongo redis migrate api web-dev
	@printf "\n  Dev server: http://localhost:5173\n\n"

dev-down: ## Stop the dev stack
	$(COMPOSE_DEV) down

##@ Database

migrate: ## Apply all pending migrations
	$(COMPOSE) up -d --wait mongo
	$(MIGRATE) up -f migrate-mongo-config.js

migrate-down: ## Roll back the most recent migration
	$(COMPOSE) up -d --wait mongo
	$(MIGRATE) down -f migrate-mongo-config.js

migrate-status: ## Show which migrations have been applied
	$(COMPOSE) up -d --wait mongo
	$(MIGRATE) status -f migrate-mongo-config.js

migrate-create: ## Scaffold a new migration: make migrate-create name=add-something
	@test -n "$(name)" || (echo "usage: make migrate-create name=<description>" && exit 1)
	@f="backend/migrations/$$(date -u +%Y%m%d%H%M%S)-$(name).js"; \
	printf "'use strict';\n\nmodule.exports = {\n  async up(db) {\n    // await db.collection('cards').createIndex({ field: 1 }, { name: 'field' });\n  },\n\n  async down(db) {\n    // await db.collection('cards').dropIndex('field');\n  },\n};\n" > "$$f"; \
	echo "Created $$f"

admin: ## Make an existing account platform admin: make admin email=you@example.com
	@test -n "$(email)" || (echo "usage: make admin email=<the email you signed up with>" && exit 1)
	$(COMPOSE) up -d --wait mongo redis
	$(COMPOSE) run --rm --build --entrypoint node migrate scripts/make-admin.js '$(email)'

demo: ## Add made-up accounts and workspaces for the admin dashboard (dev database)
	$(COMPOSE_DEV) up -d --wait mongo redis
	$(COMPOSE_DEV) run --rm --build --no-deps api node scripts/demo-data.js

demo-remove: ## Remove the made-up accounts and workspaces added by make demo
	$(COMPOSE_DEV) up -d --wait mongo redis
	$(COMPOSE_DEV) run --rm --build --no-deps api node scripts/demo-data.js remove

seed: ## Insert a demo user and sample board (prints the credentials)
	$(COMPOSE) up -d --wait mongo
	$(COMPOSE) run --rm -e ALLOW_SEED=true --entrypoint node migrate scripts/seed.js

backup: ## Dump MongoDB to backups/<timestamp>.archive.gz
	@mkdir -p $(BACKUP_DIR)
	@f="$(BACKUP_DIR)/mongo-$$(date -u +%Y%m%dT%H%M%SZ).archive.gz"; \
	$(COMPOSE) exec -T mongo sh -c 'mongodump --quiet --archive --gzip --db "$$MONGO_APP_DB" -u "$$MONGO_INITDB_ROOT_USERNAME" -p "$$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' > "$$f" && \
	chmod 600 "$$f" && echo "Backup written to $$f"

restore: ## Restore a dump: make restore file=backups/xxx.archive.gz (drops existing data)
	@test -f "$(file)" || (echo "usage: make restore file=backups/<dump>.archive.gz" && exit 1)
	@printf "This REPLACES the current database with $(file). Type 'yes' to continue: "; read ans; [ "$$ans" = "yes" ]
	$(COMPOSE) exec -T mongo sh -c 'mongorestore --quiet --archive --gzip --drop -u "$$MONGO_INITDB_ROOT_USERNAME" -p "$$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' < "$(file)"
	@$(COMPOSE) exec -T redis sh -c 'redis-cli --no-auth-warning --user app --pass "$$REDIS_PASSWORD" --scan --pattern "board:*" | xargs -r redis-cli --no-auth-warning --user app --pass "$$REDIS_PASSWORD" del' >/dev/null
	@echo "Restore complete (board cache cleared)."

##@ Quality

test: setup ## Run the backend integration test suite in Docker (isolated test DB)
	$(COMPOSE) --profile test build api-test
	$(COMPOSE) up -d --wait mongo redis
	$(COMPOSE) --profile test run --rm api-test

audit: ## Check dependencies for known vulnerabilities
	cd backend && npm audit --omit=dev
	cd frontend && npm audit --omit=dev

##@ Shells

shell-api: ## Open a shell in the API container
	$(COMPOSE) exec api sh

mongo-shell: ## Open mongosh as the least-privilege app user
	$(COMPOSE) exec mongo sh -c 'mongosh --quiet "mongodb://$$MONGO_APP_USER:$$MONGO_APP_PASSWORD@localhost:27017/$$MONGO_APP_DB?authSource=$$MONGO_APP_DB"'

redis-cli: ## Open redis-cli as the app user
	$(COMPOSE) exec redis sh -c 'redis-cli --no-auth-warning --user app --pass "$$REDIS_PASSWORD"'

##@ Security & maintenance

certs: ## Regenerate the local self-signed TLS certificate
	rm -f docker/nginx/certs/tls.crt docker/nginx/certs/tls.key
	node scripts/run.mjs setup
	$(COMPOSE) restart web

rotate-jwt: ## Rotate the JWT signing secret (every access token is invalidated)
	@new=$$(openssl rand -hex 64); \
	sed -i.bak "s/^JWT_ACCESS_SECRET=.*/JWT_ACCESS_SECRET=$$new/" .env && rm -f .env.bak && \
	echo "JWT secret rotated. Run 'make up' to apply."

clean: ## Stop everything and DELETE all data volumes
	@printf "This deletes ALL data (MongoDB, Redis). Type 'yes' to continue: "; read ans; [ "$$ans" = "yes" ]
	$(COMPOSE) --profile test down -v --remove-orphans

SHELL := /bin/bash
.SHELLFLAGS := -ec

ENV := packages/contracts/.env
DOTENV := set -a; [ -f $(ENV) ] && . $(ENV); set +a

.PHONY: help install compile deploy register setup run-app run-obs1 run-obs2 run all clean clean-next

help:
	@echo "make install    pnpm install (workspace)"
	@echo "make compile    hardhat compile"
	@echo "make deploy     deploy cUSDC + Sigill, sync addresses to .env.local files"
	@echo "make register   bond observer #1 + #2 (skips if already bonded)"
	@echo "make setup      install + deploy + register"
	@echo "make run        start app + 2 observers in parallel (Ctrl-C stops all)"
	@echo "make all        setup + run"

install:
	pnpm install

compile:
	cd packages/contracts && pnpm run compile

deploy: compile
	cd packages/contracts && pnpm run deploy
	node scripts/sync-env.mjs

register:
	cd packages/contracts && node scripts/register-observers.mjs

setup: install deploy register

# Drop Next's build cache before each run. Webpack-dev caches the cofhejs
# WASM here, and a stale copy can desync with the live Fhenix testnet keys
# producing "Error serializing public key" at cofhejs init. The
# `webpack.experiments` block in next.config.ts is the actual fix; this
# wipe just makes sure no pre-fix bundle is ever served on a fresh `make
# run`. Don't try turbopack as a substitute — it crashes with
# "indexedDB is not defined" during SSR of @walletconnect/core, and
# emits a doubled `/_next/_next/...` asset prefix that 404s every chunk.
clean-next:
	rm -rf packages/app/.next

run-app: clean-next
	cd packages/app && pnpm run dev

run-obs1:
	cd packages/observer && pnpm run start

run-obs2:
	@$(DOTENV); cd packages/observer && OBSERVER_PRIVATE_KEY=$$OBSERVER_PRIVATE_KEY_2 pnpm run start

run: clean-next
	@trap 'kill 0' EXIT INT TERM; \
	(cd packages/app && pnpm run dev 2>&1 | sed -e 's/^/[app] /') & \
	(cd packages/observer && pnpm run start 2>&1 | sed -e 's/^/[obs1] /') & \
	($(DOTENV); cd packages/observer && OBSERVER_PRIVATE_KEY=$$OBSERVER_PRIVATE_KEY_2 pnpm run start 2>&1 | sed -e 's/^/[obs2] /') & \
	wait

all: setup run

clean:
	cd packages/contracts && pnpm clean
